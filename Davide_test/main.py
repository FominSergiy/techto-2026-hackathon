"""Hotel race agent: one prompt -> cheapest hotels -> parallel ElevenLabs calls -> confirmation email.

Usage:
  python main.py "Book the cheapest hotel in Toronto for tonight, 1 guest"
  python main.py --search-only "cheapest hotel in Toronto tonight"   # search only: no calls, no email
  python main.py --rescrape "..."                                     # ignore the saved file, run the scraper now
  python main.py --hotels hotels.json "tonight, 1 guest"             # skip the search, use a saved list
  python main.py --test-email [--to me@x.com] [--dry-run]            # email check only, no calls
  python main.py --send-email [result.json] [--to me@x.com] [--dry-run]  # re-send a saved result
  (--to overrides RESULT_EMAIL, --dry-run prints the email instead of sending; both work on full runs too)

Search order: 1) OUTPUT_DIR/hotels-<city>-<date>.json saved by search.js (default D:\\techTO hackaton\\techto-2026-hackathon\\output),
2) runs the teammate's Node scraper (search.js, found in SCRAPER_DIR, this folder or its parent);
if it is missing or fails, falls back to the built-in SearchAPI + Google Places search below.
"""
import os, re, sys, json, time, shlex, smtplib, subprocess, datetime as dt, requests
from email.message import EmailMessage
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv(override=True)  # the .env file wins over variables already set in the shell
E = os.environ
N_CALLS = int(E.get("N_CALLS", 3))  # the 3 cheapest hotels
CALL_TIMEOUT = int(E.get("CALL_TIMEOUT", 300))  # seconds per call
OUTPUT_DIR = E.get("OUTPUT_DIR") or r"D:\techTO hackaton\techto-2026-hackathon\output"  # where search.js saves hotels-<city>-<date>.json
T0 = time.time()
LOG = []


def log(msg, **kw):
    line = {"t": round(time.time() - T0, 1), "msg": msg, **kw}
    LOG.append(line)
    print(f"[{line['t']:>6}s] {msg}", kw if kw else "")


# ---------- 1. Parse the one-shot prompt (no LLM = zero tokens) ----------
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "a": 1, "an": 1, "single": 1}


def parse_prompt(text, need_city=True):
    t = text.lower()
    today = dt.date.today()
    check_in = today
    if "tomorrow" in t:
        check_in = today + dt.timedelta(days=1)
    # "October 20", "Oct 20th", "20 October"
    md = (re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b", t)
          or re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", t))
    if md:
        mon, day = (md.group(1), md.group(2)) if md.group(1).isalpha() else (md.group(2), md.group(1))
        d = dt.date(today.year, MONTHS[mon], int(day))
        check_in = d if d >= today else d.replace(year=today.year + 1)
    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        check_in = dt.date.fromisoformat(m.group(1))
    num = r"(\d+|one|two|three|four|five|a|an|single)"
    n = re.search(num + r"\s*nights?", t)
    nights = int(WORD_NUM.get(n.group(1), n.group(1))) if n else 1
    g = re.search(num + r"\s*(?:guests?|adults?|people|persons?)", t)
    guests = int(WORD_NUM.get(g.group(1), g.group(1))) if g else 1
    city = re.search(r"\b(?i:in|at)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)", text)
    if not city and need_city:
        raise SystemExit("City not found in prompt. Pass it with a capital letter, e.g. 'in Toronto'.")
    return {"city": city.group(1) if city else "", "check_in": check_in.isoformat(),
            "check_out": (check_in + dt.timedelta(days=nights)).isoformat(), "guests": guests}


# ---------- 2. Find cheapest hotels ----------
def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"[\d,.]+", v)
        return float(m.group().replace(",", "")) if m else None
    if isinstance(v, dict):
        for k in ("extracted_price", "extracted_lowest", "lowest", "price", "value"):
            if k in v and _num(v[k]) is not None:
                return _num(v[k])
    return None


def price_of(p):
    for k in ("price_per_night", "rate_per_night", "extracted_price", "price", "total_price", "total_rate"):
        if k in p and _num(p[k]) is not None:
            return _num(p[k])
    return None


