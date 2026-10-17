"""Confirmation email: the last step of a run (spec: "deliver a receipt to the provided email address").

Providers (pick with EMAIL_PROVIDER, else auto: resend if RESEND_API_KEY is set, otherwise smtp):
  smtp   - Gmail SMTP with an app password (SMTP_USER, SMTP_APP_PASSWORD). Sends to any address.
  resend - Resend HTTP API (RESEND_API_KEY, EMAIL_FROM). Needs a verified domain to send to
           addresses other than your own Resend login.

Usage:
  python email_service.py --dry-run            # print the sample email, send nothing
  python email_service.py --test [to@x.com]    # send the sample email (pre-flight check)
  python email_service.py --send payload.json  # send a real receipt; "-" reads JSON from stdin
                                               # prints the result as JSON; exit 1 + error JSON on failure
"""
import os, sys, json, time, smtplib, datetime as dt, requests
from email.message import EmailMessage
from email.utils import make_msgid
from dotenv import load_dotenv

load_dotenv()
E = os.environ

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


def build(res):
    """Returns (subject, body). Raises ValueError if a field the spec requires is missing."""
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
    subject = f"Team # {E.get('TEAM_NUMBER', '?')} - Hotel Reservation Confirmed!"
    return subject, "\n".join(lines) + "\n"


def _send_smtp(to, subject, body):
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, E.get("EMAIL_FROM") or E["SMTP_USER"], to
    m["Message-ID"] = make_msgid()
    if E.get("EMAIL_BCC"):
        m["Bcc"] = E["EMAIL_BCC"]
    m.set_content(body)
    with smtplib.SMTP_SSL(E.get("SMTP_HOST", "smtp.gmail.com"), int(E.get("SMTP_PORT", 465)), timeout=15) as s:
        s.login(E["SMTP_USER"], E["SMTP_APP_PASSWORD"])
        s.send_message(m)
    return m["Message-ID"]


def _send_resend(to, subject, body):
    payload = {"from": E.get("EMAIL_FROM", "Hotel Agent <onboarding@resend.dev>"), "to": [to],
               "subject": subject, "text": body}
    if E.get("EMAIL_BCC"):
        payload["bcc"] = [E["EMAIL_BCC"]]
    r = requests.post("https://api.resend.com/emails", timeout=15, json=payload,
                      headers={"Authorization": f"Bearer {E['RESEND_API_KEY']}"})
    if not r.ok:
        raise RuntimeError(f"resend HTTP {r.status_code}: {r.text[:300]}")
    return r.json().get("id")


SENDERS = {"smtp": _send_smtp, "resend": _send_resend}


def provider():
    return E.get("EMAIL_PROVIDER") or ("resend" if E.get("RESEND_API_KEY") else "smtp")


def send_confirmation(res, to=None, attempts=2):
    """Validate, build and send the receipt. Returns {provider, id, to, ms}; raises on final failure."""
    to = to or E["RESULT_EMAIL"]
    subject, body = build(res)
    name, t = provider(), time.time()
    for i in range(attempts):
        try:
            msg_id = SENDERS[name](to, subject, body)
            return {"provider": name, "id": msg_id, "to": to, "ms": int((time.time() - t) * 1000)}
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(1)


SAMPLE = {"hotel": "Test Hotel Toronto", "address": "123 King St W, Toronto, ON M5H 1A1",
          "phone": "+14165550100", "number": "TEST-12345", "price": 129.0,
          "date": dt.date.today().isoformat(), "check_out": (dt.date.today() + dt.timedelta(days=1)).isoformat()}

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
