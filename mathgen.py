"""Money Math: everyday dollar problems generated on the server, so they never run out and every
answer is computed rather than typed in. Each problem has one right answer, three plausible wrong
ones (the usual slips: the discount instead of the price, a year instead of a month) and a "why".

make(rng, n) returns n problems from n different templates, shaped like trivia items.
"""
import math


def usd(x):
    x = round(x + 1e-9, 2)
    return "${:,.0f}".format(x) if abs(x - round(x)) < 1e-9 else "${:,.2f}".format(x)


def _discount(r):
    price = r.choice([40, 60, 80, 120, 150, 200, 240, 300])
    pct = r.choice([10, 15, 20, 25, 30, 40])
    thing = r.choice(["jacket", "pair of sneakers", "lamp", "blender", "suitcase", "desk chair"])
    off = price * pct / 100
    pay = price - off
    wrong = [off, price - pct, pay + price * 0.05, pay - price * 0.05, price * (100 - pct - 10) / 100]
    return ("A $%d %s is %d%% off. What do you pay?" % (price, thing, pct), pay, wrong,
            "%d%% of $%d is %s, so you pay $%d minus %s = %s." % (pct, price, usd(off), price, usd(off), usd(pay)))


def _tip(r):
    bill = r.choice([24, 36, 45, 52, 64, 80, 85, 120])
    pct = r.choice([15, 18, 20])
    tip = bill * pct / 100
    wrong = [bill * (pct - 5) / 100, bill * (pct + 5) / 100, bill * pct / 1000, tip * 2]
    ten = bill / 10
    how = {15: "10%% is %s and 5%% is half that, %s, so 15%% is %s." % (usd(ten), usd(ten / 2), usd(tip)),
           20: "10%% is %s; double it for 20%%: %s." % (usd(ten), usd(tip)),
           18: "$%d x 0.18 = %s. Quick check: a bit under 20%%, which is %s." % (bill, usd(tip), usd(bill * 0.2))}[pct]
    return ("Your dinner bill is $%d. How much is %s %d%% tip?" % (bill, "an" if pct == 18 else "a", pct), tip, wrong, how)


def _split(r):
    each = r.choice([12, 15, 18, 22, 24, 27, 35])
    n = r.choice([3, 4, 5, 6])
    total = each * n
    wrong = [each + 3, each - 3, total / (n + 1), total / (n - 1), each + 5]
    return ("Dinner for %d comes to $%d. Split evenly, what does each person pay?" % (n, total), each, wrong,
            "$%d / %d people = %s each." % (total, n, usd(each)))


def _interest(r):
    p = r.choice([500, 1000, 2000, 2500, 5000, 10000])
    rate = r.choice([2, 3, 4, 5])
    i = p * rate / 100
    wrong = [p * rate / 1000, p * rate / 10, p * (rate + 1) / 100, p * (rate - 1) / 100]
    return ("A savings account pays %d%% a year. How much interest does $%s earn in one year?" % (rate, "{:,}".format(p)), i, wrong,
            "%d%% of %s is %s x 0.0%d = %s." % (rate, usd(p), usd(p), rate, usd(i)))


def _rule72(r):
    rate = r.choice([3, 4, 6, 8, 9, 12])
    years = 72 // rate
    cand = [years * 2, max(2, years // 2), years + 4, years + 7, rate * 3]
    fmt = lambda y: "%d years" % y
    return ("Your money grows %d%% a year. About how many years until it doubles?" % rate, years, cand,
            "Rule of 72: 72 / %d = about %d years." % (rate, years), fmt)


def _hourly(r):
    h = r.choice([15, 18, 20, 25, 30, 40, 50])
    year = h * 2080
    wrong = [h * 1000, h * 52 * 20, h * 160, round(year * 1.5)]
    return ("You earn $%d an hour, 40 hours a week, all year. About how much is that a year?" % h, year, wrong,
            "40 hours x 52 weeks = 2,080 hours. $%d x 2,080 = %s. Shortcut: double the hourly rate and add three zeros." % (h, usd(year)))


def _card(r):
    bal = r.choice([600, 1000, 1500, 2400, 3000])
    apr = r.choice([18, 24, 30])
    month = bal * apr / 1200
    wrong = [bal * apr / 100, bal * apr / 2400, bal * apr / 600, month + 10]
    return ("Your card's APR is %d%%. About how much interest does a $%s balance add in one month?" % (apr, "{:,}".format(bal)), month, wrong,
            "%d%% a year is %s%% a month. %s x %s%% = %s." % (apr, ("%g" % (apr / 12)), usd(bal), ("%g" % (apr / 12)), usd(month)))


def _goal(r):
    per = r.choice([100, 150, 200, 250, 300, 500])
    months = r.choice([6, 8, 10, 12, 15, 18, 24])
    goal = per * months
    cand = [months + 2, months - 2, months * 2, months + 6, max(2, months // 2)]
    fmt = lambda m: "%d months" % m
    return ("You save $%d a month. How many months until you have $%s for a trip?" % (per, "{:,}".format(goal)), months, cand,
            "$%s / $%d a month = %d months." % ("{:,}".format(goal), per, months), fmt)


def _raise(r):
    old = r.choice([40, 50, 80, 100, 200, 250])
    pct = r.choice([10, 20, 25, 50])
    new = old * (100 + pct) / 100
    cand = [pct + 5, pct - 5, pct * 2, int(round(100 * (new - old) / new))]
    fmt = lambda p: "%d%%" % p
    return ("A monthly bill rises from $%d to %s. By what percent did it go up?" % (old, usd(new)), pct, cand,
            "It went up %s. %s / $%d = %d%%. Always divide by the old price." % (usd(new - old), usd(new - old), old, pct), fmt)


TEMPLATES = {"discount": _discount, "tip": _tip, "split": _split, "interest": _interest, "rule72": _rule72,
             "hourly": _hourly, "card": _card, "goal": _goal, "raise": _raise}
TEMPLATE_IDS = ["m-" + k for k in TEMPLATES]


def problem(r, name):
    out = TEMPLATES[name](r)
    q, a, cands, why = out[:4]
    fmt = out[4] if len(out) > 4 else usd
    right = fmt(a)
    wrong = []
    for c in cands:
        if c is None or c <= 0:
            continue
        s = fmt(c)
        if s != right and s not in wrong:
            wrong.append(s)
    r.shuffle(wrong)
    wrong = wrong[:3]
    bump = 1
    while len(wrong) < 3:  # rare: pad with near misses
        s = fmt(a * (1 + 0.1 * bump)) if fmt is usd else fmt(a + bump)
        bump += 1
        if s != right and s not in wrong:
            wrong.append(s)
    return {"id": "m-" + name, "q": q, "a": right, "w": wrong, "why": why}


def make(r, n):
    names = sorted(TEMPLATES)
    return [problem(r, name) for name in r.sample(names, min(n, len(names)))]


if __name__ == "__main__":
    import random
    rng = random.Random(1)
    for _ in range(3000):
        for it in make(rng, 4):
            assert it["a"] not in it["w"] and len(set(it["w"])) == 3, it
            assert all("-" not in w for w in it["w"]), it
    for it in make(random.Random(7), 9):
        print(it["q"], "|", it["a"], "|", " / ".join(it["w"]), "|", it["why"])