def search_prices(q):
    """SearchAPI Google Hotels: real prices for the dates."""
    r = requests.get("https://www.searchapi.io/api/v1/search", timeout=20, params={
        "engine": "google_hotels", "q": f"hotels in {q['city']}", "check_in_date": q["check_in"],
        "check_out_date": q["check_out"], "adults": q["guests"], "currency": E.get("CURRENCY", "CAD"),
        "api_key": E["SEARCH_API_KEY"]})
    r.raise_for_status()
    props = [p for p in r.json().get("properties", []) if price_of(p)]
    props.sort(key=price_of)
    return props


def place_details(name, city):
    """Google Places (New): phone + address for one hotel."""
    r = requests.post("https://places.googleapis.com/v1/places:searchText", timeout=15,
                      headers={"X-Goog-Api-Key": E["GOOGLE_MAPS_API_KEY"],
                               "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.internationalPhoneNumber"},
                      json={"textQuery": f"{name}, {city}", "pageSize": 1})
    p = (r.json().get("places") or [{}])[0]
    return p.get("internationalPhoneNumber"), p.get("formattedAddress")


def find_hotels(q):
    props = search_prices(q)[: N_CALLS * 3]
    log(f"{len(props)} priced hotels")
    with ThreadPoolExecutor(8) as ex:
        details = list(ex.map(lambda p: place_details(p["name"], q["city"]), props))
    hotels = [{"name": p["name"], "price": price_of(p), "phone": ph.replace(" ", ""), "address": addr}
              for p, (ph, addr) in zip(props, details) if ph]
    return hotels[:N_CALLS]


def find_output_file(q):
    """Saved scraper run: OUTPUT_DIR/hotels-<city>-<check_in>.json (else the newest hotels-<city>-*.json)."""
    slug = re.sub(r"[^a-z0-9]+", "-", q["city"].lower()).strip("-")
    exact = os.path.join(OUTPUT_DIR, f"hotels-{slug}-{q['check_in']}.json")
    if os.path.isfile(exact):
        return exact
    try:
        cands = [os.path.join(OUTPUT_DIR, f) for f in os.listdir(OUTPUT_DIR)
                 if f.startswith(f"hotels-{slug}-") and f.endswith(".json")]
    except OSError:
        return None
    if cands:
        newest = max(cands, key=os.path.getmtime)
        log(f"no file for {q['check_in']}, using the newest one (prices may be stale): {os.path.basename(newest)}")
        return newest
    return None


def find_scraper_dir():
    """Folder with the teammate's Node scraper (search.js): SCRAPER_DIR, else this folder or its parent."""
    here = os.path.dirname(os.path.abspath(__file__))
    for d in [E.get("SCRAPER_DIR"), here, os.path.dirname(here)]:
        if d and os.path.isfile(os.path.join(d, "search.js")):
            return d
    return None


