#!/usr/bin/env python3
"""Duelette server: game files, accounts, server-run games and the world ranking.

Standard library only (plus bubblewrap and node on the host for code checks).
Run with `python3 server.py`.
Environment: HOST (127.0.0.1), PORT (8787), STATIC_DIR (this folder), DATA_DIR (./data),
DUELETTE_UNSAFE_LOCAL=1 to check code without bubblewrap on a development machine.

API (JSON; send the session token as "Authorization: Bearer <token>"):
  POST /api/guest    {avatar}                   -> {token, profile}   play without signing up
  POST /api/upgrade  {name, password}           -> {profile, recovery}  guest picks a name, keeps progress
  POST /api/billing/checkout                    -> {url}   Lemon Squeezy checkout for Pro
  POST /api/billing/portal                      -> {url}   manage or cancel the subscription
  POST /api/lemonsqueezy/webhook                signed subscription events from Lemon Squeezy
  GET  /api/legacy?n=NAME                       -> {claimable, rating, ...}  names from the first version
  POST /api/claim    {name, token, password}    -> {token, profile, recovery}  claim one with its old browser token
  POST /api/rename   {name, password}           -> {profile}   change a logged-in account's name
  POST /api/register {name, password, avatar}   -> {token, profile, recovery}
  POST /api/login    {name, password}           -> {token, profile}
  POST /api/recover  {name, recovery, password} -> {token, profile, recovery}
  POST /api/logout
  GET  /api/me                                   -> {profile}
  POST /api/avatar   {avatar}
  GET  /api/leaderboard?board=duel|solo
  GET  /api/config                               -> {freeGames, proPrice, checkoutUrl}
  POST /api/redeem   {code}                      -> {profile}   one-time Pro code from admin.py
  POST /api/play     {mode, code}               -> {ticket, room}; mode is solo, daily, duel, friend or join (code)
                                                 402 when today's free games are used up (the Daily Duel is always free)
  GET  /api/challenge?c=CODE                    -> {valid, host, avatar}  who sent a friend challenge
  GET  /api/stream?ticket=...                    server-sent events for that seat
  POST /api/act      {ticket, type, ...}         spin, answer, guess, submit, progress, next, leave, cancel
"""
import ipaddress
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import billing
from accounts import Store
from engine import Engine

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.environ.get("STATIC_DIR", HERE)
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(HERE, "data"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
PREFIX = "/duelette"  # Funnel mount point, stripped if it reaches us
SMALL_BODY = 4096
BIG_BODY = 96 * 1024  # stroke payloads

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/og.png": ("og.png", "image/png"),
}
JS_FILES = {"data", "art", "audio", "fx", "wheel", "ui", "net", "games", "game"}

# Pro plan display price. Payments go through Lemon Squeezy (billing.py) once its keys are set;
# one-time codes from admin.py work either way.
PRO_PRICE = os.environ.get("DUELETTE_PRO_PRICE", "$4.99 a month")

os.makedirs(DATA_DIR, exist_ok=True)
# The production question bank (content.json) is private; the public repo ships content.sample.json.
CONTENT_FILE = os.path.join(HERE, "content.json")
if not os.path.exists(CONTENT_FILE):
    CONTENT_FILE = os.path.join(HERE, "content.sample.json")
with open(CONTENT_FILE, encoding="utf-8") as fh:
    CONTENT = json.load(fh)
ITEM_TOPICS = {item["id"]: t for t, items in CONTENT["trivia"].items() for item in items}
ITEM_TOPICS.update({item["id"]: item["t"] for item in CONTENT["guess"]})
store = Store(os.path.join(DATA_DIR, "duelette2.db"), ITEM_TOPICS, CONTENT["topics"])
engine = Engine(store, CONTENT)


