"""Hotel race agent: one prompt -> cheapest hotels -> parallel ElevenLabs calls -> confirmation email.

Usage:
  python main.py "Book the cheapest hotel in Toronto for tonight, 1 guest"
  python main.py --search-only "cheapest hotel in Toronto tonight"   # no calls, no email
"""
import os, re, sys, json, time, smtplib, datetime as dt, requests
from email.message import EmailMessage
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv()
E = os.environ
N_CALLS = int(E.get("N_CALLS", 4))
CALL_TIMEOUT = int(E.get("CALL_TIMEOUT", 300))  # seconds per call
T0 = time.time()
LOG = []


def log(msg, **kw):
    line = {"t": round(time.time() - T0, 1), "msg": msg, **kw}
    LOG.append(line)
    print(f"[{line['t']:>6}s] {msg}", kw if kw else "")


# ---------- 1. Parse the one-shot prompt (no LLM = zero tokens) ----------
def parse_prompt(text, need_city=True):
    t = text.lower()
    today = dt.date.today()
    check_in = today
    if "tomorrow" in t:
        check_in = today + dt.timedelta(days=1)
    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        check_in = dt.date.fromisoformat(m.group(1))
    nights = int((re.search(r"(\d+)\s*nights?", t) or [None, 1])[1])
    guests = int((re.search(r"(\d+)\s*(?:guests?|adults?|people|persons?)", t) or [None, 1])[1])
    city = re.search(r"\b(?:in|at)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)", text)
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


def load_hotels_json(path):
    """Teammate's scraper output: [{name,address,phone,nightlyPrice,totalPrice,...}]."""
    raw = json.load(open(path))
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


def call_hotel(h, q):
    r = requests.post("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", headers=XI, timeout=20, json={
        "agent_id": E["ELEVENLABS_AGENT_ID"], "agent_phone_number_id": E["ELEVENLABS_PHONE_NUMBER_ID"],
        "to_number": ("+" + re.sub(r"\D", "", E["TEST_NUMBER"])) if E.get("TEST_NUMBER", "").strip() else h["phone"],
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
        time.sleep(3)
        c = requests.get(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}", headers=XI, timeout=15).json()
        if c.get("status") in ("done", "failed"):
            break
    else:
        hang_up(sid)
        raise RuntimeError(f"{h['name']}: timeout")
    ACTIVE.pop(cid, None)
    LOG.append({"conv": cid, "hotel": h["name"], "metadata": c.get("metadata")})  # cost/duration for Learnings
    d = {k: (v or {}).get("value") for k, v in (c.get("analysis", {}).get("data_collection_results") or {}).items()}
    if not d.get("reservation_number"):
        raise RuntimeError(f"{h['name']}: no reservation ({c.get('status')})")
    return {"hotel": d.get("hotel_name") or h["name"], "address": d.get("hotel_address") or h["address"],
            "phone": h["phone"], "number": d["reservation_number"],
            "price": d.get("price") or h["price"], "date": q["check_in"]}


# ---------- 4. Email ----------
def send_email(res):
    m = EmailMessage()
    m["Subject"] = f"Team # {E.get('TEAM_NUMBER', '?')} - Hotel Reservation Confirmed!"
    m["From"], m["To"] = E["SMTP_USER"], E["RESULT_EMAIL"]
    m.set_content(f"Hotel Name: {res['hotel']}\nAddress: {res['address']}\nPhone: {res['phone']}\n"
                  f"Reservation #: {res['number']}\nReservation Date: {res['date']}\nPrice: {res['price']}\n")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(E["SMTP_USER"], E["SMTP_APP_PASSWORD"])
        s.send_message(m)


def main():
    args = sys.argv[1:]
    search_only = "--search-only" in args
    hotels_file = args[args.index("--hotels") + 1] if "--hotels" in args else None
    skip = {"--search-only", "--hotels", hotels_file}
    prompt = " ".join(a for a in args if a not in skip)
    q = parse_prompt(prompt, need_city=not hotels_file)
    log("parsed", **q)
    hotels = load_hotels_json(hotels_file) if hotels_file else find_hotels(q)
    for h in hotels:
        log("hotel", **h)
    if search_only or not hotels:
        return
    with ThreadPoolExecutor(len(hotels)) as ex:
        futs = [ex.submit(call_hotel, h, q) for h in hotels]
        for f in as_completed(futs):
            try:
                res = f.result()
            except Exception as e:
                log(f"failed: {e}")
                continue
            for sid in list(ACTIVE.values()):  # stop the other calls: saves minutes + tokens
                hang_up(sid)
            log("BOOKED", **res)
            try:
                send_email(res)
                log("email sent")
            except Exception as e:
                log(f"EMAIL FAILED: {e}")  # booking data is in the log line above
            break
        else:
            log("no booking obtained")
    json.dump(LOG, open(f"run_{int(T0)}.json", "w"), indent=1, default=str)
    os._exit(0)


if __name__ == "__main__":
    main()