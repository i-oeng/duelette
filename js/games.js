// Mini-game screens. The server decides every score; these only show challenges, collect the
// player's input, send it, and show the server's verdict.
// ctx = { me, solo, players, mod, act(type, extra), report(text) }. Games: trivia, code, guess (Ballpark).
window.DL = window.DL || {};

DL.games = (function () {
  const { esc, mount, catHead, timer, oppSlot, setOpp } = DL.ui;
  const sfx = DL.audio.sfx;
  const modBadge = (mod) => (mod ? '<span class="mod-sticker">' + esc(mod.label) + "</span>" : "");
  const leftOf = (d, secs) => Math.max(0.2, secs - (performance.now() - d._at) / 1000);
  const oppName = (ctx) => ctx.players[1 - ctx.me].name;
  let cur = {};

  function celebrate(el, colors) {
    const c = DL.fx.centerOf(el);
    DL.fx.burst(c.x, c.y, { count: 36, power: 7, colors });
  }
  function status(text, kind) {
    const el = document.getElementById("gStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "g-status" + (kind ? " " + kind : "");
  }

  /* ---------------- Trivia Blitz ---------------- */
  const trivia = {
    q(d, ctx) {
      DL.fx.clear();
      cur = { cat: "trivia", round: d.round, i: d.i, pick: null, opts: d.opts };
      const p = mount(
        '<div class="card">' + catHead("trivia", '<span class="pill">Question ' + (d.i + 1) + " of " + d.n + "</span>") +
        '<div class="card-body"><div class="badges"><span class="pill topic">' + esc(d.topic) + "</span>" + modBadge(ctx.mod) + "</div>" +
        '<h2 class="tq">' + esc(d.q) + '</h2><div id="tmr"></div><div class="opts">' +
        d.opts.map((o, i) => '<button class="opt-btn" type="button" data-i="' + i + '"><span class="k">' + (i + 1) + '</span><span class="opt-text">' + esc(o) + "</span></button>").join("") +
        '</div><p class="g-status" id="gStatus" aria-live="polite">Pick an answer. Faster right answers score more.</p><p class="g-why" id="gWhy" hidden></p>' + oppSlot() + "</div></div>"
      );
      const btns = Array.from(p.querySelectorAll(".opt-btn"));
      cur.btns = btns;
      const t = timer(p.querySelector("#tmr"), leftOf(d, d.time), { onEnd: () => {
        if (cur.pick !== null || cur.i !== d.i) return;
        cur.pick = -1;
        btns.forEach((b) => (b.disabled = true));
        status("Time's up.", "bad");
      } });
      t.start();
      cur.timer = t;
      const pick = (i) => {
        if (cur.pick !== null || cur.i !== d.i) return;
        cur.pick = i;
        t.stop();
        btns.forEach((b, j) => { b.disabled = true; if (j === i) b.classList.add("picked"); });
        sfx.click();
        status(ctx.solo ? "Locked in. Checking..." : "Locked in. Waiting for " + oppName(ctx) + "...");
        ctx.act("answer", { i: d.i, choice: i });
      };
      cur.onKey = (e) => { if (!e.repeat && e.key >= "1" && e.key <= "4") pick(Number(e.key) - 1); };
      addEventListener("keydown", cur.onKey);
      btns.forEach((b, i) => b.addEventListener("click", () => pick(i)));
    },
    qres(d, ctx) {
      if (cur.cat !== "trivia" || cur.i !== d.i || !cur.btns) return;
      removeEventListener("keydown", cur.onKey);
      if (cur.timer) cur.timer.stop();
      const mine = d.picks[ctx.me];
      const gain = d.gains[ctx.me];
      cur.btns.forEach((b, j) => {
        b.disabled = true;
        b.classList.remove("picked");
        if (j === d.answer) b.classList.add("right");
        else if (j === mine) b.classList.add("wrong");
        else b.classList.add("dim");
      });
      if (!ctx.solo) {
        const o = d.picks[1 - ctx.me];
        if (o !== null && o !== undefined && cur.btns[o]) {
          cur.btns[o].insertAdjacentHTML("beforeend", '<span class="opp-pick" title="' + esc(oppName(ctx)) + ' picked this">' + DL.art.avatar(DL.art.fromId(ctx.players[1 - ctx.me].avatar)) + "</span>");
        }
        const og = d.gains[1 - ctx.me];
        setOpp(oppName(ctx) + ": " + (o === null ? "no answer" : og > 0 ? "right, +" + og + " pts" : "wrong"));
      }
      const why = document.getElementById("gWhy");
      if (why && d.why) { why.hidden = false; why.textContent = d.why; }
      if (mine === d.answer) {
        sfx.correct();
        const c = DL.fx.centerOf(cur.btns[mine]);
        DL.fx.floatText("+" + gain, c.x, c.y, "#0f7a4d");
        celebrate(cur.btns[mine]);
        status("Right! +" + gain + " pts", "good");
      } else {
        sfx.wrong();
        DL.fx.shake(cur.btns[d.answer].closest(".card"));
        status((mine === null ? "No answer. " : "Wrong. ") + "The answer was " + cur.opts[d.answer] + "." + (gain < 0 ? " " + gain + " pts" : ""), "bad");
      }
    }
  };

  /* ---------------- Code Sprint ---------------- */
  function workerMain() {
    self.onmessage = function (e) {
      var d = e.data, fn;
      try {
        fn = new Function(d.code + "\n;return typeof " + d.fn + " === 'function' ? " + d.fn + " : undefined;")();
      } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); return; }
      if (!fn) { self.postMessage({ error: "No function named " + d.fn + " yet." }); return; }
      self.postMessage({ results: d.tests.map(function (t) {
        try {
          var got = fn.apply(null, JSON.parse(JSON.stringify(t[0])));
          var g = got === undefined ? "undefined" : JSON.stringify(got);
          return { ok: g === JSON.stringify(t[1]), got: g };
        } catch (err) { return { ok: false, got: "Error: " + ((err && err.message) || err) }; }
      }) });
    };
  }
  const workerURL = URL.createObjectURL(new Blob(["(" + workerMain.toString() + ")()"], { type: "text/javascript" }));
  function runLocal(code, d) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(workerURL); } catch (e) { resolve({ error: "This browser blocked the test runner." }); return; }
      const kill = setTimeout(() => { w.terminate(); resolve({ error: "Timed out. Infinite loop?" }); }, 1500);
      w.onmessage = (e) => { clearTimeout(kill); w.terminate(); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(kill); w.terminate(); e.preventDefault(); resolve({ error: e.message || "Syntax error" }); };
      w.postMessage({ code, fn: d.fn, tests: d.tests });
    });
  }
  function ruleBreak(code, rules) {
    for (const b of rules.ban || []) if (code.includes(b)) return b + " is banned in this challenge.";
    if (rules.noloops && /\b(for|while)\b/.test(code)) return "No loops allowed! Remove for and while.";
    if (rules.oneliner && code.trim().includes("\n")) return "One-liner rule: keep it all on one line.";
    return "";
  }
  const fmt = (v) => JSON.stringify(v);

  const code = {
    start(d, ctx) {
      DL.fx.clear();
      cur = { cat: "code", round: d.round, sent: false };
      const starter = d.rules.oneliner ? "const " + d.fn + " = (" + d.args + ") => " : "function " + d.fn + "(" + d.args + ") {\n  \n}";
      const p = mount(
        '<div class="card">' + catHead("code", '<span class="pill">' + d.limit + " sec</span>") +
        '<div class="card-body"><h2 class="card-title">' + esc(d.title) + '</h2><p class="card-sub">' + esc(d.prompt) + "</p>" +
        '<div class="badges">' + modBadge(ctx.mod) + '<span class="pill">+ ' + d.hidden + " hidden tests on submit</span>" +
        '<span class="pill">Ctrl + Enter runs the tests</span></div><div id="tmr"></div>' +
        '<div class="code-grid"><div style="min-width:0"><textarea class="editor" id="editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Your code"></textarea></div>' +
        '<div class="tests">' + d.tests.map((t, i) =>
          '<div class="test" data-i="' + i + '"><span class="test-dot"></span><span class="test-call">' + esc(d.fn + "(" + t[0].map(fmt).join(", ") + ")") +
          '</span><span class="test-got">expect ' + esc(fmt(t[1])) + "</span></div>").join("") +
        '<div class="code-msg" id="cmsg" hidden></div></div></div>' +
        '<p class="g-status" id="gStatus" aria-live="polite">Make the tests pass, then submit. The server re-runs your code with hidden tests.</p>' + oppSlot() + "</div>" +
        '<div class="card-actions"><button class="btn btn-ghost" id="runBtn" type="button">Run tests</button>' +
        '<button class="btn btn-go" id="doneBtn" type="button">Submit</button></div></div>'
      );
      const ed = p.querySelector("#editor");
      const msg = p.querySelector("#cmsg");
      const rows = Array.from(p.querySelectorAll(".test"));
      ed.value = starter;
      ed.focus();
      const caret = d.rules.oneliner ? starter.length : starter.indexOf("\n  ") + 3;
      ed.setSelectionRange(caret, caret);
      let runId = 0;
      let prev = d.tests.map(() => false);
      let lastReport = -1;
      let debounce = 0;
      const show = (text, kind) => { msg.hidden = !text; msg.textContent = text; msg.className = "code-msg" + (kind ? " " + kind : ""); };

      async function run() {
        const id = ++runId;
        const src = ed.value;
        const broken = ruleBreak(src, d.rules);
        if (broken) { rows.forEach((r) => r.classList.remove("pass")); prev = d.tests.map(() => false); show(broken, "err"); return; }
        const res = await runLocal(src, d);
        if (id !== runId || cur.sent) return;
        if (res.error) { show(res.error, "err"); return; }
        let count = 0;
        res.results.forEach((r, i) => {
          rows[i].classList.toggle("pass", r.ok);
          rows[i].classList.toggle("fail", !r.ok);
          rows[i].querySelector(".test-got").textContent = r.ok ? "got " + r.got : "got " + r.got + ", expect " + fmt(d.tests[i][1]);
          if (r.ok) { count++; if (!prev[i]) setTimeout(() => sfx.pass(i), i * 90); }
        });
        prev = res.results.map((r) => r.ok);
        if (count !== lastReport) { lastReport = count; ctx.report(count + "/" + d.tests.length + " visible tests passing"); }
        if (count === d.tests.length) show("Visible tests pass! Submit to lock it in.", "ok");
        else show(count + " of " + d.tests.length + " visible tests passing", "");
      }
      function submit(timedOut) {
        if (cur.sent || cur.round !== d.round) return;
        cur.sent = true;
        t.stop();
        clearTimeout(debounce);
        ed.readOnly = true;
        p.querySelectorAll(".card-actions button").forEach((b) => (b.disabled = true));
        if (timedOut) sfx.buzz(); else sfx.click();
        status((timedOut ? "Time! " : "") + "Checking your code on the server with " + (d.tests.length + d.hidden) + " tests...");
        ctx.act("submit", { code: ed.value });
      }
      const t = timer(p.querySelector("#tmr"), leftOf(d, d.limit), { low: 10, onEnd: () => submit(true) });
      cur.timer = t;
      t.start();
      ed.addEventListener("keydown", (e) => {
        if (e.key === "Tab") { e.preventDefault(); ed.setRangeText("  ", ed.selectionStart, ed.selectionEnd, "end"); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      });
      ed.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(run, 900); });
      p.querySelector("#runBtn").addEventListener("click", run);
      p.querySelector("#doneBtn").addEventListener("click", () => submit(false));
    },
    result(d, ctx) {
      if (d.seat !== ctx.me) { setOpp(oppName(ctx) + ": " + d.passed + "/" + d.total + " tests" + (d.solved ? ", solved in " + d.time + " sec" : "")); return; }
      const line = d.passed + "/" + d.total + " tests passed" + (d.solved ? " in " + d.time + " sec" : "") + ". +" + d.pts + " pts";
      status((d.error && d.error !== "No submission" ? d.error + " " : "") + line, d.solved ? "good" : "bad");
      if (d.solved) sfx.correct(); else sfx.wrong();
    }
  };

  /* ---------------- Ballpark: estimate a number, closest scores most ---------------- */
  const decimals = (step) => (step < 1 ? Math.min(3, (String(step).split(".")[1] || "").length) : 0);
  const fmtNum = (v, step) => Number(v).toLocaleString("en-US", { maximumFractionDigits: decimals(step) });
  const unitText = (d) => (d.unit ? " " + d.unit : "");
  // Slider positions run 0..1000 on a log or linear scale, so big ranges stay easy to set.
  const toVal = (d, p) => (d.scale === "log" ? d.min * Math.pow(d.max / d.min, p / 1000) : d.min + ((d.max - d.min) * p) / 1000);
  const toPos = (d, v) => (d.scale === "log" ? (1000 * Math.log(v / d.min)) / Math.log(d.max / d.min) : (1000 * (v - d.min)) / (d.max - d.min));
  function snap(d, v) {
    let x = v;
    if (d.scale === "log" && x >= 1000) { const mag = Math.pow(10, Math.floor(Math.log10(x)) - 2); x = Math.round(x / mag) * mag; }
    x = Math.round(x / d.step) * d.step;
    return Math.min(d.max, Math.max(d.min, Number(x.toFixed(decimals(d.step)))));
  }

  const guess = {
    est(d, ctx) {
      DL.fx.clear();
      cur = { cat: "guess", round: d.round, i: d.i, d, locked: false, touched: false };
      let value = snap(d, d.scale === "log" ? Math.sqrt(d.min * d.max) : (d.min + d.max) / 2);
      const p = mount(
        '<div class="card">' + catHead("guess", '<span class="pill">Question ' + (d.i + 1) + " of " + d.n + "</span>") +
        '<div class="card-body"><div class="badges"><span class="pill topic">' + esc(d.topic) + "</span>" + modBadge(ctx.mod) + "</div>" +
        '<h2 class="tq">' + esc(d.q) + '</h2><div id="tmr"></div>' +
        '<div class="est-box" id="estBox"><output class="est-value" id="estVal" for="estRange estNum"></output>' +
        '<input type="range" class="est-range" id="estRange" min="0" max="1000" step="1" aria-label="Your guess">' +
        '<div class="est-ends"><span>' + fmtNum(d.min, d.step) + "</span><span>" + fmtNum(d.max, d.step) + esc(unitText(d)) + "</span></div>" +
        '<div class="est-type"><label for="estNum">Or type it</label><input type="number" class="name-input" id="estNum" inputmode="decimal" min="' +
        d.min + '" max="' + d.max + '" step="' + d.step + '"><span class="est-unit">' + esc(d.unit) + "</span></div></div>" +
        '<div class="est-result" id="estResult" hidden></div>' +
        '<p class="g-status" id="gStatus" aria-live="polite">Slide or type your best guess. The closer you are, the more you score.</p>' +
        '<p class="g-why" id="gWhy" hidden></p>' + oppSlot() + "</div>" +
        '<div class="card-actions"><button class="btn btn-big btn-go" id="lockBtn" type="button">Lock in</button></div></div>'
      );
      const range = p.querySelector("#estRange");
      const num = p.querySelector("#estNum");
      const out = p.querySelector("#estVal");
      const btn = p.querySelector("#lockBtn");
      const show = () => { out.textContent = fmtNum(value, d.step) + unitText(d); };
      range.value = String(toPos(d, value));
      num.value = String(value);
      show();
      range.addEventListener("input", () => { cur.touched = true; value = snap(d, toVal(d, Number(range.value))); num.value = String(value); show(); });
      num.addEventListener("input", () => {
        const v = Number(num.value);
        if (num.value !== "" && isFinite(v) && v >= d.min && v <= d.max) { cur.touched = true; value = v; range.value = String(toPos(d, v)); show(); }
      });
      const lock = (auto) => {
        if (cur.locked || cur.i !== d.i) return;
        cur.locked = true;
        t.stop();
        range.disabled = num.disabled = btn.disabled = true;
        if (auto && !cur.touched) { status("Time's up. No guess this time.", "bad"); return; }
        sfx.click();
        status("Locked in " + fmtNum(value, d.step) + unitText(d) + (ctx.solo ? ". Checking..." : ". Waiting for " + oppName(ctx) + "..."));
        ctx.act("guess", { i: d.i, value });
      };
      const t = timer(p.querySelector("#tmr"), leftOf(d, d.time), { onEnd: () => lock(true) });
      t.start();
      cur.timer = t;
      btn.addEventListener("click", () => lock(false));
      num.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lock(false); } });
    },
    estres(d, ctx) {
      if (cur.cat !== "guess" || cur.i !== d.i) return;
      cur.locked = true;
      if (cur.timer) cur.timer.stop();
      const q = cur.d;
      const mine = d.vals[ctx.me];
      const pts = d.pts[ctx.me];
      const pos = (v) => Math.max(0, Math.min(100, toPos(q, v) / 10)).toFixed(1) + "%";
      const marker = (v, cls, label) => '<span class="est-mark ' + cls + '" style="left:' + pos(v) + '"><span class="est-tag">' + esc(label) + "</span></span>";
      let marks = marker(d.answer, "ans", "Answer " + fmtNum(d.answer, q.step));
      if (mine !== null) marks += marker(mine, "you", "You");
      if (!ctx.solo && d.vals[1 - ctx.me] !== null) marks += marker(d.vals[1 - ctx.me], "opp", oppName(ctx));
      document.getElementById("estBox").hidden = true;
      const res = document.getElementById("estResult");
      res.hidden = false;
      res.innerHTML = '<div class="est-line">' + marks + "</div>";
      document.getElementById("lockBtn").closest(".card-actions").hidden = true;
      const off = mine === null ? null : Math.round((Math.abs(mine - d.answer) / d.answer) * 100);
      const closest = d.closest === ctx.me ? " Closest! (+20 included)" : "";
      if (mine === null) status("No guess. The answer is " + fmtNum(d.answer, q.step) + unitText(q) + ".", "bad");
      else status("The answer is " + fmtNum(d.answer, q.step) + unitText(q) + ". You were " + (off === 0 ? "spot on" : off + "% off") + ". +" + pts + " pts." + closest, pts >= 40 ? "good" : "bad");
      const why = document.getElementById("gWhy");
      why.hidden = !d.why;
      why.textContent = d.why;
      if (!ctx.solo) {
        const ov = d.vals[1 - ctx.me];
        setOpp(oppName(ctx) + ": " + (ov === null ? "no guess" : "guessed " + fmtNum(ov, q.step) + ", +" + d.pts[1 - ctx.me] + " pts"));
      }
      if (pts >= 70) { sfx.correct(); celebrate(res.querySelector(".you") || res); } else if (pts > 0) sfx.pass(2); else sfx.wrong();
      if (pts > 0) { const c = DL.fx.centerOf(res); DL.fx.floatText("+" + pts, c.x, c.y - 30, "#0f7a4d"); }
    }
  };

  return {
    trivia, code, guess,
    // Stop whatever the current challenge is running (timers, key listeners).
    reset() {
      if (cur.timer) cur.timer.stop();
      clearTimeout(cur.peekT);
      clearTimeout(cur.endT);
      if (cur.onKey) removeEventListener("keydown", cur.onKey);
      cur = {};
    }
  };
})();
