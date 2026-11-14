"""Duelette Pro billing through Lemon Squeezy (merchant of record: it charges the buyer,
handles US sales tax and pays out to you).

Setup, once, in the Lemon Squeezy dashboard:
  1. Create a store and a subscription product with one variant at $4.99 a month.
  2. Settings > API: create an API key.
  3. Settings > Webhooks: add https://<your host>/duelette/api/lemonsqueezy/webhook with a
     signing secret, and tick subscription_created, subscription_updated, subscription_cancelled,
     subscription_resumed, subscription_expired, subscription_paused, subscription_unpaused,
     subscription_payment_success and subscription_payment_failed.
  4. Put the values in the server's environment (on xixi: ~/duelette-srv/secrets.env):
       LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_VARIANT_ID, LEMONSQUEEZY_WEBHOOK_SECRET
     and optionally DUELETTE_PUBLIC_URL (where buyers return after paying).
Test mode keys work the same way, with Lemon Squeezy's test cards.

How it fits together: the server makes a checkout carrying a private reference for the
account. Lemon Squeezy repeats that reference in its webhooks, and every webhook is checked
against the signing secret before anything changes. The subscription's renewal or end date
decides how long Pro lasts.
"""
import calendar
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request

API_BASE = os.environ.get("LEMONSQUEEZY_API_BASE", "https://api.lemonsqueezy.com/v1")
API_KEY = os.environ.get("LEMONSQUEEZY_API_KEY", "")
STORE_ID = os.environ.get("LEMONSQUEEZY_STORE_ID", "")
VARIANT_ID = os.environ.get("LEMONSQUEEZY_VARIANT_ID", "")                # monthly plan
ANNUAL_VARIANT_ID = os.environ.get("LEMONSQUEEZY_ANNUAL_VARIANT_ID", "")  # annual plan (optional)
WEBHOOK_SECRET = os.environ.get("LEMONSQUEEZY_WEBHOOK_SECRET", "")
PUBLIC_URL = os.environ.get("DUELETTE_PUBLIC_URL", "https://forteveriti.tail8331b7.ts.net/duelette/")
GRACE = 2 * 86400

ACTIVE = {"active", "on_trial", "past_due"}  # past_due: Lemon Squeezy is still retrying the card


def enabled():
    return bool(API_KEY and STORE_ID and VARIANT_ID and WEBHOOK_SECRET)


def _api(method, path, body=None):
    req = urllib.request.Request(API_BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Accept": "application/vnd.api+json", "Content-Type": "application/vnd.api+json",
                                          "Authorization": "Bearer " + API_KEY})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read() or b"{}")
    except (urllib.error.URLError, ValueError, OSError) as exc:
        print("lemonsqueezy %s %s failed: %r" % (method, path, exc), flush=True)
        return None


_plans_cache = {"at": 0.0, "plans": []}


def plans():
    """The plans on sale, with price and free trial read from Lemon Squeezy (cached for 10 minutes)."""
    if not enabled():
        return []
    if time.time() - _plans_cache["at"] < 600 and _plans_cache["plans"]:
        return _plans_cache["plans"]
    out = []
    for plan_id, variant in (("monthly", VARIANT_ID), ("annual", ANNUAL_VARIANT_ID)):
        if not variant:
            continue
        d = _api("GET", "/variants/%s" % variant)
        try:
            a = d["data"]["attributes"]
        except (TypeError, KeyError):
            continue
        trial = a["trial_interval_count"] * (7 if a["trial_interval"] == "week" else 1) if a.get("has_free_trial") else 0
        out.append({"id": plan_id, "variant": str(variant), "cents": a["price"], "interval": a["interval"], "trialDays": trial})
    if out:
        _plans_cache.update(at=time.time(), plans=out)
    return out


def public_plans():
    return [{k: p[k] for k in ("id", "cents", "interval", "trialDays")} for p in plans()]


def create_checkout(ref, name, plan="monthly"):
    """A hosted checkout URL for one account and plan, or None."""
    variant = ANNUAL_VARIANT_ID if plan == "annual" and ANNUAL_VARIANT_ID else VARIANT_ID
    body = {"data": {
        "type": "checkouts",
        "attributes": {
            "checkout_data": {"custom": {"ref": ref}},
            "product_options": {"redirect_url": PUBLIC_URL + "?pro=thanks"},
            "checkout_options": {"button_color": "#ff2e63"},
        },
        "relationships": {
            "store": {"data": {"type": "stores", "id": str(STORE_ID)}},
            "variant": {"data": {"type": "variants", "id": str(variant)}},
        },
    }}
    out = _api("POST", "/checkouts", body)
    try:
        return out["data"]["attributes"]["url"]
    except (TypeError, KeyError):
        return None


def portal_url(sub_id):
    """A fresh signed link to the customer portal (cancel, change card, invoices), or None."""
    out = _api("GET", "/subscriptions/%s" % sub_id)
    try:
        return out["data"]["attributes"]["urls"]["customer_portal"]
    except (TypeError, KeyError):
        return None


def verify(raw, signature):
    """True when the X-Signature header matches the body signed with our webhook secret."""
    if not WEBHOOK_SECRET or not signature:
        return False
    expected = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def _ts(value):
    if not value:
        return 0.0
    try:
        return float(calendar.timegm(time.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")))
    except ValueError:
        return 0.0


def access_until(attrs):
    """How long a subscription keeps Pro on, as a unix time."""
    status = attrs.get("status")
    if status in ACTIVE:
        return _ts(attrs.get("renews_at")) + GRACE
    if status == "cancelled":  # cancelled subscriptions run to the end of the paid period
        return _ts(attrs.get("ends_at")) or _ts(attrs.get("renews_at"))
    return time.time()  # expired, unpaid, paused


def handle(payload, store):
    """Apply one verified webhook. Returns a short note for the log."""
    meta = payload.get("meta") or {}
    data = payload.get("data") or {}
    event = meta.get("event_name", "")
    if data.get("type") != "subscriptions":
        return "ignored %s" % event
    attrs = data.get("attributes") or {}
    if str(attrs.get("store_id", STORE_ID)) != str(STORE_ID):
        return "ignored: other store"
    sub_id = str(data.get("id"))
    ref = (meta.get("custom_data") or {}).get("ref")
    key = store.key_for_ref(ref) if ref else None
    key = key or store.key_for_subscription(sub_id)
    if not key:
        return "no account for subscription %s" % sub_id
    until = access_until(attrs)
    store.set_subscription(key, sub_id, attrs.get("status"), until)
    return "%s: %s is %s until %s" % (event, key, attrs.get("status"), time.strftime("%Y-%m-%d", time.gmtime(until)))
