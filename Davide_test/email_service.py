"""Confirmation email: the last step of a run (spec: "deliver a receipt to the provided email address").

Providers (pick with EMAIL_PROVIDER, else auto: resend if RESEND_API_KEY is set, otherwise smtp):
  smtp   - Gmail SMTP with an app password (SMTP_USER, SMTP_APP_PASSWORD). Sends to any address.
  resend - Resend HTTP API (RESEND_API_KEY, EMAIL_FROM). Needs a verified domain to send to
           addresses other than your own Resend login.

Usage:
  python email_service.py --dry-run            # print the sample email, send nothing
  python email_service.py --test [to@x.com]    # send the sample email (pre-flight check);
                                               # SAMPLE_CONVERSATION_ID=conv_... also attaches that call
  python email_service.py --send payload.json  # send a real receipt; "-" reads JSON from stdin
                                               # prints the result as JSON; exit 1 + error JSON on failure

Call recording + transcript: if the payload has a `conversation_id`, the ElevenLabs recording (mp3) is attached
and the transcript goes at the end of the body. Neither blocks the receipt: if one can't be fetched (or the send
with the mp3 fails), the email goes without it.
"""
import os, re, sys, json, time, base64, smtplib, datetime as dt, requests
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from email.utils import make_msgid
from dotenv import load_dotenv

load_dotenv()
E = os.environ

TEAM_MEMBERS = ["Davide - galluzzodavide01@gmail.com", "Mykhailio - babichmichail@gmail.com",
                "Sergiy - sergiy.fomin@outlook.com"]

VERBAL = {"verbal_booking": "Verbal confirmation",
          "verbal_availability": "Verbal confirmation of availability"}


def confirmation_field(res):
    """Spec field 1. Uses the reservation number, else the spec's proposed verbal format."""
    if res.get("number"):
        return str(res["number"])
    label = VERBAL.get(res.get("type"))
    if not label:
        return None
    who = res.get("receptionist") or "front desk"
    at = res.get("call_time") or dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"{label} from {who} at {res.get('hotel', 'the hotel')}, call at {at}"


def fmt_price(p):
    if isinstance(p, (int, float)):
        return f"{p:,.2f} {E.get('CURRENCY', 'CAD')}"
    return str(p) if p else None


def build(res, audio_name=None, transcript=None):
    """Returns (subject, body). Raises ValueError if a field the spec requires is missing.
    audio_name: filename of the attached call recording (None = not attached).
    transcript: call transcript text, added after the team footer."""
    fields = {"Reservation #": confirmation_field(res), "Price": fmt_price(res.get("price")),
              "Reservation Date": res.get("date"), "Address": res.get("address")}
    missing = [k for k, v in fields.items() if not v]
    if missing:
        raise ValueError(f"missing required email fields: {', '.join(missing)}")
    lines = [f"Hotel Name: {res.get('hotel', '')}", f"Address: {fields['Address']}",
             f"Phone: {res.get('phone', '')}", f"Reservation #: {fields['Reservation #']}",
             f"Reservation Date: {fields['Reservation Date']}"]
    if res.get("check_out"):
        lines.append(f"Check-out Date: {res['check_out']}")
    lines.append(f"Price: {fields['Price']}")
    if audio_name:
        lines.append(f"Call recording: attached ({audio_name})")
    elif res.get("conversation_id"):
        lines.append(f"Call recording: unavailable (ElevenLabs conversation {res['conversation_id']})")
    lines += ["", f"Team members: Team {E.get('TEAM_NUMBER') or 4}", *TEAM_MEMBERS]
    if transcript:
        lines += ["", "Call transcript:", transcript]
    elif res.get("conversation_id"):
        lines += ["", "Call transcript: unavailable"]
    subject = f"Team # {E.get('TEAM_NUMBER', '?')} - Hotel Reservation Confirmed!"
    return subject, "\n".join(lines) + "\n"


def fetch_call_audio(cid):
    """ElevenLabs call recording as mp3 bytes, or None. The audio can lag a few seconds behind
    status "done", so retry (AUDIO_ATTEMPTS, 2 s apart) but never wait past AUDIO_MAX_WAIT seconds."""
    deadline = time.time() + float(E.get("AUDIO_MAX_WAIT", 10))
    for i in range(int(E.get("AUDIO_ATTEMPTS", 3))):
        left = deadline - time.time()
        if left <= 0:
            break
        r = requests.get(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}/audio", timeout=max(left, 1),
                         headers={"xi-api-key": E["ELEVENLABS_API_KEY"]})
        if r.ok and r.content:
            return r.content
        if r.status_code in (401, 403, 404, 422) or time.time() + 2 > deadline:
            break
        time.sleep(2)
    return None


def fetch_transcript(cid):
    """ElevenLabs call transcript as text, one "[m:ss] Alex|Hotel: ..." line per spoken turn, or None."""
    r = requests.get(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}", timeout=float(E.get("AUDIO_MAX_WAIT", 10)),
                     headers={"xi-api-key": E["ELEVENLABS_API_KEY"]})
    r.raise_for_status()
    lines = []
    for turn in r.json().get("transcript") or []:
        msg = (turn.get("message") or "").strip()
        if not msg:  # tool calls have no spoken text
            continue
        secs = int(turn.get("time_in_call_secs") or 0)
        who = "Alex" if turn.get("role") == "agent" else "Hotel"
        lines.append(f"[{secs // 60}:{secs % 60:02d}] {who}: {msg}")
    return "\n".join(lines) or None


