"""Server-run games. Every scoring decision happens here.

Browsers only send actions (spin, answer, guess, code). The server keeps the answers,
measures time on its own clock, judges code in a sandbox, picks questions that fit each
player's level, and totals rounds, streaks, jackpots, Elo, solo bests and daily plays.

Game kinds:
  solo     one player, 5 spins, counts toward the daily free limit
  daily    the Daily Duel: one seeded run per day, identical for everyone, free
  duel     random matchmaking; after BOT_WAIT seconds alone, a practice bot steps in
  friend   a private room opened by a share link; friendly, so ratings do not move
"""
import collections
import json
import math
import os
import random
import secrets
import threading
import time

import judge
import mathgen
from accounts import today

ROUNDS = 5
WHEEL = ["trivia", "guess", "scam", "math", "jack", "code", "myth", "first", "trivia", "chaos"]  # same order as js/game.js
CATS = ["code", "guess", "trivia", "scam", "math", "myth", "first"]
ROUND_MAX = 300  # the most one round pays before jackpots and bonuses, whatever its question count
PENALTY = 30     # Sudden Death: points lost per wrong answer
GUESS_N = 4      # Ballpark estimates per round
# Question rounds. n: questions per round, time / fast: seconds each (normal / Speed round),
# fixed: the same two buttons every time, ask: the prompt when the item has none of its own.
QCATS = {
    "trivia": {"n": 5, "time": 10, "fast": 5, "tag": "%d/%d right", "ev": "bigBrain", "bot": 0.62},
    "scam": {"n": 5, "time": 12, "fast": 6, "tag": "%d/%d spotted", "ev": "scamBuster", "bot": 0.7,
             "fixed": ["Scam", "Legit"], "ask": "Scam or legit?", "relay": "Judged message "},
    "myth": {"n": 5, "time": 10, "fast": 5, "tag": "%d/%d called", "ev": "mythBuster", "bot": 0.66,
             "fixed": ["Myth", "Fact"], "kicker": "Myth or fact?", "relay": "Judged statement "},
    "first": {"n": 5, "time": 8, "fast": 5, "tag": "%d/%d in order", "ev": "timeLord", "bot": 0.65,
              "ask": "Which came first?", "relay": "Picked pair "},
    "math": {"n": 4, "time": 15, "fast": 8, "tag": "%d/%d solved", "ev": "mathWhiz", "bot": 0.6, "relay": "Solved problem "},
}
HINT_COST = 0.2  # each code hint takes 20% off that round's points
TARGET = 0.65     # aim for questions a player gets right about 65% of the time
SPIN_WAIT = 30    # seconds before an idle spinner's wheel spins itself
SPIN_ANIM = 6.5   # wheel animation on the client
REVEAL = 10.5     # spin animation plus the reveal countdown
NEXT_WAIT = 25    # result screen in a duel
GRACE = 25        # seconds a disconnected player has to come back
LAG = 0.8         # network allowance on answer deadlines
GAP = 2.8         # time to read the explanation after each question
BOT_WAIT = 12     # seconds alone in the queue before a practice bot steps in
ROOM_TTL = 1800   # a friend challenge link stays open for 30 minutes
REMATCH_WAIT = 45  # seconds after a duel when either player can offer a rematch
BOT_NAMES = ["Byte Bot", "Quiz Bot", "Pixel Bot", "Nova Bot", "Echo Bot"]
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class Seat:
    """One player's place in the queue or a game. The id is the secret ticket."""

    def __init__(self, key, profile, bot=False):
        self.id = secrets.token_urlsafe(18)
        self.key = key
        self.name, self.avatar = profile["name"], profile["avatar"]
        self.rating, self.rank = profile["rating"], profile["rank"]
        self.pro = bool(profile["plan"]["pro"])
        self.guest = bool(profile.get("guest"))
        self.bot = bot
        self.log = []
        self.cond = threading.Condition()
        self.streams = 1 if bot else 0  # bots never disconnect
        self.seen = time.time()
        self.queued_at = time.time()
        self.room = None
        self.game = None
        self.idx = 0
        self.done = False
        self.relays = []

    def push(self, event, data):
        if self.bot:
            return
        with self.cond:
            self.log.append((len(self.log) + 1, event, data))
            self.cond.notify_all()

    def close(self):
        self.done = True
        with self.cond:
            self.cond.notify_all()

    def info(self):
        return {"name": self.name, "avatar": self.avatar, "rating": self.rating if self.rank else None,
                "rank": self.rank, "pro": self.pro, "guest": self.guest, "bot": self.bot}


