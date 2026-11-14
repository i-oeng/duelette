// Talks to server.py: accounts, rankings and the live game stream.
// The server runs every game; this file only carries actions out and events back.
window.DL = window.DL || {};

DL.net = (function () {
  const online = /^https?:$/.test(location.protocol);
  const KEY = "duelette.session";
  let token = "";
  try { token = localStorage.getItem(KEY) || ""; } catch (e) { token = ""; }
  let me = null;

  function setToken(t) {
    token = t || "";
    try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  }

  async function api(path, body) {
    if (!online) return { status: 0, data: { error: "offline" } };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    try {
      const res = await fetch("api/" + path, body
        ? { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal }
        : { headers, cache: "no-store", signal: ctl.signal });
      let data = {};
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (res.status === 401 && data.error === "signed_out") { setToken(""); me = null; }
      return { status: res.status, data };
    } catch (e) {
      return { status: 0, data: { error: "network" } };
    } finally {
      clearTimeout(timer);
    }
  }

  async function signedIn(res) {
    if (res.data && res.data.token) { setToken(res.data.token); me = res.data.profile; }
    return res;
  }

  return {
    online,
    get me() { return me; },
    get signedIn() { return !!token; },
    async loadMe() {
      if (!token) return null;
      const r = await api("me");
      me = r.status === 200 ? r.data.profile : null;
      return r.status === 0 ? "offline" : me;
    },
    register: (name, password, avatar) => api("register", { name, password, avatar }).then(signedIn),
    login: (name, password) => api("login", { name, password }).then(signedIn),
    recover: (name, recovery, password) => api("recover", { name, recovery, password }).then(signedIn),
    async logout() { await api("logout", {}); setToken(""); me = null; },
    async setAvatar(avatar) { const r = await api("avatar", { avatar }); if (r.status === 200 && me) me.avatar = avatar; return r; },
    config: () => api("config"),
    async rename(name, password) { const r = await api("rename", { name, password }); if (r.status === 200) me = r.data.profile; return r; },
    legacy: (name) => api("legacy?n=" + encodeURIComponent(name)),
    claim: (name, token, password) => api("claim", { name, token, password }).then(signedIn),
    guest: (avatar) => api("guest", { avatar }).then(signedIn),
    async upgrade(name, password) { const r = await api("upgrade", { name, password }); if (r.status === 200) me = r.data.profile; return r; },
    checkout: (plan) => api("billing/checkout", { plan }),
    challenge: (code) => api("challenge?c=" + encodeURIComponent(code)),
    portal: () => api("billing/portal", {}),
    async redeem(code) { const r = await api("redeem", { code }); if (r.status === 200) me = r.data.profile; return r; },
    board: (kind) => api("leaderboard?board=" + kind + "&limit=100"),

    // Start a solo run or join the duel queue. handlers maps server events to callbacks.
    // Every event gets data._at, the moment it arrived, so timers count from arrival.
    async play(mode, handlers, code) {
      const r = await api("play", { mode, code });
      if (r.status !== 201) return { error: r.data.error || "network", plan: r.data.plan };
      const ticket = r.data.ticket;
      const es = new EventSource("api/stream?ticket=" + encodeURIComponent(ticket));
      let closed = false;
      const close = () => { if (!closed) { closed = true; es.close(); } };
      ["waiting", "match", "spin", "turn", "q", "qres", "code", "coderes", "hint", "rematch", "est", "estres", "relay", "round", "final", "expired"].forEach((ev) =>
        es.addEventListener(ev, (e) => {
          let data;
          try { data = JSON.parse(e.data); } catch (err) { return; }
          data._at = performance.now();
          if (handlers[ev]) handlers[ev](data);
          if ((ev === "final" && !data.rematch) || (ev === "round" && data.final && !data.final.rematch)) close();
        }));
      es.addEventListener("closed", close);
      es.onerror = () => { if (!closed && handlers.trouble) handlers.trouble(es.readyState); };
      return {
        room: r.data.room,
        act: (type, extra) => api("act", Object.assign({ ticket, type }, extra || {})),
        leave: () => { close(); return api("act", { ticket, type: "leave" }); },
        close
      };
    }
  };
})();
