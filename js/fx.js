// Juice: confetti, floating score text, banners, toasts and screen shake.
window.DL = window.DL || {};

DL.fx = (function () {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  const parts = [];
  let running = false;
  let dpr = 1;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pal = () => (DL.pal ? DL.pal().confetti : PALETTE);
  const PALETTE = ["#ff2e63", "#1f6bff", "#b6f03c", "#ff7a00", "#8c52ff", "#00c9c8", "#ffe14d", "#ffffff"];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  addEventListener("resize", resize);
  resize();

  function loop() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      if (p.life <= 0 || p.y > innerHeight + 40) { parts.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 30);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 0) {
        ctx.scale(1, Math.cos(p.rot * 3));
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 1) {
        ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2); ctx.fill();
      } else {
        star(p.size / 2);
      }
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  function star(r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = DL.pal ? DL.pal().ink : "#1b1035"; ctx.stroke();
  }

  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

  function burst(x, y, opt) {
    const o = opt || {};
    const n = reduced ? 12 : (o.count || 80);
    const colors = o.colors || pal();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (o.power || 9) * (0.4 + Math.random());
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 4),
        g: 0.28, drag: 0.985, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        size: 8 + Math.random() * 10, color: colors[i % colors.length],
        shape: Math.random() < 0.15 ? 2 : (Math.random() < 0.6 ? 0 : 1), life: 120 + Math.random() * 60
      });
    }
    kick();
  }

  let rainEnd = 0;
  // Remove every particle at once, so nothing drifts over a question.
  function clear() { parts.length = 0; rainEnd = 0; }

  function rain(seconds, colors) {
    if (reduced) { burst(innerWidth / 2, innerHeight / 3, { colors }); return; }
    rainEnd = performance.now() + seconds * 1000;
    (function drop() {
      if (performance.now() > rainEnd) return;
      for (let i = 0; i < 6; i++) {
        parts.push({
          x: Math.random() * innerWidth, y: -20, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3,
          g: 0.06, drag: 0.995, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          size: 10 + Math.random() * 10, color: (colors || pal())[Math.floor(Math.random() * (colors || pal()).length)],
          shape: Math.random() < 0.2 ? 2 : 0, life: 400
        });
      }
      kick();
      if (performance.now() < rainEnd) setTimeout(drop, 50);
    })();
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function floatText(text, x, y, color) {
    const el = document.createElement("div");
    el.className = "floaty";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (color) el.style.setProperty("--fc", color);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function shake(el) {
    const t = el || document.getElementById("app");
    t.classList.remove("shake");
    void t.offsetWidth;
    t.classList.add("shake");
    setTimeout(() => t.classList.remove("shake"), 450);
  }

  // Big slammed text across the screen. Resolves when it has faded.
  function banner(text, sub, color, ms) {
    const host = document.getElementById("banner");
    host.innerHTML = "";
    const b = document.createElement("div");
    b.className = "banner-text";
    b.textContent = text;
    if (sub) {
      const s = document.createElement("span");
      s.className = "banner-sub";
      s.textContent = sub;
      b.appendChild(s);
    }
    if (color) b.style.setProperty("--bc", color);
    host.appendChild(b);
    host.hidden = false;
    const dur = ms || 1300;
    b.style.animationDuration = dur + "ms";
    return new Promise((res) => setTimeout(() => { host.hidden = true; host.innerHTML = ""; res(); }, dur));
  }

  function toast(icon, kicker, text) {
    const host = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = '<span class="toast-ic"></span><span class="toast-k"></span><span class="toast-t"></span>';
    t.children[0].innerHTML = icon; // trusted SVG markup from DL.art
    t.children[1].textContent = kicker;
    t.children[2].textContent = text;
    host.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 420); }, 3200);
  }

  return { burst, rain, clear, floatText, shake, banner, toast, centerOf, PALETTE };
})();
