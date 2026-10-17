"""Offline tests for parse_prompt dates: python Davide_test/test_parse_prompt.py (no calls, no network)."""
import datetime as dt, os, sys

sys.path.insert(0, os.path.dirname(__file__))
import main

TODAY = dt.date(2026, 9, 15)  # fixed so the tests don't depend on the real date


class FakeDate(dt.date):
    @classmethod
    def today(cls):
        return TODAY


main.dt.date = FakeDate

CASES = [  # prompt, check_in, check_out, nights
    ("Oct 1 to Oct 10 in Toronto", "2026-10-01", "2026-10-10", 9),
    ("October 1st - October 10th in Toronto", "2026-10-01", "2026-10-10", 9),
    ("Oct 1-10 in Toronto", "2026-10-01", "2026-10-10", 9),
    ("Oct 1 to 10th, 2 guests in Toronto", "2026-10-01", "2026-10-10", 9),
    ("from 1 October until 10 October in Toronto", "2026-10-01", "2026-10-10", 9),
    ("1-10 October in Toronto", "2026-10-01", "2026-10-10", 9),
    ("Oct 1 to 10 Oct in Toronto", "2026-10-01", "2026-10-10", 9),
    ("2026-11-20 to 2026-11-23 in Toronto", "2026-11-20", "2026-11-23", 3),
    ("Oct 20 for 2 nights in Toronto", "2026-10-20", "2026-10-22", 2),
    ("Oct 20 for two nights, 2 guests in Toronto", "2026-10-20", "2026-10-22", 2),
    ("Oct 20 in Toronto", "2026-10-20", "2026-10-21", 1),
    ("Oct 1 2 guests in Toronto", "2026-10-01", "2026-10-02", 1),  # "2 guests" is not a date
    ("Dec 30 to Jan 2 in Toronto", "2026-12-30", "2027-01-02", 3),
    ("Sep 1 to Sep 3 in Toronto", "2027-09-01", "2027-09-03", 2),  # past this year -> next year
    ("tomorrow in Toronto", "2026-09-16", "2026-09-17", 1),
    ("tonight in Toronto", "2026-09-15", "2026-09-16", 1),
    ("2026-11-23 to 2026-11-20 in Toronto", "2026-11-23", "2026-11-24", 1),  # check-out before check-in: ignored
    ("I'll decide on Oct 5 in Toronto", "2026-10-05", "2026-10-06", 1),  # "decide" is not December
]

fails = 0
for prompt, cin, cout, nights in CASES:
    q = main.parse_prompt(prompt)
    got = (q["check_in"], q["check_out"], q["nights"])
    ok = got == (cin, cout, nights) and q["city"] == "Toronto"
    fails += not ok
    print("ok  " if ok else "FAIL", f"{prompt!r:50} -> {got} city={q['city']!r}" + ("" if ok else f"  want {(cin, cout, nights)}"))
print(f"\n{len(CASES) - fails}/{len(CASES)} passed")
sys.exit(1 if fails else 0)