def call_audio(res):
    """[(filename, bytes)] for the payload's conversation_id, [] if none or on any failure."""
    cid = res.get("conversation_id")
    try:
        data = fetch_call_audio(cid)
    except Exception as e:
        print(f"call recording not attached ({cid}): {e}", file=sys.stderr)
        return []
    if not data:
        print(f"call recording not attached ({cid}): not available", file=sys.stderr)
        return []
    slug = re.sub(r"[^a-z0-9]+", "-", (res.get("hotel") or "hotel").lower()).strip("-")
    return [(f"call-{slug}-{cid}.mp3", data)]


def call_transcript(res):
    """Transcript text for the payload's conversation_id, None on any failure."""
    cid = res.get("conversation_id")
    try:
        text = fetch_transcript(cid)
    except Exception as e:
        print(f"call transcript not added ({cid}): {e}", file=sys.stderr)
        return None
    if not text:
        print(f"call transcript not added ({cid}): empty", file=sys.stderr)
    return text


def call_extras(res):
    """(files, transcript) for the payload's conversation_id, both fetched in parallel. ([], None) if none."""
    if not res.get("conversation_id"):
        return [], None
    with ThreadPoolExecutor(2) as ex:
        audio, text = ex.submit(call_audio, res), ex.submit(call_transcript, res)
        return audio.result(), text.result()


def _send_smtp(to, subject, body, attachments=()):
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, E.get("EMAIL_FROM") or E["SMTP_USER"], to
    m["Message-ID"] = make_msgid()
    if E.get("EMAIL_BCC"):
        m["Bcc"] = E["EMAIL_BCC"]
    m.set_content(body)
    for name, data in attachments:
        m.add_attachment(data, maintype="audio", subtype="mpeg", filename=name)
    with smtplib.SMTP_SSL(E.get("SMTP_HOST", "smtp.gmail.com"), int(E.get("SMTP_PORT", 465)), timeout=15) as s:
        s.login(E["SMTP_USER"], E["SMTP_APP_PASSWORD"])
        s.send_message(m)
    return m["Message-ID"]


def _send_resend(to, subject, body, attachments=()):
    payload = {"from": E.get("EMAIL_FROM", "Hotel Agent <onboarding@resend.dev>"), "to": [to],
               "subject": subject, "text": body}
    if E.get("EMAIL_BCC"):
        payload["bcc"] = [E["EMAIL_BCC"]]
    if attachments:
        payload["attachments"] = [{"filename": n, "content": base64.b64encode(d).decode()} for n, d in attachments]
    r = requests.post("https://api.resend.com/emails", timeout=15, json=payload,
                      headers={"Authorization": f"Bearer {E['RESEND_API_KEY']}"})
    if not r.ok:
        raise RuntimeError(f"resend HTTP {r.status_code}: {r.text[:300]}")
    return r.json().get("id")


SENDERS = {"smtp": _send_smtp, "resend": _send_resend}


def provider():
    return E.get("EMAIL_PROVIDER") or ("resend" if E.get("RESEND_API_KEY") else "smtp")


def send_confirmation(res, to=None, attempts=2):
    """Validate, build and send the receipt (with the call recording and transcript when they can be fetched).
    Returns {provider, id, to, ms, audio, transcript, extras_ms}; raises on final failure."""
    to = to or E["RESULT_EMAIL"]
    build(res)  # validate the required fields before spending time on the recording
    t = time.time()
    files, transcript = call_extras(res)
    extras_ms = int((time.time() - t) * 1000)
    name, t = provider(), time.time()
    tries = 0
    while True:
        subject, body = build(res, files[0][0] if files else None, transcript)
        try:
            msg_id = SENDERS[name](to, subject, body, files)
            return {"provider": name, "id": msg_id, "to": to, "ms": int((time.time() - t) * 1000),
                    "audio": files[0][0] if files else None, "transcript": bool(transcript), "extras_ms": extras_ms}
        except Exception as e:
            if files:  # the receipt matters more than the recording: retry without it (doesn't use up a try)
                print(f"send with recording failed, retrying without it: {e}", file=sys.stderr)
                files = []
                continue
            tries += 1
            if tries >= attempts:
                raise
            time.sleep(1)


SAMPLE = {"hotel": "Test Hotel Toronto", "address": "123 King St W, Toronto, ON M5H 1A1",
          "phone": "+14165550100", "number": "TEST-12345", "price": 129.0,
          "date": dt.date.today().isoformat(), "check_out": (dt.date.today() + dt.timedelta(days=1)).isoformat(),
          "conversation_id": E.get("SAMPLE_CONVERSATION_ID")}

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--dry-run" in args:
        subject, body = build(SAMPLE)
        print(f"provider: {provider()}\nto: {E.get('RESULT_EMAIL', '(RESULT_EMAIL not set)')}\n"
              f"subject: {subject}\n\n{body}")
    elif "--test" in args:
        rest = [a for a in args if a != "--test"]
        print(send_confirmation(SAMPLE, to=rest[0] if rest else None))
    elif "--send" in args:
        src = args[args.index("--send") + 1] if len(args) > args.index("--send") + 1 else "-"
        payload = json.load(sys.stdin if src == "-" else open(src))
        try:
            print(json.dumps(send_confirmation(payload, to=payload.get("to"))))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
    else:
        print(__doc__)
