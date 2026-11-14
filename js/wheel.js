// The prize wheel: canvas drawn, chasing rim lights, flapping pointer, eased spin.
window.DL = window.DL || {};

DL.Wheel = function (canvas) {
  const ctx = canvas.getContext("2d");
  const INK = "#1b1035";
  const TAU = Math.PI * 2;
  const FONT = '"Bungee", "Arial Black", Impact, sans-serif';
  let segs = [];
  let rot = 0;
  let spinning = false;
  let idle = true;
  let flap = 0;
  let hub = "";
  let hiIndex = -1;
  let hiUntil = 0;
  let size = 0;
  let dpr = 1;
  let tickCb = null;
  let spinId = 0; // bumping it cancels the spin in progress

  function fit() {
    const cw = canvas.clientWidth;
    if (!cw) return false;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (cw !== size || d !== dpr) {
      size = cw; dpr = d;
      canvas.width = Math.round(cw * d);
      canvas.height = Math.round(cw * d);
    }
    return true;
  }

  function indexAt(r) {
    const n = segs.length;
    let a = (-Math.PI / 2 - r) % TAU;
    if (a < 0) a += TAU;
    return Math.floor(a / (TAU / n)) % n;
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }

  function fitText(text, max, px) {
    ctx.font = px + "px " + FONT;
    const w = ctx.measureText(text).width;
    if (w > max) ctx.font = Math.floor(px * max / w) + "px " + FONT;
  }

  function draw(now) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2 + s * 0.02;
    const outer = s / 2 - s * 0.06;
    const rimW = s * 0.055;
    const r = outer - rimW;
    const n = segs.length;
    const seg = TAU / n;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    // hard drop shadow and rim
    ctx.fillStyle = INK;
    circle(cx + s * 0.018, cy + s * 0.022, outer); ctx.fill();
    circle(cx, cy, outer); ctx.fill();

    // chasing bulbs
    const nb = Math.max(16, n * 3);
    const phase = Math.floor(now / (spinning ? 60 : 380));
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * TAU;
      const on = (i + phase) % 3 === 0 || (!spinning && (i + phase) % 2 === 0);
      const bx = cx + Math.cos(a) * (outer - rimW / 2);
      const by = cy + Math.sin(a) * (outer - rimW / 2);
      ctx.save();
      if (on) { ctx.shadowColor = "#ffe14d"; ctx.shadowBlur = s * 0.03; }
      ctx.fillStyle = on ? "#fff3a0" : "#6b4f00";
      circle(bx, by, rimW * 0.22); ctx.fill();
      ctx.restore();
    }

    // wedges
    ctx.lineJoin = "round";
    for (let i = 0; i < n; i++) {
      const a0 = rot + i * seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a0 + seg);
      ctx.closePath();
      ctx.fillStyle = segs[i].color;
      ctx.fill();
      if (segs[i].type === "jack") {
        // candy stripes on the jackpot wedge
        ctx.save(); ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = s * 0.02;
        for (let k = 1; k < 7; k++) { ctx.beginPath(); ctx.arc(cx, cy, r * k / 7, a0, a0 + seg); ctx.stroke(); }
        ctx.restore();
      }
      if (i === hiIndex && now < hiUntil) {
        ctx.fillStyle = "rgba(255,255,255," + (0.3 + 0.3 * Math.sin(now / 70)) + ")";
        ctx.fill();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(2, s * 0.008);
      ctx.stroke();
    }

    // labels and glyphs, reading outward along each wedge
    for (let i = 0; i < n; i++) {
      const sg = segs[i];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot + i * seg + seg / 2);
      ctx.fillStyle = sg.text;
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      // icon badge: a white disc that fits inside its own wedge, between the hub and the label
      const bd = r * 0.37;
      const br = Math.min(s * 0.05, bd * Math.sin(seg / 2) * 0.8);
      const labelEnd = r - s * 0.03;
      fitText(sg.label, Math.min(r * 0.46, labelEnd - (bd + br) - s * 0.015), Math.round(s * 0.04));
      ctx.fillText(sg.label, labelEnd, 0);
      ctx.fillStyle = "#ffffff";
      circle(bd, 0, br); ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.005); ctx.strokeStyle = INK; ctx.stroke();
      const isz = br * 1.42;
      const ic = DL.art.iconImage(sg.icon);
      if (ic.complete && ic.naturalWidth) {
        ctx.save(); ctx.translate(bd, 0); ctx.rotate(-(rot + i * seg + seg / 2)); // icons stay upright
        ctx.drawImage(ic, -isz / 2, -isz / 2, isz, isz);
        ctx.restore();
      }
      ctx.restore();
    }

    // pegs on wedge borders
    for (let i = 0; i < n; i++) {
      const a = rot + i * seg;
      const px = cx + Math.cos(a) * (r - s * 0.018);
      const py = cy + Math.sin(a) * (r - s * 0.018);
      ctx.fillStyle = "#ffffff";
      circle(px, py, s * 0.011); ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.strokeStyle = INK; ctx.stroke();
    }

    // hub with the current spinner's avatar
    ctx.fillStyle = "#fff8e7";
    circle(cx, cy, r * 0.2); ctx.fill();
    ctx.lineWidth = Math.max(3, s * 0.012); ctx.strokeStyle = INK; ctx.stroke();
    if (hub && hub.complete && hub.naturalWidth) ctx.drawImage(hub, cx - r * 0.17, cy - r * 0.17, r * 0.34, r * 0.34);

    // pointer
    flap *= 0.8;
    ctx.save();
    ctx.translate(cx, s * 0.035);
    ctx.rotate(flap);
    ctx.beginPath();
    ctx.moveTo(-s * 0.048, 0);
    ctx.lineTo(s * 0.048, 0);
    ctx.lineTo(0, s * 0.105);
    ctx.closePath();
    ctx.fillStyle = "#ff2e63";
    ctx.fill();
    ctx.lineWidth = Math.max(3, s * 0.009); ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; circle(0, 0, s * 0.02); ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    if (!spinning && idle && segs.length) rot += 0.0025;
    if (segs.length && canvas.offsetParent !== null && fit()) draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function spin(target) {
    if (spinning || !segs.length) return Promise.resolve(null);
    const n = segs.length;
    const seg = TAU / n;
    const idx = target == null ? Math.floor(Math.random() * n) : target;
    const frac = 0.15 + Math.random() * 0.7;
    const base = -Math.PI / 2 - (idx + frac) * seg;
    const windup = 0.25;
    const start = rot - windup;
    const minEnd = rot + TAU * (5 + Math.random() * 2);
    const end = base + Math.ceil((minEnd - base) / TAU) * TAU;
    const pre = 260;
    const dur = 4300 + Math.random() * 1200;
    const r0 = rot;
    const t0 = performance.now();
    spinning = true;
    hiIndex = -1;
    let last = indexAt(rot);
    const my = ++spinId;
    return new Promise((resolve) => {
      function step(now) {
        if (my !== spinId) { spinning = false; resolve(null); return; }
        const el = now - t0;
        if (el < pre) {
          rot = r0 - windup * Math.sin((el / pre) * Math.PI / 2);
        } else {
          const t = Math.min(1, (el - pre) / dur);
          rot = start + (end - start) * (1 - Math.pow(1 - t, 4));
          const cur = indexAt(rot);
          if (cur !== last) { last = cur; flap = -0.6; if (tickCb) tickCb(); }
          if (t >= 1) {
            spinning = false;
            rot = rot % TAU;
            hiIndex = idx;
            hiUntil = performance.now() + 2000;
            resolve(idx);
            return;
          }
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  return {
    setSegments(list) { segs = list.slice(); hiIndex = -1; },
    get segments() { return segs; },
    setHub(text) { hub = text; },
    setIdle(b) { idle = b; },
    onTick(fn) { tickCb = fn; },
    stop() { spinId++; },
    get spinning() { return spinning; },
    spin
  };
};
