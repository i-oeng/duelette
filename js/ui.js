// Shared UI pieces: panel mounting, card headers, countdown timers and seeded randomness.
window.DL = window.DL || {};

DL.ui = (function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Replace the stage with a panel of HTML (hides the wheel).
  function mount(html) {
    const p = document.getElementById("panel");
    p.innerHTML = html;
    p.hidden = false;
    document.getElementById("wheelView").hidden = true;
    return p;
  }

  function catHead(cat, right) {
    const c = DL.CATS[cat];
    return '<div class="card-head' + (c.text === "#ffffff" ? " light-text" : "") + '" style="--cc:' + c.color + '">' +
      '<span class="cat-tag"><span class="cat-ic">' + DL.art.icon(c.icon) + "</span>" + esc(c.name) + "</span>" + (right || "") + "</div>";
  }

  // Small avatar chip markup: critter plus name.
  function who(p) {
    return '<span class="who"><span class="who-av">' + DL.art.avatar(p.avatar) + "</span>" + esc(p.name) + "</span>";
  }

  // Live line about the opponent, shown inside game cards during a duel.
  let oppText = "";
  function oppSlot() {
    return '<div class="opp-live" id="oppLive"' + (oppText ? "" : " hidden") + ">" + esc(oppText) + "</div>";
  }
  function clearOpp() { oppText = ""; }
  function setOpp(text) {
    if (!text) return;
    oppText = text;
    const el = document.getElementById("oppLive");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.remove("ping");
    void el.offsetWidth;
    el.classList.add("ping");
  }

  // Countdown bar. Calls onEnd once at zero and beeps through the last few seconds.
  function timer(host, seconds, opt) {
    const o = opt || {};
    const wrap = document.createElement("div");
    wrap.className = "timer";
    wrap.innerHTML = '<div class="timer-bar"><div class="timer-fill"></div></div><div class="timer-num"></div>';
    host.appendChild(wrap);
    const fill = wrap.querySelector(".timer-fill");
    const num = wrap.querySelector(".timer-num");
    let total = seconds * 1000;
    let left = total;
    let last = 0;
    let raf = 0;
    let running = false;
    let lastSec = Math.ceil(seconds);

    function paint() {
      const sec = Math.ceil(left / 1000);
      fill.style.transform = "scaleX(" + Math.max(0, left / total) + ")";
      num.innerHTML = "<b>" + sec + "</b><small>sec</small>";
      const low = sec <= (o.low || 3);
      wrap.classList.toggle("low", low);
      if (sec !== lastSec) {
        lastSec = sec;
        if (low && sec > 0 && running && !o.quiet) DL.audio.sfx.beep();
      }
    }
    function step(now) {
      if (!running) return;
      left -= now - last;
      last = now;
      if (left <= 0) {
        left = 0; running = false; paint();
        if (o.onEnd) o.onEnd();
        return;
      }
      paint();
      raf = requestAnimationFrame(step);
    }
    paint();
    return {
      el: wrap,
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(step); },
      stop() { running = false; cancelAnimationFrame(raf); },
      left() { return left / 1000; },
      reset(sec) { total = (sec || seconds) * 1000; left = total; lastSec = Math.ceil(left / 1000); paint(); }
    };
  }

  // Deterministic random numbers, so both duel players get the same challenge from one seed.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    const r = rand || Math.random;
    const b = list.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return { esc, mount, catHead, who, oppSlot, setOpp, clearOpp, timer, rng, shuffle, wait };
})();