class Game:
    def __init__(self, seats, solo, rng):
        n = len(seats)
        self.seats, self.solo, self.rng = seats, solo, rng
        self.round, self.rounds = 1, ROUNDS
        self.spinner = 0 if solo else rng.randrange(2)
        self.mult = 1
        self.phase = "spin"
        self.deadline = time.time() + SPIN_WAIT + 4
        self.spin_ready = time.time() + (0 if solo else 2.5)
        self.at = 0.0
        self.scores, self.streak = [0] * n, [0] * n
        self.raw, self.tags, self.ev = [0] * n, [[] for _ in seats], [{} for _ in seats]
        self.ready = [False] * n
        self.ch = {}
        self.daily = None
        self.friendly = False
        self.bot = next((s for s in seats if s.bot), None)
        self.bot_plan = {}
        self.stats = [collections.Counter() for _ in seats]  # what each player did, for quests
        self.earned = [set() for _ in seats]                 # badges earned this game
        self.rematch = set()
        self.rematch_until = 0

    def send(self, event, data):
        for s in self.seats:
            s.push(event, data)

    def others(self, seat):
        return [s for s in self.seats if s is not seat]


class Engine:
    def __init__(self, store, content):
        self.store = store
        topics = content["topics"]
        self.trivia = [dict(item, topic=topics.get(t, t), tkey=t) for t, items in content["trivia"].items() for item in items]
        self.guess = [dict(item, topic=topics.get(item["t"], item["t"]), tkey=item["t"]) for item in content["guess"]]
        self.scams = [dict(item, topic=topics.get("safety", "Scam spotting"), tkey="safety") for item in content.get("scam", [])]
        self.topics = topics
        self.banks = {
            "trivia": self.trivia,
            "scam": self.scams,
            "myth": [dict(item, topic=topics.get(item["t"], item["t"]), tkey=item["t"]) for item in content.get("myth", [])],
            "first": [dict(item, topic=topics.get(item["t"], item["t"]), tkey=item["t"]) for item in content.get("first", [])],
        }
        self.code = content["code"]
        self.mods = content["mods"]
        self.lock = threading.RLock()
        self.seats = {}
        self.waiting = []
        self.rooms = {}
        self.games = []
        self.active = {}
        threading.Thread(target=self._ticker, daemon=True).start()

    # ---------------------------------------------------------- entry points

    def online(self):
        return len({s.key for s in self.seats.values() if s.streams > 0 and not s.bot})

    def room_info(self, code):
        with self.lock:
            host = self.seats.get(self.rooms.get(str(code).upper(), ""))
            if not host or host.done or host.game:
                return {"valid": False}
            return {"valid": True, "host": host.name, "avatar": host.avatar}

    def play(self, key, mode, code=None):
        """Start a game or join a queue or room. Returns (ticket, error, room_code)."""
        with self.lock:
            old = self.active.get(key)
            if old and not old.done:
                if old.game and old.game.phase == "over":
                    self._abandon(old)
                elif old.streams > 0 and time.time() - old.seen < 600:
                    return None, "already_playing", None
                else:
                    self._abandon(old)
            host = None
            if mode == "join":
                host = self.seats.get(self.rooms.get(str(code or "").upper(), ""))
                if not host or host.done or host.game:
                    return None, "expired", None
                if host.key == key:
                    return None, "own_challenge", None
            if mode == "daily":
                if self.store.daily_done(key):
                    return None, "daily_done", None
            elif not self.store.can_play(key):
                return None, "limit", None
            profile = self.store.profile(key)
            if not profile:
                return None, "no_account", None
            seat = Seat(key, profile)
            self.seats[seat.id] = seat
            self.active[key] = seat
            if mode in ("solo", "daily"):
                self._start([seat], True, daily=today()[0] if mode == "daily" else None)
                return seat.id, None, None
            if mode == "friend":
                room = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
                while room in self.rooms:
                    room = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
                self.rooms[room] = seat.id
                seat.room = room
                seat.push("waiting", {"room": room, "online": self.online() + 1})
                return seat.id, None, room
            if mode == "join":
                self.rooms.pop(host.room, None)
                host.room = None
                self._start([host, seat], False, friendly=True)
                return seat.id, None, None
            now = time.time()
            partner = next((self.seats[t] for t in self.waiting
                            if self.seats[t].key != key and (self.seats[t].streams > 0 or now - self.seats[t].seen < 10)), None)
            if partner:
                self.waiting.remove(partner.id)
                self._start([partner, seat], False)
            else:
                self.waiting.append(seat.id)
                seat.queued_at = now
                seat.push("waiting", {"online": self.online() + 1, "botIn": BOT_WAIT})
            return seat.id, None, None

    def seat(self, ticket):
        return self.seats.get(ticket) if isinstance(ticket, str) else None

    def act(self, ticket, data):
        """Handle one player action. Returns (status, payload)."""
        with self.lock:
            seat = self.seat(ticket)
            if not seat or seat.bot:
                return 404, {"error": "no_ticket"}
            now = time.time()
            seat.seen = now
            kind = data.get("type")
            if kind in ("cancel", "leave"):
                self._abandon(seat)
                return 200, {"ok": True}
            if kind == "bot":
                if seat.id in self.waiting:
                    self._start_bot(seat)
                return 200, {"ok": True}
            if kind == "rematch":
                return self._rematch_request(seat, now)
            g = seat.game
            if not g or g.phase == "over":
                return 409, {"error": "no_game"}
            if kind == "spin":
                if g.phase == "spin" and g.spinner == seat.idx and now >= g.spin_ready:
                    self._spin(g, False)
            elif kind == "answer":
                self._answer(g, seat, data, now)
            elif kind == "guess":
                self._guess(g, seat, data, now)
            elif kind == "submit":
                self._submit(g, seat, data, now)
            elif kind == "hint":
                self._hint(g, seat, now)
            elif kind == "progress":
                seat.relays = [t for t in seat.relays if now - t < 1]
                if len(seat.relays) < 4:
                    seat.relays.append(now)
                    for o in g.others(seat):
                        o.push("relay", {"round": g.round, "text": str(data.get("text", ""))[:60]})
            elif kind == "next":
                if g.phase == "result":
                    g.ready[seat.idx] = True
                    if all(g.ready):
                        self._next_turn(g)
            else:
                return 400, {"error": "bad_type"}
            return 200, {"ok": True}

    # ---------------------------------------------------------- game flow

    def _start(self, seats, solo, daily=None, friendly=False):
        rng = random.Random("duelette-daily-" + daily) if daily else random.Random()
        g = Game(seats, solo, rng)
        g.daily, g.friendly = daily, friendly
        self.games.append(g)
        for i, s in enumerate(seats):
            s.game, s.idx = g, i
            if not s.bot and not daily:
                self.store.use_play(s.key)
        players = [s.info() for s in seats]
        for s in seats:
            s.push("match", {"seat": s.idx, "players": players, "rounds": g.rounds, "round": 1, "spinner": g.spinner,
                             "solo": solo, "daily": daily, "friendly": friendly, "bot": bool(g.bot), "wheel": WHEEL,
                             "plan": self.store.quota(s.key)})

    def _start_bot(self, seat):
        if seat.id in self.waiting:
            self.waiting.remove(seat.id)
        profile = {"name": random.choice(BOT_NAMES), "avatar": "c1", "rating": None, "rank": None, "plan": {"pro": False}}
        bot = Seat("~bot-" + secrets.token_hex(4), profile, bot=True)
        self.seats[bot.id] = bot
        self._start([seat, bot], False)

    def _abandon(self, seat):
        if seat.id in self.waiting:
            self.waiting.remove(seat.id)
        if seat.room:
            self.rooms.pop(seat.room, None)
            seat.room = None
        g = seat.game
        if g and g.phase != "over":
            self._forfeit(g, seat.idx)
        elif g and g.rematch_until:
            for o in g.others(seat):
                o.push("rematch", {"state": "gone"})
        seat.close()

    def _rematch_request(self, seat, now):
        """Either player can offer a rematch for REMATCH_WAIT seconds; it starts when both want it
        (at once against the bot). Rematches are friendly, so two friends can't farm rating."""
        g = seat.game
        if not g or g.phase != "over" or g.solo or not g.rematch_until or now > g.rematch_until:
            return 409, {"error": "too_late"}
        o = g.others(seat)[0]
        if o.done:
            seat.push("rematch", {"state": "gone"})
            return 200, {"ok": True}
        if not self.store.can_play(seat.key):
            return 402, {"error": "limit", "plan": self.store.quota(seat.key)}
        g.rematch.add(seat.idx)
        if o.bot or o.idx in g.rematch:
            if not o.bot and not self.store.can_play(o.key):
                g.rematch.discard(o.idx)
                for s in g.seats:
                    s.push("rematch", {"state": "limit", "seat": o.idx})
                return 200, {"ok": True}
            if g in self.games:
                self.games.remove(g)
            seats = list(g.seats)
            for s in seats:
                s.game, s.done, s.relays = None, False, []
            self._start(seats, False, friendly=not any(s.bot for s in seats))
        else:
            o.push("rematch", {"state": "offer", "from": seat.idx})
            seat.push("rematch", {"state": "waiting"})
        return 200, {"ok": True}

    def _pick(self, items, g, n):
        """Choose n questions: the same set for everyone in a Daily Duel, otherwise near each
        player's level and avoiding ones they saw recently."""
        if g.daily:
            pool = sorted(items, key=lambda it: it["id"])
            g.rng.shuffle(pool)
            return pool[:n]
        keys = [s.key for s in g.seats if not s.bot]
        seen = self.store.recently_seen(keys)
        fresh = [it for it in items if it["id"] not in seen]
        pool = list(fresh if len(fresh) >= n else items)
        item_r = self.store.item_ratings()
        players = [self.store.topic_ratings(k) for k in keys]

        def expected(it):
            r = item_r.get(it["id"], 1000.0)
            return sum(1.0 / (1.0 + 10 ** ((r - p.get(it["tkey"], 1000.0)) / 400.0)) for p in players) / len(players)

        g.rng.shuffle(pool)
        pool.sort(key=lambda it: abs(expected(it) - TARGET))
        return g.rng.sample(pool[:max(3 * n, 9)], n)

    def _spin(self, g, auto):
        now = time.time()
        idx = g.rng.randrange(len(WHEEL))
        forced = os.environ.get("DUELETTE_FORCE_CAT", "")  # testing only
        if forced in WHEEL:
            idx = WHEEL.index(forced)
        kind = WHEEL[idx]
        base = {"round": g.round, "index": idx, "spinner": g.spinner, "auto": auto}
        if kind == "jack":
            g.mult = min(8, g.mult * 2)
            g.stats[g.spinner]["jackpots"] += 1
            g.deadline = now + SPIN_WAIT + SPIN_ANIM
            g.spin_ready = now + SPIN_ANIM
            g.send("spin", dict(base, jackpot=True, mult=g.mult))
            return
        cat, mod = kind, None
        if kind == "chaos":
            cat = g.rng.choice(CATS)
        if cat in self.banks and len(self.banks[cat]) < QCATS[cat]["n"] + 1:
            cat = "trivia"  # a bank too small for a round (the public sample content)
        if kind == "chaos" and self.mods.get(cat):
            mod = g.rng.choice(self.mods[cat])
        g.phase, g.at = "reveal", now + REVEAL
        g.ch = {"cat": cat, "mod": mod, "token": secrets.token_hex(4)}
        n = len(g.seats)
        g.raw, g.tags, g.ev = [0] * n, [[] for _ in range(n)], [{} for _ in range(n)]
        g.send("spin", dict(base, jackpot=False, mult=g.mult, cat=cat, mod=mod, startIn=int(REVEAL * 1000)))

    def _begin(self, g):
        g.phase = "play"
        ch, n = g.ch, len(g.seats)
        cat = ch["cat"]
        mod_id = ch["mod"]["id"] if ch["mod"] else ""
        if cat in QCATS:
            cfg = QCATS[cat]
            count = cfg["n"] + (1 if mod_id == "extra" else 0)
            if cat == "math":
                qs = [dict(it, topic=self.topics.get("finance", "Finance"), tkey="finance") for it in mathgen.make(g.rng, count)]
            else:
                qs = self._pick(self.banks[cat], g, count)
            ch.update(qs=qs, qtime=cfg["fast"] if mod_id == "speed" else cfg["time"], qmax=ROUND_MAX // cfg["n"],
                      penalty=PENALTY if mod_id == "sudden" else 0, right=[0] * n)
            self._send_q(g, 0)
        elif cat == "guess":
            count = GUESS_N + (1 if mod_id == "extra" else 0)
            ch.update(qs=self._pick(self.guess, g, count), qtime=8 if mod_id == "speed" else 15, qmax=ROUND_MAX / GUESS_N,
                      bull=mod_id == "bullseye", accs=[[] for _ in range(n)])
            self._send_est(g, 0)
        else:
            item = g.rng.choice(sorted(self.code, key=lambda c: c["fn"]) if g.daily else self.code)
            limit = 45 if mod_id == "half" else 90
            now = time.time()
            ch.update(item=item, limit=limit, sent=now, deadline=now + limit + 4, subs=[None] * n, codes=[""] * n, hints=[0] * n)
            g.send("code", {"round": g.round, "title": item["title"], "prompt": item["prompt"], "fn": item["fn"],
                            "args": item["args"], "tests": item["tests"], "hidden": len(item.get("hidden", [])), "limit": limit,
                            "rules": {"ban": item.get("ban", []), "noloops": mod_id == "noloops", "oneliner": mod_id == "oneliner"},
                            "hintCount": len(item.get("hints", [])), "hintCost": round(HINT_COST * 100)})

    def _tick_questions(self, g, now, close, send, finish):
        ch = g.ch
        if ch["stage"] == "q" and now > ch["deadline"]:
            close(g)
        elif ch["stage"] == "gap" and now >= ch["next_at"]:
            if ch["qi"] + 1 < len(ch["qs"]):
                send(g, ch["qi"] + 1)
            else:
                finish(g)
                self._finish_round(g)

    def _record(self, seat, item, score):
        if not seat.bot:  # bots must not move question difficulty or anyone's mastery
            self.store.record_answer(seat.key, item["id"], item["tkey"], score)

    # question rounds: trivia, scam, myth, first, math

    def _send_q(self, g, i):
        ch, now = g.ch, time.time()
        cat = ch["cat"]
        cfg = QCATS[cat]
        item = ch["qs"][i]
        if cfg.get("fixed"):
            opts = list(cfg["fixed"])
        else:
            opts = [item["a"]] + list(item["w"])
            g.rng.shuffle(opts)
        ch.update(qi=i, opts=opts, answer=opts.index(item["a"]), sent=now, deadline=now + ch["qtime"] + LAG,
                  picks=[None] * len(g.seats), gains=[0] * len(g.seats), stage="q")
        msg = {"round": g.round, "cat": cat, "i": i, "n": len(ch["qs"]), "q": cfg.get("ask") or item["q"], "topic": item["topic"],
               "opts": opts, "time": ch["qtime"]}
        if cfg.get("kicker"):
            msg["kicker"] = cfg["kicker"]
        if cat == "scam":
            msg["scam"] = {"channel": item["channel"], "from": item["from"], "body": item["body"], "context": item.get("context", "")}
        g.send("q", msg)

    def _answer(self, g, seat, data, now):
        ch = g.ch
        choice = data.get("choice")
        if (ch.get("cat") not in QCATS or ch.get("stage") != "q" or data.get("i") != ch["qi"] or ch["picks"][seat.idx] is not None
                or not isinstance(choice, int) or isinstance(choice, bool) or not 0 <= choice < len(ch["opts"]) or now > ch["deadline"]):
            return
        item = ch["qs"][ch["qi"]]
        correct = choice == ch["answer"]
        base = ch["qmax"] // 2
        speed = max(0.0, 1 - (now - ch["sent"]) / ch["qtime"])
        gain = base + round((ch["qmax"] - base) * speed) if correct else -ch["penalty"]
        ch["picks"][seat.idx], ch["gains"][seat.idx] = choice, gain
        g.raw[seat.idx] += gain
        if correct:
            ch["right"][seat.idx] += 1
            g.stats[seat.idx]["right_" + ch["cat"]] += 1
        self._record(seat, item, 1.0 if correct else 0.0)
        for o in g.others(seat):
            o.push("relay", {"round": g.round, "text": QCATS[ch["cat"]].get("relay", "Answered question ") + str(ch["qi"] + 1)})
        if all(p is not None for p in ch["picks"]):
            self._close_q(g)

    def _close_q(self, g):
        ch = g.ch
        item = ch["qs"][ch["qi"]]
        for i, p in enumerate(ch["picks"]):
            if p is None:
                self._record(g.seats[i], item, 0.0)
        ch.update(stage="gap", next_at=time.time() + GAP)
        g.send("qres", {"round": g.round, "i": ch["qi"], "answer": ch["answer"], "picks": ch["picks"],
                        "gains": ch["gains"], "why": item.get("why", "")})

    def _end_trivia(self, g):
        ch, n = g.ch, len(g.ch["qs"])
        cfg = QCATS[ch["cat"]]
        for i in range(len(g.seats)):
            g.tags[i] = [cfg["tag"] % (ch["right"][i], n)]
            g.ev[i] = {cfg["ev"]: ch["right"][i] == n}

    # estimation

    def _send_est(self, g, i):
        ch, now = g.ch, time.time()
        item = ch["qs"][i]
        ch.update(qi=i, sent=now, deadline=now + ch["qtime"] + LAG, vals=[None] * len(g.seats), pts=[0] * len(g.seats), stage="q")
        g.send("est", {"round": g.round, "i": i, "n": len(ch["qs"]), "q": item["q"], "topic": item["topic"], "unit": item["unit"],
                       "min": item["min"], "max": item["max"], "scale": item["scale"], "step": item["step"], "time": ch["qtime"]})

    def _guess(self, g, seat, data, now):
        ch = g.ch
        value = data.get("value")
        if (ch.get("cat") != "guess" or ch.get("stage") != "q" or data.get("i") != ch["qi"] or ch["vals"][seat.idx] is not None
                or not isinstance(value, (int, float)) or isinstance(value, bool) or now > ch["deadline"]):
            return
        item = ch["qs"][ch["qi"]]
        if not item["min"] <= value <= item["max"]:
            return
        pts, acc = judge.guess_points(item, value, ch["bull"])
        pts = round(pts * ch["qmax"] / 100)
        ch["vals"][seat.idx], ch["pts"][seat.idx] = value, pts
        ch["accs"][seat.idx].append(acc)
        g.raw[seat.idx] += pts
        if acc >= 0.8:
            g.stats[seat.idx]["est_close"] += 1
        self._record(seat, item, acc)
        for o in g.others(seat):
            o.push("relay", {"round": g.round, "text": "Locked in a guess"})
        if all(v is not None for v in ch["vals"]):
            self._close_est(g)

    def _close_est(self, g):
        ch = g.ch
        item = ch["qs"][ch["qi"]]
        for i, v in enumerate(ch["vals"]):
            if v is None:
                ch["accs"][i].append(0.0)
                self._record(g.seats[i], item, 0.0)
        closest = -1
        if not g.solo and all(v is not None for v in ch["vals"]):
            accs = [ch["accs"][i][-1] for i in range(2)]
            if accs[0] != accs[1] and max(accs) > 0:
                closest = 0 if accs[0] > accs[1] else 1
                bonus = round(20 * ch["qmax"] / 100)
                ch["pts"][closest] += bonus
                g.raw[closest] += bonus
        ch.update(stage="gap", next_at=time.time() + GAP)
        g.send("estres", {"round": g.round, "i": ch["qi"], "answer": item["a"], "unit": item["unit"], "vals": ch["vals"],
                          "pts": ch["pts"], "closest": closest, "why": item.get("why", ""), "scale": item["scale"],
                          "min": item["min"], "max": item["max"]})

    def _end_guess(self, g):
        for i, accs in enumerate(g.ch["accs"]):
            g.tags[i] = ["Avg accuracy %d%%" % round(100 * sum(accs) / max(1, len(accs)))]
            g.ev[i] = {"sharpshooter": any(a >= 0.95 for a in accs)}

    # code

    def _submit(self, g, seat, data, now):
        ch = g.ch
        code = data.get("code")
        if ch.get("cat") != "code" or ch["subs"][seat.idx] is not None or now > ch["deadline"] or not isinstance(code, str) or len(code) > 6000:
            return
        elapsed = min(ch["limit"], now - ch["sent"])
        ch["subs"][seat.idx] = "pending"
        ch["codes"][seat.idx] = code
        for o in g.others(seat):
            o.push("relay", {"round": g.round, "text": "Submitted their code"})
        mod_id = ch["mod"]["id"] if ch["mod"] else ""
        broken = judge.rule_break(code, ch["item"], mod_id)
        if broken:
            total = len(ch["item"]["tests"]) + len(ch["item"].get("hidden", []))
            self._code_done(g, ch["token"], seat.idx, {"passed": 0, "total": total, "error": broken}, elapsed)
            return
        token, item, idx = ch["token"], ch["item"], seat.idx

        def work():
            res = judge.run_code(code, item)
            with self.lock:
                self._code_done(g, token, idx, res, elapsed)
        threading.Thread(target=work, daemon=True).start()

    def _hint(self, g, seat, now):
        ch = g.ch
        if g.phase != "play" or ch.get("cat") != "code" or ch["subs"][seat.idx] is not None or now > ch["deadline"]:
            return
        hints = ch["item"].get("hints", [])
        used = ch["hints"][seat.idx]
        if used >= len(hints):
            return
        ch["hints"][seat.idx] = used + 1
        seat.push("hint", {"round": g.round, "i": used, "text": hints[used], "used": used + 1, "left": len(hints) - used - 1,
                           "keep": round(100 * max(0.4, 1 - HINT_COST * (used + 1)))})
        for o in g.others(seat):
            o.push("relay", {"round": g.round, "text": "Took a hint"})

    def _code_done(self, g, token, idx, res, elapsed):
        ch = g.ch
        if g.phase != "play" or ch.get("token") != token or ch["subs"][idx] not in (None, "pending"):
            return
        total = max(1, res["total"])
        solved = res["passed"] == total
        pts = round(100 * res["passed"] / total) + (round(100 * max(0.0, 1 - elapsed / ch["limit"])) if solved else 0)
        used = ch["hints"][idx]
        if used:
            pts = round(pts * max(0.4, 1 - HINT_COST * used))
        ch["subs"][idx] = res
        g.raw[idx] = pts
        if solved:
            g.stats[idx]["code_solved"] += 1
        if res.get("error") == "No submission":
            g.tags[idx] = ["No submission"]
        else:
            g.tags[idx] = ["%d/%d tests" % (res["passed"], total)] + (["Solved in %ds" % round(elapsed)] if solved else [])
        if used:
            g.tags[idx].append("%d hint%s" % (used, "" if used == 1 else "s"))
        g.ev[idx] = {"speedDemon": solved and elapsed < 25 and not used, "cleanCode": solved and not used}
        g.send("coderes", {"round": g.round, "seat": idx, "passed": res["passed"], "total": total, "solved": solved,
                           "time": round(elapsed), "pts": pts, "error": res.get("error", ""), "hints": used})
        if all(isinstance(s, dict) for s in ch["subs"]):
            self._finish_round(g)

    def _tick_code(self, g, now):
        ch = g.ch
        if now <= ch["deadline"]:
            return
        total = len(ch["item"]["tests"]) + len(ch["item"].get("hidden", []))
        for i, s in enumerate(ch["subs"]):
            if s is None or (s == "pending" and now > ch["deadline"] + 20):
                self._code_done(g, ch["token"], i, {"passed": 0, "total": total, "error": "No submission"}, ch["limit"])
                if g.phase != "play":
                    return

    # the practice bot: plays like a decent human, with human timing and human mistakes

    def _bot_guess(self, item):
        answer = float(item["a"])
        if item["scale"] == "log":
            value = answer * math.exp(random.gauss(0, 0.45))
        else:
            value = answer + random.gauss(0, float(item["tol"]) * 0.4)
        value = max(item["min"], min(item["max"], value))
        return round(round(value / item["step"]) * item["step"], 6)

    def _tick_bot(self, g, now):
        b, plan = g.bot, g.bot_plan
        if g.phase == "spin" and g.spinner == b.idx:
            key = ("spin", g.round, g.mult)
            if plan.get("k") != key:
                plan.clear()
                plan.update(k=key, at=now + random.uniform(1.5, 3.5))
            elif now >= plan["at"] and now >= g.spin_ready:
                plan.clear()
                self._spin(g, False)
        elif g.phase == "result" and not g.ready[b.idx]:
            g.ready[b.idx] = True
            if all(g.ready):
                self._next_turn(g)
        elif g.phase == "play":
            ch = g.ch
            cat = ch["cat"]
            if cat in QCATS and ch.get("stage") == "q" and ch["picks"][b.idx] is None:
                key = ("q", g.round, ch["qi"])
                if plan.get("k") != key:
                    lo, hi = (1.5, 4.0) if ch["qtime"] <= 6 else (2.5, min(10.0, ch["qtime"] - 2))
                    right = random.random() < QCATS[cat]["bot"]
                    choice = ch["answer"] if right else random.choice([i for i in range(len(ch["opts"])) if i != ch["answer"]])
                    plan.clear()
                    plan.update(k=key, at=ch["sent"] + random.uniform(lo, hi), choice=choice)
                elif now >= plan["at"]:
                    choice = plan["choice"]
                    plan.clear()
                    self._answer(g, b, {"i": ch["qi"], "choice": choice}, now)
            elif cat == "guess" and ch.get("stage") == "q" and ch["vals"][b.idx] is None:
                key = ("e", g.round, ch["qi"])
                if plan.get("k") != key:
                    plan.clear()
                    plan.update(k=key, at=ch["sent"] + random.uniform(3, max(3.5, min(10, ch["qtime"] - 1.5))),
                                value=self._bot_guess(ch["qs"][ch["qi"]]))
                elif now >= plan["at"]:
                    value = plan["value"]
                    plan.clear()
                    self._guess(g, b, {"i": ch["qi"], "value": value}, now)
            elif cat == "code" and ch["subs"][b.idx] is None:
                key = ("c", g.round)
                if plan.get("k") != key:
                    item = ch["item"]
                    if random.random() < 0.6:
                        code = item.get("model") or ""
                    else:
                        code = "function %s(%s) { return %s; }" % (item["fn"], item["args"], json.dumps(item["tests"][0][1]))
                    plan.clear()
                    plan.update(k=key, at=ch["sent"] + random.uniform(0.3, 0.8) * ch["limit"], code=code)
                elif now >= plan["at"]:
                    code = plan["code"]
                    plan.clear()
                    self._submit(g, b, {"code": code}, now)

    # rounds and endings

    def _finish_round(self, g):
        now = time.time()
        raw = [int(x) for x in g.raw]
        totals = list(raw)
        bonus = [[] for _ in g.seats]
        for i in range(len(g.seats)):
            if g.mult > 1 and totals[i] > 0:
                totals[i] *= g.mult
                bonus[i].append("Jackpot x%d" % g.mult)
        winner = -1
        if not g.solo:
            winner = -1 if raw[0] == raw[1] else (0 if raw[0] > raw[1] else 1)
            if winner >= 0:
                loser = 1 - winner
                trailing = g.scores[loser] - g.scores[winner] >= 250
                g.streak[winner] += 1
                g.streak[loser] = 0
                g.stats[winner]["rounds_won"] += 1
                g.earned[winner].add("firstBlood")
                if g.streak[winner] >= 3:
                    g.earned[winner].add("hatTrick")
                if g.streak[winner] >= 5:
                    g.earned[winner].add("unstoppable")
                if g.streak[winner] >= 2:
                    extra = 25 * (g.streak[winner] - 1)
                    totals[winner] += extra
                    bonus[winner].append("Streak %d +%d" % (g.streak[winner], extra))
                if trailing:
                    totals[winner] += 75
                    bonus[winner].append("Comeback +75")
                    g.earned[winner].add("comeback")
        for i, ev in enumerate(g.ev):
            g.earned[i].update(k for k, v in ev.items() if v)
        for i in range(len(g.seats)):
            g.scores[i] = max(0, g.scores[i] + totals[i])
        payload = {"round": g.round, "cat": g.ch.get("cat"), "raw": raw, "totals": totals, "scores": list(g.scores),
                   "winner": winner, "tags": g.tags, "bonus": bonus, "streak": list(g.streak), "mult": g.mult, "ev": g.ev}
        if g.ch.get("cat") == "code":
            payload["code"] = {"fn": g.ch["item"]["fn"], "model": g.ch["item"].get("model", ""), "codes": g.ch["codes"]}
        if g.round >= g.rounds:
            payload["final"] = self._finalize(g, None)
        else:
            g.phase = "result"
            g.ready = [False] * len(g.seats)
            g.deadline = now + (NEXT_WAIT if not g.solo else 900)
        g.send("round", payload)

    def _next_turn(self, g):
        g.round += 1
        if not g.solo:
            g.spinner = 1 - g.spinner
        g.mult = 1
        g.phase = "spin"
        g.deadline = time.time() + SPIN_WAIT
        g.spin_ready = time.time()
        g.send("turn", {"round": g.round, "spinner": g.spinner})

    def _finalize(self, g, forfeit_seat):
        g.phase = "over"
        g.deadline = time.time()
        out = {"scores": list(g.scores), "forfeit": forfeit_seat, "winner": -1, "ratings": None, "solo": None,
               "daily": None, "unranked": None, "streaks": [None] * len(g.seats)}
        if g.solo:
            if forfeit_seat is None:
                out["solo"] = self.store.apply_solo(g.seats[0].key, g.scores[0])
                if g.daily:
                    out["daily"] = self.store.apply_daily(g.seats[0].key, g.daily, g.scores[0])
        else:
            s = g.scores
            if forfeit_seat is not None:
                out["winner"] = 1 - forfeit_seat
            else:
                out["winner"] = -1 if s[0] == s[1] else (0 if s[0] > s[1] else 1)
            if g.bot or g.friendly:
                out["unranked"] = "bot" if g.bot else "friendly"
            else:
                out["ratings"] = self.store.apply_duel(g.seats[0].key, g.seats[1].key, s, forfeit_seat)
        out["progress"] = [None] * len(g.seats)
        for i, seat in enumerate(g.seats):
            if not seat.bot and i != forfeit_seat:  # finishing a game keeps the daily streak alive
                out["streaks"][i] = self.store.touch_streak(seat.key)
                st = g.stats[i]
                st["games"] += 1
                if g.daily:
                    st["daily"] += 1
                if g.scores[i] >= 600:
                    st["score600"] += 1
                won = not g.solo and forfeit_seat is None and out["winner"] == i
                if won:
                    g.earned[i].add("champion")
                if st["jackpots"] >= 2:
                    g.earned[i].add("jackpotJunkie")
                out["progress"][i] = self.store.apply_progress(seat.key, st, g.earned[i], g.scores[i], won, bool(g.daily))
        out["plans"] = [None if seat.bot else self.store.quota(seat.key) for seat in g.seats]
        if not g.solo and forfeit_seat is None:
            g.rematch_until = time.time() + REMATCH_WAIT
            out["rematch"] = REMATCH_WAIT
        else:
            for seat in g.seats:
                seat.done = True
        return out

    def _forfeit(self, g, idx):
        if g.phase == "over":
            return
        g.send("final", self._finalize(g, idx))

    def _ticker(self):
        while True:
            time.sleep(0.2)
            now = time.time()
            with self.lock:
                try:
                    self._tick(now)
                except Exception as exc:  # keep the loop alive, but say what broke
                    print("ticker error:", repr(exc), flush=True)

    def _tick(self, now):
        for tid in list(self.waiting):
            w = self.seats.get(tid)
            if not w or (w.streams == 0 and now - w.seen > GRACE):
                self.waiting.remove(tid)
                if w:
                    w.close()
            elif w.streams > 0 and now - w.queued_at >= BOT_WAIT:
                self._start_bot(w)
        for room, sid in list(self.rooms.items()):
            host = self.seats.get(sid)
            if not host or host.done or (host.streams == 0 and now - host.seen > GRACE) or now - host.queued_at > ROOM_TTL:
                self.rooms.pop(room, None)
                if host and not host.game:
                    host.push("expired", {})
                    host.close()
        for g in list(self.games):
            if g.phase == "over":
                if g.rematch_until and now > g.rematch_until:
                    g.rematch_until = 0
                    for s in g.seats:
                        if s.game is g and not s.done:
                            s.push("rematch", {"state": "closed"})
                            s.close()
                if now - g.deadline > 300:
                    self.games.remove(g)
                    for s in g.seats:
                        self.seats.pop(s.id, None)
                        if self.active.get(s.key) is s:
                            self.active.pop(s.key, None)
                continue
            gone = [s.idx for s in g.seats if s.streams == 0 and now - s.seen > GRACE]
            if gone:
                self._forfeit(g, gone[0])
                continue
            if g.bot:
                self._tick_bot(g, now)
            if g.phase == "spin" and now > g.deadline:
                self._spin(g, True)
            elif g.phase == "reveal" and now >= g.at:
                self._begin(g)
            elif g.phase == "play":
                cat = g.ch["cat"]
                if cat in QCATS:
                    self._tick_questions(g, now, self._close_q, self._send_q, self._end_trivia)
                elif cat == "guess":
                    self._tick_questions(g, now, self._close_est, self._send_est, self._end_guess)
                else:
                    self._tick_code(g, now)
            elif g.phase == "result" and now > g.deadline:
                self._next_turn(g)
        for tid, s in list(self.seats.items()):
            if s.game is None and tid not in self.waiting and not s.room and now - s.seen > 120:
                self.seats.pop(tid, None)
                if self.active.get(s.key) is s:
                    self.active.pop(s.key, None)