class Handler(BaseHTTPRequestHandler):
    server_version = "Duelette/3.0"

    def log_message(self, fmt, *args):
        if "/api/stream" not in self.path and "/api/act" not in self.path:
            print("%s %s" % (self.command, fmt % args), flush=True)

    def route(self):
        parts = urlsplit(self.path)
        path = parts.path
        if path.startswith(PREFIX):
            path = path[len(PREFIX):]
        if not path.startswith("/"):
            path = "/" + path
        return path, parse_qs(parts.query)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > limit:
            return None
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def client_ip(self):
        """The visitor's public IP when the proxy tells us, else None (never a shared local address)."""
        for raw in (self.headers.get("X-Forwarded-For", "").split(",")[0].strip(), self.client_address[0]):
            try:
                ip = ipaddress.ip_address(raw)
            except ValueError:
                continue
            if ip.is_global:
                return str(ip)
        return None

    def account(self):
        auth = self.headers.get("Authorization", "")
        return store.account_for(auth[7:]) if auth.startswith("Bearer ") else None

    # ---------------------------------------------------------- GET

    def do_GET(self):
        path, query = self.route()
        if path == "/api/stream":
            return self.stream(query.get("ticket", [""])[0])
        if path == "/api/leaderboard":
            board = query.get("board", ["duel"])[0]
            board = board if board in ("solo", "today") else "duel"
            try:
                limit = max(1, min(200, int(query.get("limit", ["50"])[0])))
            except ValueError:
                limit = 50
            return self.send_json(200, {"board": board, "players": store.leaderboard(board, limit), "online": engine.online()})
        if path == "/api/me":
            key = self.account()
            if not key:
                return self.send_json(401, {"error": "signed_out"})
            return self.send_json(200, {"profile": store.profile(key)})
        if path == "/api/challenge":
            return self.send_json(200, engine.room_info(query.get("c", [""])[0]))
        if path == "/api/legacy":
            return self.send_json(200, store.legacy_info(query.get("n", [""])[0]))
        if path == "/api/config":
            from accounts import FREE_GAMES
            return self.send_json(200, {"freeGames": FREE_GAMES, "proPrice": PRO_PRICE, "checkout": billing.enabled(),
                                        "plans": billing.public_plans()})
        return self.serve_static(path)

    def serve_static(self, path):
        target = STATIC.get(path)
        if not target and path.startswith("/js/") and path.endswith(".js") and path[4:-3] in JS_FILES:
            target = (path[1:], "text/javascript; charset=utf-8")
        if not target:
            return self.send_json(404, {"error": "not_found"})
        try:
            with open(os.path.join(STATIC_DIR, target[0]), "rb") as fh:
                body = fh.read()
        except OSError:
            return self.send_json(404, {"error": "not_found"})
        self.send_response(200)
        self.send_header("Content-Type", target[1])
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def stream(self, ticket):
        with engine.lock:
            seat = engine.seat(ticket)
            if not seat:
                return self.send_json(404, {"error": "no_ticket"})
            seat.streams += 1
            seat.seen = time.time()
        try:
            cursor = int(self.headers.get("Last-Event-ID") or 0)
        except ValueError:
            cursor = 0
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.wfile.write(b"retry: 1500\n\n")
            self.wfile.flush()
            while True:
                with seat.cond:
                    if cursor >= len(seat.log) and not seat.done:
                        seat.cond.wait(15)
                    fresh = seat.log[cursor:]
                if fresh:
                    for eid, event, data in fresh:
                        msg = "id: %d\nevent: %s\ndata: %s\n\n" % (eid, event, json.dumps(data, ensure_ascii=False))
                        self.wfile.write(msg.encode("utf-8"))
                        cursor = eid
                elif seat.done:
                    self.wfile.write(b"event: closed\ndata: {}\n\n")
                    self.wfile.flush()
                    break
                else:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with engine.lock:
                seat.streams -= 1
                seat.seen = time.time()

    # ---------------------------------------------------------- POST

    def webhook(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 256 * 1024:
            return self.send_json(400, {"error": "bad_body"})
        raw = self.rfile.read(length)
        if not billing.verify(raw, self.headers.get("X-Signature", "")):
            print("webhook rejected: bad signature", flush=True)
            return self.send_json(401, {"error": "bad_signature"})
        try:
            payload = json.loads(raw)
        except ValueError:
            return self.send_json(400, {"error": "bad_json"})
        print("webhook", billing.handle(payload, store), flush=True)
        return self.send_json(200, {"ok": True})

    def do_POST(self):
        path, _ = self.route()
        if path == "/api/lemonsqueezy/webhook":
            return self.webhook()
        data = self.read_json(BIG_BODY if path == "/api/act" else SMALL_BODY)
        if data is None:
            return self.send_json(400, {"error": "bad_json"})

        if path == "/api/guest":
            ip = self.client_ip()
            print("guest created, visitor IP %s" % ("visible" if ip else "not visible"), flush=True)
            profile, token = store.create_guest(ip, data.get("avatar"))
            if not profile:
                return self.send_json(429, {"error": token})
            return self.send_json(201, {"token": token, "profile": profile})
        if path == "/api/claim":
            profile, token, recovery = store.claim_legacy(data.get("name"), data.get("token"), data.get("password"))
            if not profile:
                code = {"weak_password": 400, "locked": 429, "not_legacy": 409}.get(token, 401)
                return self.send_json(code, {"error": token})
            return self.send_json(200, {"token": token, "profile": profile, "recovery": recovery})
        if path == "/api/register":
            profile, token, recovery = store.register(data.get("name"), data.get("password"), data.get("avatar"))
            if not profile:
                return self.send_json(409 if token == "taken" else 429 if token == "busy" else 400, {"error": token})
            return self.send_json(201, {"token": token, "profile": profile, "recovery": recovery})
        if path == "/api/login":
            profile, token = store.login(data.get("name"), data.get("password"))
            if not profile:
                return self.send_json(429 if token == "locked" else 409 if token == "legacy" else 401, {"error": token})
            return self.send_json(200, {"token": token, "profile": profile})
        if path == "/api/recover":
            profile, token, recovery = store.recover(data.get("name"), data.get("recovery"), data.get("password"))
            if not profile:
                return self.send_json(429 if token == "locked" else 400 if token == "weak_password" else 401, {"error": token})
            return self.send_json(200, {"token": token, "profile": profile, "recovery": recovery})
        if path == "/api/act":
            status, payload = engine.act(data.get("ticket"), data)
            return self.send_json(status, payload)

        key = self.account()
        if not key:
            return self.send_json(401, {"error": "signed_out"})
        if path == "/api/upgrade":
            with engine.lock:
                seat = engine.active.get(key)
                if seat and not seat.done:
                    return self.send_json(409, {"error": "in_game"})
            profile, recovery = store.upgrade_guest(key, data.get("name"), data.get("password"))
            if not profile:
                return self.send_json(409 if recovery == "taken" else 400, {"error": recovery})
            return self.send_json(200, {"profile": profile, "recovery": recovery})
        if path == "/api/rename":
            with engine.lock:
                seat = engine.active.get(key)
                if seat and not seat.done:
                    return self.send_json(409, {"error": "in_game"})
            profile, err, next_at = store.rename(key, data.get("name"), data.get("password"))
            if not profile:
                code = {"taken": 409, "wrong": 401, "cooldown": 429, "locked": 429, "guest": 403}.get(err, 400)
                return self.send_json(code, {"error": err, "nextAt": next_at})
            return self.send_json(200, {"profile": profile})
        if path == "/api/billing/checkout":
            if not billing.enabled():
                return self.send_json(503, {"error": "billing_off"})
            if store.profile(key)["guest"]:
                return self.send_json(403, {"error": "guest"})
            plan = "annual" if data.get("plan") == "annual" else "monthly"
            url = billing.create_checkout(store.new_checkout_ref(key), key, plan)
            return self.send_json(200, {"url": url}) if url else self.send_json(502, {"error": "checkout_failed"})
        if path == "/api/billing/portal":
            sub_id = store.subscription_id(key)
            url = billing.portal_url(sub_id) if sub_id and billing.enabled() else None
            return self.send_json(200, {"url": url}) if url else self.send_json(404, {"error": "no_subscription"})
        if path == "/api/logout":
            store.logout(self.headers.get("Authorization", "")[7:])
            return self.send_json(200, {"ok": True})
        if path == "/api/avatar":
            ok = store.set_avatar(key, data.get("avatar"))
            return self.send_json(200 if ok else 400, {"ok": ok})
        if path == "/api/play":
            mode = data.get("mode") if data.get("mode") in ("solo", "daily", "duel", "friend", "join") else "duel"
            ticket, err, room = engine.play(key, mode, data.get("code"))
            if err == "limit":
                return self.send_json(402, {"error": "limit", "plan": store.quota(key)})
            if err:
                return self.send_json(410 if err == "expired" else 409, {"error": err})
            return self.send_json(201, {"ticket": ticket, "room": room})
        if path == "/api/redeem":
            until, err = store.redeem(key, data.get("code", ""))
            if err:
                return self.send_json(429 if err == "locked" else 400, {"error": err})
            return self.send_json(200, {"profile": store.profile(key)})
        return self.send_json(404, {"error": "not_found"})


class Server(ThreadingHTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    print("Duelette on http://%s:%d (static from %s, code sandbox: %s)" % (
        HOST, PORT, STATIC_DIR, "bubblewrap" if __import__("judge").BWRAP else "local" if __import__("judge").UNSAFE_LOCAL else "off"), flush=True)
    Server((HOST, PORT), Handler).serve_forever()
