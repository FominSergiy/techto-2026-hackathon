"""Send the booking confirmation email from result.json (Gmail SMTP).

Usage:
  python send_result_email.py                # reads result.json, sends to RESULT_EMAIL
  python send_result_email.py other.json     # another file
  python send_result_email.py --dry-run      # print the email, send nothing
  python send_result_email.py --to me@x.com  # override the recipient
"""
import os, sys, json, smtplib
from email.message import EmailMessage
from dotenv import load_dotenv

load_dotenv(override=True)
E = os.environ


def build_email(res, to):
    m = EmailMessage()
    m["Subject"] = f"Team # {E.get('TEAM_NUMBER', '?')} - Hotel Reservation Confirmed!"
    m["From"], m["To"] = E.get("SMTP_USER", ""), to
    m.set_content(
        f"Hotel Name: {res.get('hotel', '')}\n"
        f"Address: {res.get('address', '')}\n"
        f"Phone: {res.get('phone', '')}\n"
        f"Reservation #: {res.get('number', '')}\n"
        f"Reservation Date: {res.get('date', '')}\n"
        f"Price: {res.get('price', '')}\n")
    return m


def send(m):
    for k in ("SMTP_USER", "SMTP_APP_PASSWORD"):
        if not E.get(k):
            raise SystemExit(f"{k} missing in .env")
    pwd = E["SMTP_APP_PASSWORD"].replace(" ", "")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as s:
            s.login(E["SMTP_USER"], pwd)
            s.send_message(m)
    except smtplib.SMTPAuthenticationError:
        raise SystemExit("Gmail login failed: use an App Password (Google account > Security > App passwords)")
    except (OSError, smtplib.SMTPException):  # port 465 blocked -> STARTTLS on 587
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as s:
            s.starttls()
            s.login(E["SMTP_USER"], pwd)
            s.send_message(m)


if __name__ == "__main__":
    args = sys.argv[1:]
    to = E.get("RESULT_EMAIL", "")
    if "--to" in args:
        to = args[args.index("--to") + 1]
    files = [a for a in args if a.endswith(".json")]
    res = json.load(open(files[0] if files else "result.json"))
    msg = build_email(res, to)
    if "--dry-run" in args:
        print(f"To: {msg['To']}\nFrom: {msg['From']}\nSubject: {msg['Subject']}\n\n{msg.get_content()}")
    else:
        if not to:
            raise SystemExit("RESULT_EMAIL missing in .env (or pass --to address)")
        send(msg)
        print(f"email sent to {to}")