def scrape(q, scraper_dir):
    """Runs `node search.js --json` (multi-source search + Google Places phones + city check) and returns its records."""
    args = ["node", "search.js", "--json", f"--city={q['city']}", f"--check-in={q['check_in']}",
            f"--check-out={q['check_out']}", f"--adults={q['guests']}",
            # API sources only: expedia drives a browser (forbidden by the rules)
            f"--sources={E.get('SCRAPER_SOURCES', 'searchapi,xotelo')}",
            # fewer candidates = fewer Places lookups = faster search
            f"--target-count={max(N_CALLS * 4, 10)}", "--max-pages=2"] + shlex.split(E.get("SCRAPER_ARGS", ""))
    started = time.time()
    p = subprocess.run(args, cwd=scraper_dir, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=int(E.get("SCRAPER_TIMEOUT", 120)), env=dict(os.environ))
    with open("scrape_log.txt", "w", encoding="utf-8") as f:
        f.write(" ".join(args) + "\n\n" + p.stdout + "\n--- stderr ---\n" + p.stderr)
    line = next((l for l in p.stdout.splitlines() if l.startswith("@@RESULT@@")), None)
    if p.returncode != 0 or line is None:
        raise RuntimeError(f"scraper exit {p.returncode}: {(p.stderr or p.stdout).strip()[-300:]} (see scrape_log.txt)")
    raw = json.loads(line[len("@@RESULT@@"):])
    json.dump(raw, open("hotels_scraped.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    log("scraper done", secs=round(time.time() - started, 1), hotels=len(raw), with_phone=sum(1 for r in raw if r.get("phone")))
    return raw


def load_hotels_json(path):
    """Teammate's scraper output saved to a file: [{name,address,phone,nightlyPrice,totalPrice,...}]."""
    return normalize_records(json.load(open(path, encoding="utf-8")))


def normalize_records(raw):
    hotels = []
    for h in raw:
        digits = re.sub(r"\D", "", h.get("phone") or "")
        price = h.get("totalPrice") or h.get("nightlyPrice")
        if len(digits) < 10 or not price:
            continue
        us = "USA" in (h.get("address") or "")
        hotels.append({"name": h["name"], "price": price, "address": h.get("address"),
                       "phone": "+" + (digits if len(digits) > 10 else "1" + digits), "_us": us})
    # drop outliers from another country (e.g. a US hotel in a Canadian search): keep the majority
    if hotels:
        us_count = sum(h["_us"] for h in hotels)
        keep_us = us_count > len(hotels) / 2
        hotels = [h for h in hotels if h["_us"] == keep_us]
    hotels.sort(key=lambda h: h["price"])
    return hotels[:N_CALLS]


# ---------- 3. Call hotels in parallel ----------
XI = {"xi-api-key": E.get("ELEVENLABS_API_KEY", "")}


def hang_up(call_sid):
    if call_sid and E.get("TWILIO_ACCOUNT_SID"):
        requests.post(f"https://api.twilio.com/2010-04-01/Accounts/{E['TWILIO_ACCOUNT_SID']}/Calls/{call_sid}.json",
                      data={"Status": "completed"}, auth=(E["TWILIO_ACCOUNT_SID"], E["TWILIO_AUTH_TOKEN"]), timeout=10)


ACTIVE = {}


# TEST_NUMBER: comma-separated phones; entries without 10+ digits (e.g. a leftover "+" or ",") are ignored
TEST = ["+" + d for d in (re.sub(r"\D", "", x) for x in E.get("TEST_NUMBER", "").split(",")) if len(d) >= 10]


def call_hotel(h, q, i=0):
    to = TEST[i % len(TEST)] if TEST else h["phone"]  # TEST_NUMBER may hold several numbers: one per hotel
    r = requests.post("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", headers=XI, timeout=20, json={
        "agent_id": E["ELEVENLABS_AGENT_ID"], "agent_phone_number_id": E["ELEVENLABS_PHONE_NUMBER_ID"],
        "to_number": to,
        "conversation_initiation_client_data": {"dynamic_variables": {
            "hotel_name": h["name"], "guest_name": E["GUEST_NAME"], "number_of_guests": str(q["guests"]),
            "check_in_date": q["check_in"], "check_out_date": q["check_out"], "contact_email": E["CONTACT_EMAIL"]}}})
    j = r.json() if r.content else {}
    cid, sid = j.get("conversation_id"), j.get("callSid") or j.get("call_sid")
    if not r.ok or not cid:
        raise RuntimeError(f"{h['name']}: call not started -> HTTP {r.status_code} {json.dumps(j)[:400]}")
    ACTIVE[cid] = sid
    log(f"calling {h['name']}", conv=cid)
    deadline = time.time() + CALL_TIMEOUT
    while time.time() < deadline:
        time.sleep(1)
        c = requests.get(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}", headers=XI, timeout=15).json()
        if c.get("status") in ("done", "failed"):
            break
    else:
        hang_up(sid)
        raise RuntimeError(f"{h['name']}: timeout")
    ACTIVE.pop(cid, None)

    ALIAS = {"confirmation_number": "reservation_number", "room_rate": "price", "address": "hotel_address"}

    def extracted(conv):
        return {ALIAS.get(k, k): (v or {}).get("value") for k, v in
                ((conv.get("analysis") or {}).get("data_collection_results") or {}).items()}

    d = extracted(c)
    for _ in range(4):  # analysis can lag a few seconds behind status=done
        if d.get("reservation_number"):
            break
        time.sleep(2)
        c = requests.get(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}", headers=XI, timeout=15).json()
        d = extracted(c)
    json.dump(c, open(f"conv_{cid}.json", "w"), indent=1)  # transcript + analysis for debugging
    LOG.append({"conv": cid, "hotel": h["name"], "extracted": d, "cost_credits": (c.get("metadata") or {}).get("cost"),
                "secs": (c.get("metadata") or {}).get("call_duration_secs")})
    meta = c.get("metadata") or {}
    # name/address/phone come from Google data (reliable); number + price can only come from the call
    return {"hotel": h["name"] or d.get("hotel_name"), "address": h["address"] or d.get("hotel_address"),
            "phone": h["phone"], "number": d.get("reservation_number"),
            "price": d.get("price"), "google_price": h["price"], "date": q["check_in"],
            "status": "booked" if d.get("reservation_number") else "no_reservation",
            "conversation_id": cid, "call_secs": meta.get("call_duration_secs"), "cost_credits": meta.get("cost")}


# ---------- 4. Email (also usable alone to re-send a saved result.json) ----------
def build_email(res, to):
    m = EmailMessage()
    m["Subject"] = f"Team # {E.get('TEAM_NUMBER', '?')} - Hotel Reservation Confirmed!"
    m["From"], m["To"] = E.get("SMTP_USER", ""), to
    m.set_content(f"Hotel Name: {res.get('hotel', '')}\nAddress: {res.get('address', '')}\n"
                  f"Phone: {res.get('phone', '')}\nReservation #: {res.get('number', '')}\n"
                  f"Reservation Date: {res.get('date', '')}\nPrice: {res.get('price', '')}\n")
    return m


def send_email(res, to=None, dry_run=False):
    to = to or E.get("RESULT_EMAIL", "")
    m = build_email(res, to)
    if dry_run:
        print(f"To: {m['To']}\nFrom: {m['From']}\nSubject: {m['Subject']}\n\n{m.get_content()}")
        return
    if not to:
        raise RuntimeError("RESULT_EMAIL missing in .env (or pass --to address)")
    errors = []
    # 1) Gmail SMTP (needs SMTP_USER + SMTP_APP_PASSWORD), two tries per port
    if E.get("SMTP_USER") and E.get("SMTP_APP_PASSWORD"):
        pwd = E["SMTP_APP_PASSWORD"].replace(" ", "")
        for attempt in range(2):
            for port in (465, 587):
                try:
                    if port == 465:
                        s = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15)
                    else:
                        s = smtplib.SMTP("smtp.gmail.com", 587, timeout=15)
                        s.starttls()
                    with s:
                        s.login(E["SMTP_USER"], pwd)
                        s.send_message(m)
                    print(f"email sent to {to} (gmail smtp:{port})")
                    return
                except Exception as e:
                    errors.append(f"smtp:{port}: {type(e).__name__}: {e}")
            time.sleep(1)
    else:
        errors.append("SMTP_USER / SMTP_APP_PASSWORD missing")
    # 2) HTTPS fallback (works on any network): SendGrid, sender = SMTP_USER or EMAIL_FROM verified there
    if E.get("SENDGRID_API_KEY"):
        sender = E.get("EMAIL_FROM") or E.get("SMTP_USER")
        try:
            r = requests.post("https://api.sendgrid.com/v3/mail/send", timeout=20,
                              headers={"Authorization": f"Bearer {E['SENDGRID_API_KEY']}"},
                              json={"personalizations": [{"to": [{"email": to}]}], "from": {"email": sender},
                                    "subject": m["Subject"], "content": [{"type": "text/plain", "value": m.get_content()}]})
            if r.status_code < 300:
                print(f"email sent to {to} (sendgrid)")
                return
            errors.append(f"sendgrid: HTTP {r.status_code} {r.text[:200]}")
        except Exception as e:
            errors.append(f"sendgrid: {type(e).__name__}: {e}")
    raise RuntimeError("EMAIL FAILED. " + " | ".join(errors) +
                       "  -> the result is saved in result.json: run `python main.py --send-email` later, "
                       "or copy the text below into any mail client:\n" + m.get_content())


def main():
    args = sys.argv[1:]
    to = args[args.index("--to") + 1] if "--to" in args else None  # override recipient (tests!)
    dry = "--dry-run" in args
    if "--test-email" in args:  # no calls: just check the email works
        send_email({"hotel": "Test Hotel", "address": "1 Test St, Toronto", "phone": "+14165550100",
                    "number": "TEST123", "price": 99, "date": dt.date.today().isoformat()}, to, dry)
        return
    if "--send-email" in args:  # no search, no calls: send a saved result (default result.json)
        i = args.index("--send-email")
        path = args[i + 1] if i + 1 < len(args) and args[i + 1].endswith(".json") else "result.json"
        send_email(json.load(open(path, encoding="utf-8")), to, dry)
        return
    search_only = "--search-only" in args
    hotels_file = args[args.index("--hotels") + 1] if "--hotels" in args else None
    skip = {"--search-only", "--rescrape", "--hotels", hotels_file, "--to", to, "--dry-run"}
    prompt = " ".join(a for a in args if a not in skip)
    q = parse_prompt(prompt, need_city=not hotels_file)
    log("parsed", **q)
    log("config", n_calls=N_CALLS, test_numbers=TEST or "REAL HOTEL PHONES")
    if E.get("TEST_NUMBER", "").strip() and not TEST:
        log("WARNING: TEST_NUMBER is set but has no valid phone number, ignoring it -> calls go to the REAL hotels")
    hotels = []
    if hotels_file:
        hotels = load_hotels_json(hotels_file)
    else:
        saved = None if "--rescrape" in args else find_output_file(q)
        if saved:  # fastest path: reuse the scraper output already saved in OUTPUT_DIR
            log("reading saved search", file=saved)
            try:
                hotels = load_hotels_json(saved)
            except Exception as e:
                log(f"SAVED FILE UNREADABLE, searching again: {e}")
    if not hotels and not hotels_file:
        scraper_dir = find_scraper_dir()
        if scraper_dir:
            try:
                hotels = normalize_records(scrape(q, scraper_dir))
            except Exception as e:
                log(f"SCRAPER FAILED, falling back to the built-in search: {e}")
        if not hotels:
            try:
                hotels = find_hotels(q)
            except Exception as e:
                log(f"BUILT-IN SEARCH FAILED: {e}")
    for h in hotels:
        log("hotel", **h)
    if search_only or not hotels:
        return
    strategy = E.get("STRATEGY", "cheapest")  # cheapest = wait all calls, pick lowest price | first = stop at first booking
    log("strategy", strategy=strategy)
    ex = ThreadPoolExecutor(len(hotels))
    futs = {ex.submit(call_hotel, h, q, i): h for i, h in enumerate(hotels)}
    results = []
    for f in as_completed(futs):
        h = futs[f]
        try:
            res = f.result()
        except Exception as e:
            res = {"hotel": h["name"], "address": h["address"], "phone": h["phone"], "google_price": h["price"],
                   "status": "failed", "error": str(e)[:300]}
        results.append(res)
        log(res["status"].upper(), hotel=res["hotel"], number=res.get("number"), price=res.get("price"))
        if strategy == "first" and res["status"] == "booked":
            for sid in list(ACTIVE.values()):  # stop the other calls: saves minutes + tokens
                hang_up(sid)
            for g, hh in futs.items():
                if not g.done():
                    results.append({"hotel": hh["name"], "phone": hh["phone"], "status": "cancelled"})
            break

    booked = [r for r in results if r["status"] == "booked"]
    if strategy == "cheapest":
        booked.sort(key=lambda r: _num(r.get("price")) or float("inf"))
    chosen = booked[0] if booked else None
    json.dump({"query": q, "strategy": strategy, "elapsed_s": round(time.time() - T0, 1),
               "chosen": chosen, "calls": results}, open("results.json", "w"), indent=2, ensure_ascii=False)
    if chosen:
        log("CHOSEN", **{k: chosen.get(k) for k in ("hotel", "number", "price")})
        json.dump(chosen, open("result.json", "w"), indent=2, ensure_ascii=False)
        try:
            send_email(chosen, to, dry)
            log("email printed only (--dry-run), NOT sent" if dry else "email sent")
        except Exception as e:
            log(f"EMAIL FAILED: {e}")
    else:
        log("no booking obtained")
    json.dump(LOG, open(f"run_{int(T0)}.json", "w"), indent=1, default=str)
    os._exit(0)


if __name__ == "__main__":
    main()