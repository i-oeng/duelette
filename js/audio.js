// Tiny WebAudio synth: every sound is generated, no audio files needed.
window.DL = window.DL || {};

DL.audio = (function () {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem("duelette.muted") === "1"; } catch (e) { /* storage blocked */ }

  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opt) {
    const o = opt || {};
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.slide), t + dur);
    const vol = o.vol == null ? 0.18 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(dur, opt) {
    const o = opt || {};
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (o.at || 0);
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = o.filter || "bandpass";
    f.frequency.setValueAtTime(o.from || 400, t);
    f.frequency.exponentialRampToValueAtTime(o.to || 3000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  const notes = (list, step, type, vol) =>
    list.forEach((f, i) => tone(f, step * 1.6, { type: type || "triangle", vol: vol || 0.16, at: i * step }));

  const sfx = {
    tick() { tone(1500 + Math.random() * 300, 0.035, { type: "square", vol: 0.06 }); },
    click() { tone(520, 0.07, { type: "triangle", vol: 0.14, slide: 1.8 }); },
    pop() { tone(300, 0.09, { type: "sine", vol: 0.22, slide: 3.5 }); },
    whoosh() { noise(0.55, { from: 300, to: 4000, vol: 0.16 }); },
    land() { notes([523, 659, 784, 1047], 0.07); },
    coin() { tone(988, 0.08, { vol: 0.1 }); tone(1319, 0.3, { vol: 0.1, at: 0.08 }); },
    jackpot() {
      notes([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.06, "square", 0.09);
      for (let i = 0; i < 6; i++) tone(1800 + i * 120, 0.08, { type: "square", vol: 0.05, at: 0.5 + i * 0.07 });
    },
    chaos() { tone(110, 0.6, { type: "sawtooth", vol: 0.15, slide: 4 }); noise(0.6, { from: 2000, to: 200, vol: 0.12 }); },
    correct() { notes([660, 880, 1320], 0.08, "triangle", 0.18); },
    wrong() { tone(240, 0.4, { type: "sawtooth", vol: 0.13, slide: 0.45 }); },
    buzz() { tone(140, 0.22, { type: "sawtooth", vol: 0.18 }); tone(147, 0.22, { type: "square", vol: 0.08 }); },
    beep() { tone(880, 0.09, { type: "sine", vol: 0.14 }); },
    go() { tone(1320, 0.3, { type: "sine", vol: 0.2 }); },
    pass(i) { tone(700 + (i || 0) * 140, 0.12, { type: "triangle", vol: 0.16 }); },
    win() { notes([523, 659, 784, 1047, 1319], 0.08, "square", 0.08); },
    fanfare() {
      notes([392, 523, 659, 784], 0.12, "square", 0.1);
      tone(1047, 0.9, { type: "square", vol: 0.1, at: 0.5 });
      tone(784, 0.9, { type: "triangle", vol: 0.12, at: 0.5 });
    },
    achievement() { notes([784, 988, 1175, 1568], 0.06, "triangle", 0.16); },
    count(i) { tone(400 + i * 60, 0.03, { type: "square", vol: 0.04 }); }
  };

  return {
    ensure,
    sfx,
    // Cut every sound already scheduled, for example when leaving a game mid-spin.
    hush() {
      if (!ctx || !master) return;
      master.disconnect();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("duelette.muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
      return muted;
    }
  };
})();
