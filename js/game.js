// Duelette game flow: accounts, home, server-run solo and duel games, results and rankings.
(function () {
  const { esc, mount, catHead, wait } = DL.ui;
  const sfx = DL.audio.sfx;
  const $ = (id) => document.getElementById(id);
  const WHEEL = ["code", "guess", "trivia", "scam", "jack", "code", "guess", "trivia", "scam", "chaos"]; // matches engine.py
  const PCOL = ["#ff2e63", "#1f6bff"]; // you are always pink, the opponent blue

  const ACH = {
    firstBlood: ["bolt", "First blood: won a duel round"],
    hatTrick: ["hat", "Hat trick: 3 round wins in a row"],
    unstoppable: ["flame", "Unstoppable: 5 round wins in a row"],
    bigBrain: ["bulb", "Big brain: perfect trivia"],
    speedDemon: ["clock", "Speed demon: solved under 25 sec"],
    cleanCode: ["sparkle", "Clean code: passed every hidden test"],
    sharpshooter: ["target", "Sharpshooter: a near-perfect guess"],
    scamBuster: ["shield", "Scam buster: called every message right"],
    jackpotJunkie: ["coin", "Jackpot junkie: two jackpots"],
    comeback: ["rise", "Comeback kid"],
    champion: ["crown", "Champion: won a duel"]
  };
  const ERR = {
    bad_name: "Names are 3 to 16 letters, numbers or underscores.",
    reserved: "That name is reserved. Pick another.",
    taken: "That name is taken. Log in if it is yours.",
    weak_password: "Passwords need at least 6 characters.",
    wrong: "That name and password do not match.",
    locked: "Too many tries. Wait 5 minutes, then try again.",
    busy: "Too many new accounts right now. Try again later.",
    network: "Can't reach the game server. Check your connection.",
    offline: "Open the hosted link to play.",
    legacy: "That name is from the first version of Duelette. Open the game in the browser you used back then to claim it."
  };

  const S = {
    mode: null, phase: "home", me: 0, players: [], round: 1, rounds: 5, spinner: 0, mult: 1, cat: null, mod: null,
    jackCount: 0, unlocked: new Set(), wonRound: false, session: null, chain: Promise.resolve(), gen: 0
  };

  const wheel = DL.Wheel($("wheel"));
  let lastTick = 0;
  wheel.onTick(() => { const n = performance.now(); if (n - lastTick > 28) { lastTick = n; sfx.tick(); } });
  wheel.setSegments(WHEEL.map((k) =>
    k === "jack" ? { type: "jack", label: "Jackpot", icon: "coin", color: "#ffe14d", text: "#1b1035" }
      : k === "chaos" ? { type: "chaos", label: "Chaos", icon: "chaos", color: "#1b1035", text: "#ffe14d" }
        : { type: "cat", cat: k, label: DL.CATS[k].label, icon: DL.CATS[k].icon, color: DL.CATS[k].color, text: DL.CATS[k].text }));

  function show(id) {
    ["scr-home", "scr-arena", "scr-final", "scr-rank"].forEach((s) => ($(s).hidden = s !== id));
    const inGame = id === "scr-arena";
    $("quitBtn").hidden = !inGame;
    $("quitBtn").textContent = S.mode === "duel" ? "Forfeit" : "Quit run";
    $("rankBtn").hidden = inGame;
    window.scrollTo(0, 0);
  }
  // Server events run one after another in arrival order, and only for the current game.
  function enqueue(fn) {
    const gen = S.gen;
    S.chain = S.chain.then(() => (gen === S.gen ? fn() : null)).catch((e) => console.error(e));
  }
  const mine = () => S.players[S.me];
  const opp = () => S.players[1 - S.me];
  const av = (p) => DL.art.fromId(p.avatar);

  /* ---------------- Home and accounts ---------------- */
  let authMode = "login";
  let signupAvatar = Math.floor(Math.random() * DL.art.count);

  function avatarButtons(box, selected, onPick) {
    box.innerHTML = DL.art.CRITTERS.map((c, i) =>
      '<button class="av" type="button" data-i="' + i + '" aria-label="' + c.name + '" aria-pressed="' + (selected === i) + '">' + DL.art.avatar(i) + "</button>").join("");
    box.querySelectorAll(".av").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll(".av").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      DL.audio.ensure(); sfx.pop();
      onPick(Number(b.dataset.i));
    }));
  }

  function buildHome() {
    const cols = ["var(--p1)", "var(--code)", "var(--p2)", "var(--draw)", "var(--trivia)", "var(--photo)", "var(--jack)", "var(--p1)"];
    $("logo").innerHTML = "DUELETTE".split("").map((ch, i) =>
      '<span class="ltr" aria-hidden="true" style="--i:' + i + ";--c:" + cols[i] + '">' + ch + "</span>").join("");
    document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = DL.art.icon(el.dataset.icon)));
    avatarButtons($("signupAvatars"), signupAvatar, (i) => { signupAvatar = i; });
    $("tabLogin").addEventListener("click", () => setAuthMode("login"));
    $("tabSignup").addEventListener("click", () => setAuthMode("signup"));
    $("forgotBtn").addEventListener("click", () => setAuthMode(authMode === "recover" ? "login" : "recover"));
    $("authForm").addEventListener("submit", submitAuth);
    $("pwForm").addEventListener("submit", redeemCode);
    $("pwClose").addEventListener("click", () => { $("paywall").hidden = true; });
    $("logoutBtn").addEventListener("click", async () => { await DL.net.logout(); sfx.click(); setAuthMode("login"); renderHome(); });
    $("ovCopy").addEventListener("click", copyCode);
    $("ovDone").addEventListener("click", () => { $("overlay").hidden = true; $("soloBtn").focus(); });
    $("upgradeForm").addEventListener("submit", submitUpgrade);
    $("legacyForm").addEventListener("submit", submitLegacy);
    $("friendBtn").addEventListener("click", () => start("friend"));
    $("tabToday").addEventListener("click", () => { board = "today"; loadBoard(); });
    $("renameForm").addEventListener("submit", submitRename);
    $("renameBox").addEventListener("toggle", () => {
      if (!$("renameBox").open || !DL.net.me) return;
      $("newName").value = DL.net.me.name;
      $("renameMsg").textContent = "";
      $("newName").focus();
      $("newName").select();
    });
    $("toLoginBtn").addEventListener("click", () => { showLogin = true; setAuthMode("login"); renderHome(); $("authName").focus(); });
    $("pwCheckout").addEventListener("click", checkout);
    $("pwSave").addEventListener("click", () => { $("paywall").hidden = true; if (DL.net.me) focusSave(); else { setAuthMode("signup"); $("authName").focus(); } });
    setAuthMode("login");
  }

  function setAuthMode(m) {
    authMode = m;
    $("tabLogin").setAttribute("aria-selected", String(m !== "signup"));
    $("tabSignup").setAttribute("aria-selected", String(m === "signup"));
    $("nameHelp").hidden = m !== "signup";
    $("signupAvatars").hidden = m !== "signup";
    $("codeRow").hidden = m !== "recover";
    $("passLabel").textContent = m === "recover" ? "New password" : "Password";
    $("authPass").autocomplete = m === "login" ? "current-password" : "new-password";
    $("authSubmit").textContent = m === "signup" ? "Create account" : m === "recover" ? "Reset password" : "Log in";
    $("forgotBtn").textContent = m === "recover" ? "Back to log in" : "Forgot your password?";
    $("forgotBtn").hidden = m === "signup";
    authMsg("");
  }
  function authMsg(text, kind) { const el = $("authMsg"); el.textContent = text; el.className = "form-msg" + (kind ? " " + kind : ""); }

  async function submitAuth(e) {
    e.preventDefault();
    DL.audio.ensure();
    const name = $("authName").value.trim();
    const pass = $("authPass").value;
    if (authMode !== "login" && !/^[A-Za-z0-9_]{3,16}$/.test(name)) return authMsg(ERR.bad_name, "bad");
    if (!name || !pass) return authMsg("Enter your name and password.", "bad");
    if (authMode !== "login" && pass.length < 6) return authMsg(ERR.weak_password, "bad");
    const btn = $("authSubmit");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "One moment...";
    const r = authMode === "signup" ? await DL.net.register(name, pass, DL.art.toId(signupAvatar))
      : authMode === "recover" ? await DL.net.recover(name, $("authCode").value, pass)
        : await DL.net.login(name, pass);
    btn.disabled = false;
    btn.textContent = label;
    if (!r.data.token) {
      sfx.wrong();
      DL.fx.shake($("authCard"));
      const code = r.status === 0 ? "network" : r.data.error;
      return authMsg(authMode === "recover" && code === "wrong" ? "That name and recovery code do not match." : ERR[code] || ERR.network, "bad");
    }
    $("authPass").value = "";
    showLogin = false;
    $("authCode").value = "";
    sfx.coin();
    renderHome();
    if (r.data.recovery) showRecovery(r.data.recovery, authMode === "signup");
  }

  function showRecovery(code, isNew) {
    $("ovTitle").textContent = isNew ? "Welcome! Save your recovery code" : "Password changed. Here is your new recovery code";
    $("ovCode").textContent = code;
    $("overlay").hidden = false;
    $("ovDone").focus();
  }
  async function copyCode() {
    const code = $("ovCode").textContent;
    try { await navigator.clipboard.writeText(code); $("ovCopy").textContent = "Copied"; }
    catch (e) { const range = document.createRange(); range.selectNodeContents($("ovCode")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); $("ovCopy").textContent = "Selected, press Ctrl+C"; }
  }

  let showLogin = false;
  function renderHome() {
    const me = DL.net.me;
    const guest = !!(me && me.guest);
    $("offlineNote").hidden = DL.net.online;
    $("authCard").hidden = !DL.net.online || (!!me && !showLogin);
    $("meCard").hidden = !me;
    $("soloBtn").disabled = !DL.net.online;
    $("matchBtn").disabled = !DL.net.online;
    $("friendBtn").disabled = !DL.net.online;
    renderDaily(me && me.daily, me && me.streak);
    $("modeNote").hidden = !!me || !DL.net.online;
    $("scr-home").classList.toggle("out", !me);
    if (!me) return;
    $("meAv").innerHTML = DL.art.avatar(av(me));
    $("meName").textContent = me.name;
    const st = me.streak || {};
    $("streakChip").hidden = !st.count;
    $("streakChip").innerHTML = DL.art.icon("flame") + "<b>" + (st.count || 0) + "</b>";
    $("streakChip").title = (st.count || 0) + "-day streak" + (st.today ? "" : ". Play today to keep it.");
    $("guestBox").hidden = !guest;
    $("renameBox").hidden = guest;
    $("logoutBtn").hidden = guest;
    const bits = guest ? []
      : [me.rank ? "Rating " + me.rating + " · world #" + me.rank : "Rating " + me.rating + " · unranked until your first duel"];
    if (me.soloRuns) bits.push("Solo best " + me.soloBest + (me.soloRank ? " · #" + me.soloRank : ""));
    $("meStats").textContent = bits.join("  ·  ");
    $("meStats").hidden = !bits.length;
    renderPlan(me.plan);
    renderMastery(me.mastery);
    avatarButtons($("avatars"), av(me), async (i) => {
      await DL.net.setAvatar(DL.art.toId(i));
      $("meAv").innerHTML = DL.art.avatar(i);
    });
  }

  /* ---------------- Plan, Pro and mastery ---------------- */
  let config = { freeGames: 3, proPrice: "", checkoutUrl: "" };
  if (DL.net.online) DL.net.config().then((r) => { if (r.status === 200) config = r.data; });
  function untilReset(ts) {
    const s = Math.max(60, ts * 1000 - Date.now()) / 1000;
    const h = Math.floor(s / 3600);
    const m = Math.ceil((s % 3600) / 60);
    return h ? h + " h " + m + " min" : m + " min";
  }
  function renderPlan(plan) {
    const el = $("planLine");
    if (!plan) { el.hidden = true; return; }
    el.hidden = false;
    if (plan.pro) {
      const sub = plan.subscription;
      const date = new Date(plan.proUntil * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
      el.innerHTML = '<span class="tok pro-tok">Member</span><span>' + (sub && sub.status !== "cancelled" ? "Unlimited games, renews automatically" : "Unlimited games until " + date) + "</span>" +
        (sub ? '<button class="text-btn" type="button" id="manageBtn">Manage subscription</button>' : "");
      if (sub) $("manageBtn").addEventListener("click", manageSub);
      return;
    }
    const dots = Array.from({ length: plan.limit }, (_, i) => '<span class="play-dot' + (i < plan.left ? " on" : "") + '"></span>').join("");
    el.innerHTML = '<span class="play-dots" aria-hidden="true">' + dots + "</span><span>" +
      (plan.left ? plan.left + " of " + plan.limit + " free games left today" : "No free games left today. More in " + untilReset(plan.resetAt)) +
      '</span><button class="text-btn" type="button" id="getProBtn">Upgrade</button>';
    $("getProBtn").addEventListener("click", () => openPaywall(plan));
  }
  function renderMastery(list) {
    const box = $("mastery");
    const all = list || [];
    if (!all.some((m) => m.answers > 0)) {
      box.innerHTML = '<p class="mastery-empty">Answer trivia, Ballpark and Spot the Scam rounds to build your mastery in each topic.</p>';
      return;
    }
    box.innerHTML = '<h3 class="mastery-title">Your mastery<span class="mastery-hint">Chance you get a typical question in the topic right</span></h3>' +
      all.map((m) => {
        if (!m.answers) return '<div class="m-row dim"><span class="m-name">' + esc(m.label) + '</span><span class="m-bar"><span style="width:0"></span></span><span class="m-pct">Not played yet</span></div>';
        const moved = m.baseline !== null && m.answers >= 10 && m.pct !== m.baseline;
        return '<div class="m-row"><span class="m-name">' + esc(m.label) + '</span><span class="m-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + m.pct +
          '" aria-label="' + esc(m.label) + ' mastery"><span style="width:' + m.pct + '%"></span></span><span class="m-pct">' + m.pct + "%" +
          (moved ? ' <small class="' + (m.pct > m.baseline ? "up" : "down") + '">' + (m.pct > m.baseline ? "up" : "down") + " from " + m.baseline + "%</small>" : "") + "</span></div>";
      }).join("");
  }
  let selPlan = "annual";
  const planInfo = () => (config.plans || []).find((p) => p.id === selPlan);
  const checkoutLabel = () => (planInfo() && planInfo().trialDays ? "Start " + planInfo().trialDays + "-day free trial" : "Subscribe");
  function renderPlans() {
    const box = $("planPick");
    const plans = config.plans || [];
    box.hidden = !plans.length;
    if (!plans.length) return;
    if (!plans.some((p) => p.id === selPlan)) selPlan = plans[0].id;
    const monthly = plans.find((p) => p.interval === "month");
    box.innerHTML = plans.map((p) => {
      const yearly = p.interval === "year";
      const note = yearly ? "$" + (p.cents / 1200).toFixed(2) + " a month" + (monthly ? ", save " + Math.round(100 * (1 - p.cents / (monthly.cents * 12))) + "%" : "") : "Cancel anytime";
      return '<button type="button" class="plan-opt" data-plan="' + p.id + '" aria-pressed="' + (p.id === selPlan) + '">' +
        (yearly ? '<span class="plan-tag">Best value</span>' : "") + '<span class="plan-name">' + (yearly ? "Annum <small>yearly</small>" : "Mensis <small>monthly</small>") + "</span>" +
        '<span class="plan-price">$' + (p.cents / 100).toFixed(2) + "<small>/" + (yearly ? "year" : "month") + "</small></span>" +
        '<span class="plan-note">' + note + "</span>" + (p.trialDays ? '<span class="plan-trial">' + p.trialDays + "-day free trial</span>" : "") + "</button>";
    }).join("");
    box.querySelectorAll(".plan-opt").forEach((b) => b.addEventListener("click", () => {
      selPlan = b.dataset.plan; sfx.click(); renderPlans(); $("pwCheckout").textContent = checkoutLabel();
    }));
  }
  async function copyText(text, btn, label) {
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied!"; }
    catch (e) { btn.textContent = "Press Ctrl+C"; }
    setTimeout(() => { btn.textContent = label; }, 2000);
  }
  function shareText(text, btn) {
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    copyText(text, btn, btn.textContent);
  }
  function dailyShareText(d, st) {
    return "Duelette Daily #" + d.num + ": " + d.score + " pts" + (d.rank ? ", #" + d.rank + " today" : "") +
      (st && st.count > 1 ? ", " + st.count + "-day streak" : "") + ". Can you beat it? " + location.origin + location.pathname;
  }
  function renderDaily(d, st) {
    const box = $("dailyCard");
    box.hidden = !DL.net.online;
    if (!DL.net.online) return;
    const icon = '<span class="daily-ic">' + DL.art.icon("target") + "</span>";
    if (d && d.done) {
      box.innerHTML = icon + '<span class="daily-text"><b>Daily Duel #' + d.num + " done: " + d.score + " pts</b><span>" +
        (d.rank ? "#" + d.rank + " of " + d.players + " today" : "Save your progress to rank") + ". Next one in " + untilReset(d.resetAt) + ".</span></span>" +
        '<button class="btn btn-sm btn-jack" id="dailyShare" type="button">Share</button>';
      $("dailyShare").addEventListener("click", () => shareText(dailyShareText(d, st), $("dailyShare")));
    } else {
      box.innerHTML = icon + '<span class="daily-text"><b>Daily Duel' + (d ? " #" + d.num : "") + "</b><span>" +
        (st && st.atRisk ? "Play today to keep your " + st.count + "-day streak. " : "") + "Same 5 spins for everyone today. Free, once a day." +
        (d && d.players ? " " + d.players + " played so far." : "") + '</span></span><button class="btn btn-go" id="dailyBtn" type="button">Play</button>';
      $("dailyBtn").addEventListener("click", () => start("daily"));
    }
  }
  function friendCard() {
    const p = mount('<div class="card search-card"><div class="card-body center">' +
      '<div class="radar"><div class="big-av" style="--pc:var(--p1)">' + DL.art.avatar(av(mine())) + "</div></div>" +
      '<h2 class="card-title">Challenge a friend</h2><p class="card-sub">Send this link. The duel starts the moment they open it. Friendly matches don\'t change ratings.</p>' +
      '<div class="share-box"><input class="name-input share-link" id="roomLink" readonly value="Making your link..." aria-label="Challenge link">' +
      '<button class="btn btn-go" id="copyLink" type="button">Copy link</button>' + (navigator.share ? '<button class="btn btn-p1" id="shareLink" type="button">Share</button>' : "") + "</div>" +
      '<p class="card-sub" id="roomInfo">Waiting for your friend to open the link...</p></div>' +
      '<div class="card-actions"><button class="btn btn-ghost" id="cancelSearch" type="button">Cancel</button></div></div>');
    p.querySelector("#cancelSearch").addEventListener("click", () => goHome(false));
    p.querySelector("#copyLink").addEventListener("click", () => copyText($("roomLink").value, $("copyLink"), "Copy link"));
    const sh = p.querySelector("#shareLink");
    if (sh) sh.addEventListener("click", () => navigator.share({ title: "Duelette", text: mine().name + " challenged you to a Duelette duel!", url: $("roomLink").value }).catch(() => {}));
  }
  function showRoom(room) {
    const el = $("roomLink");
    if (el && room) { el.value = location.origin + location.pathname + "?c=" + room; el.select(); }
  }
  function roomExpired() {
    S.phase = "final";
    mount('<div class="card"><div class="card-body center"><h2 class="card-title">This challenge expired</h2>' +
      '<p class="card-sub">Nobody opened the link in time. Make a new one and send it again.</p></div>' +
      '<div class="card-actions"><button class="btn btn-big btn-go" type="button" id="newRoom">New challenge</button><button class="btn btn-ghost" type="button" id="roomHome">Home</button></div></div>');
    $("newRoom").addEventListener("click", () => start("friend"));
    $("roomHome").addEventListener("click", () => goHome(false));
  }

  async function manageSub() {
    const r = await DL.net.portal();
    if (r.status === 200 && r.data.url) location.href = r.data.url;
    else DL.fx.toast(DL.art.icon("lock"), "Subscription", "The billing page did not open. Try again in a minute.");
  }
  async function checkout() {
    const b = $("pwCheckout");
    b.disabled = true;
    b.textContent = "Opening secure checkout...";
    const r = await DL.net.checkout(selPlan);
    if (r.status === 200 && r.data.url) { location.href = r.data.url; return; }
    b.disabled = false;
    b.textContent = checkoutLabel();
    $("pwMsg").textContent = "Checkout is unavailable right now. Try again in a minute.";
  }
  function focusSave() {
    if (!DL.net.me) return;
    $("guestBox").hidden = false;
    $("guestBox").scrollIntoView({ behavior: "smooth", block: "center" });
    $("upName").focus();
  }
  async function submitUpgrade(e) {
    e.preventDefault();
    const name = $("upName").value.trim();
    const pass = $("upPass").value;
    const msg = (t) => { $("upMsg").textContent = t; $("upMsg").className = "form-msg bad"; };
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return msg(ERR.bad_name);
    if (pass.length < 6) return msg(ERR.weak_password);
    $("upSubmit").disabled = true;
    const r = await DL.net.upgrade(name, pass);
    $("upSubmit").disabled = false;
    if (r.status !== 200) { sfx.wrong(); return msg(r.data.error === "in_game" ? "Finish your current game first." : ERR[r.data.error] || ERR.network); }
    $("upPass").value = "";
    $("upMsg").textContent = "";
    sfx.coin();
    renderHome();
    showRecovery(r.data.recovery, true);
  }
  function openPaywall(plan) {
    const me = DL.net.me;
    const guest = !me || !!me.guest;
    const p = plan || (me && me.plan);
    $("pwSub").textContent = p && !p.pro && p.left === 0
      ? "You played your " + p.limit + " free games today. They come back in " + untilReset(p.resetAt) + ", or upgrade to keep playing now."
      : "Play as much as you like, every day.";
    renderPlans();
    $("pwPrice").hidden = !config.proPrice || (config.plans || []).length > 0;
    $("pwPrice").textContent = config.proPrice;
    $("pwGuest").hidden = !guest;
    $("pwCheckout").hidden = guest || !config.checkout;
    $("pwCheckout").disabled = false;
    $("pwCheckout").textContent = checkoutLabel();
    $("pwSoon").hidden = guest || !!config.checkout;
    $("pwForm").hidden = guest;
    $("pwMsg").textContent = "";
    $("pwCode").value = "";
    $("paywall").hidden = false;
    (guest ? $("pwSave") : config.checkout ? $("pwCheckout") : $("pwCode")).focus();
  }
  async function redeemCode(e) {
    e.preventDefault();
    const code = $("pwCode").value.trim();
    if (!code) { $("pwMsg").textContent = "Enter your gift code."; return; }
    $("pwRedeem").disabled = true;
    const r = await DL.net.redeem(code);
    $("pwRedeem").disabled = false;
    if (r.status === 200) {
      $("paywall").hidden = true;
      sfx.achievement();
      DL.fx.rain(2, ["#ffe14d", "#ffffff", "#ff2e63"]);
      DL.fx.toast(DL.art.icon("crown"), "You're unlimited", "Unlimited games are on");
      renderHome();
      return;
    }
    sfx.wrong();
    $("pwMsg").textContent = { bad_code: "That code does not exist. Check it and try again.", used: "That code has already been used.",
      locked: "Too many tries. Wait 15 minutes, then try again." }[r.data.error] || ERR.network;
  }
  function codeCompare(c, me, o, solo) {
    const block = (title, src, open) => '<details class="code-cmp"' + (open ? " open" : "") + "><summary>" + esc(title) + "</summary><pre><code>" +
      esc(src && src.trim() ? src : "(nothing submitted)") + "</code></pre></details>";
    return '<div class="code-cmps"><h3 class="mastery-title">Compare solutions</h3>' + block("Your code", c.codes[me], false) +
      (solo ? "" : block(S.players[o].name + "'s code", c.codes[o], false)) + block("Model solution", c.model, true) + "</div>";
  }

  /* ---------------- Changing your name ---------------- */
  async function submitRename(e) {
    e.preventDefault();
    const me = DL.net.me;
    const name = $("newName").value.trim();
    const pass = $("renamePass").value;
    const msg = (t, kind) => { $("renameMsg").textContent = t; $("renameMsg").className = "form-msg " + (kind || "bad"); };
    if (!me) return;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return msg(ERR.bad_name);
    if (name === me.name) return msg("That is already your name.");
    if (!pass) return msg("Enter your password to confirm.");
    $("renameSubmit").disabled = true;
    const r = await DL.net.rename(name, pass);
    $("renameSubmit").disabled = false;
    if (r.status !== 200) {
      sfx.wrong();
      const e2 = r.data.error;
      if (e2 === "cooldown") return msg("You can change your name again on " + new Date(r.data.nextAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ".");
      if (e2 === "in_game") return msg("Finish your current game first.");
      if (e2 === "wrong") return msg("That password is not right.");
      return msg(ERR[e2] || ERR.network);
    }
    $("renamePass").value = "";
    $("renameMsg").textContent = "";
    $("renameBox").open = false;
    sfx.coin();
    DL.fx.toast(DL.art.icon("sparkle"), "Name changed", "You are now " + r.data.profile.name);
    renderHome();
  }

  /* ---------------- Names from the first version ---------------- */
  // The first version kept each name's secret token in this browser. If one is still here and
  // the name has not been claimed, offer to claim it with a password.
  let legacy = null;
  const oldTokens = () => { try { return JSON.parse(localStorage.getItem("duelette.tokens") || "{}") || {}; } catch (e) { return {}; } };
  function forgetOld(key) {
    try { const t = oldTokens(); delete t[key]; localStorage.setItem("duelette.tokens", JSON.stringify(t)); } catch (e) { /* storage blocked */ }
  }
  async function checkLegacy() {
    if (!DL.net.online) return;
    const toks = oldTokens();
    for (const key of Object.keys(toks)) {
      const r = await DL.net.legacy(key);
      if (r.status !== 200) return;
      if (!r.data.claimable) { forgetOld(key); continue; }
      legacy = { key, name: r.data.name, token: toks[key] };
      $("legacyTitle").textContent = "Welcome back, " + r.data.name + "!";
      $("legacySub").textContent = "Your name from the first version is safe: rating " + r.data.rating + ", " + r.data.wins + " won, " +
        r.data.losses + " lost. Choose a password to keep it and play from any device.";
      $("legacyCard").hidden = false;
      return;
    }
  }
  async function submitLegacy(e) {
    e.preventDefault();
    if (!legacy) return;
    const pass = $("legacyPass").value;
    const msg = (t) => { $("legacyMsg").textContent = t; $("legacyMsg").className = "form-msg bad"; };
    if (pass.length < 6) return msg(ERR.weak_password);
    $("legacySubmit").disabled = true;
    const r = await DL.net.claim(legacy.name, legacy.token, pass);
    $("legacySubmit").disabled = false;
    if (!r.data.token) { sfx.wrong(); return msg(r.status === 0 ? ERR.network : r.data.error === "locked" ? ERR.locked : "That did not work. Refresh the page and try again."); }
    forgetOld(legacy.key);
    legacy = null;
    $("legacyCard").hidden = true;
    $("legacyPass").value = "";
    showLogin = false;
    sfx.coin();
    renderHome();
    showRecovery(r.data.recovery, true);
  }

  /* ---------------- Starting a game ---------------- */
  let searchTick = 0;
  function resetGame(mode) {
    S.gen++;
    S.chain = Promise.resolve();
    Object.assign(S, { mode, round: 1, rounds: 5, mult: 1, spinner: 0, jackCount: 0, unlocked: new Set(), wonRound: false, cat: null, mod: null });
    DL.ui.clearOpp();
    DL.games.reset();
  }

  async function start(kind, code) {
    let me = DL.net.me;
    if (!me) {
      if (!DL.net.online) return;
      const g = await DL.net.guest(DL.art.toId(Math.floor(Math.random() * DL.art.count)));
      me = DL.net.me;
      if (!me) {
        $("modeNote").hidden = false;
        $("modeNote").textContent = g.status === 429 ? "Too many new guests from your network today. Create an account to keep playing." : ERR.network;
        return;
      }
      renderHome();
    }
    if (kind !== "daily" && me.plan && !me.plan.pro && me.plan.left === 0) { openPaywall(me.plan); return; }
    DL.audio.ensure();
    const mode = kind === "solo" || kind === "daily" ? "solo" : "duel";
    resetGame(mode);
    S.kind = kind;
    const gen = S.gen;
    S.me = 0;
    S.players = [{ name: me.name, avatar: me.avatar, rating: me.rating, rank: me.rank, score: 0, pro: !!(me.plan && me.plan.pro) }];
    if (mode === "duel") S.players.push({ name: "Searching", avatar: "c0", score: 0, hidden: true });
    S.phase = mode === "duel" ? "search" : "starting";
    show("scr-arena");
    renderHud();
    if (kind === "duel") searchCard();
    else if (kind === "friend") friendCard();
    else mount('<div class="card"><div class="card-body center"><h2 class="card-title">' + (kind === "join" ? "Joining the duel..." : "Starting your run...") + "</h2></div></div>");
    const session = await DL.net.play(kind, {
      waiting: (d) => { S.online = d.online || 1; if (d.room) showRoom(d.room); },
      expired: () => enqueue(roomExpired),
      match: (d) => enqueue(() => onMatch(d)),
      spin: (d) => enqueue(() => onSpin(d)),
      turn: (d) => enqueue(() => { S.round = d.round; S.spinner = d.spinner; S.mult = 1; phaseSpin(); }),
      q: (d) => enqueue(() => DL.games.trivia.q(d, ctx())),
      qres: (d) => enqueue(() => DL.games.trivia.qres(d, ctx())),
      code: (d) => enqueue(() => DL.games.code.start(d, ctx())),
      coderes: (d) => enqueue(() => DL.games.code.result(d, ctx())),
      hint: (d) => enqueue(() => DL.games.code.hint(d, ctx())),
      est: (d) => enqueue(() => DL.games.guess.est(d, ctx())),
      estres: (d) => enqueue(() => DL.games.guess.estres(d, ctx())),
      relay: (d) => { if (gen === S.gen && d.round === S.round && S.players[1]) DL.ui.setOpp(opp().name + ": " + d.text); },
      round: (d) => enqueue(() => onRound(d)),
      final: (d) => enqueue(() => finalScreen(d)),
      trouble: (state) => { if (state === 2 && gen === S.gen && S.phase !== "final") enqueue(lostConnection); }
    }, code);
    if (gen !== S.gen) { if (session.leave) session.leave(); return; }
    if (session.room) showRoom(session.room);
    if (session.error === "limit") {
      clearInterval(searchTick);
      goHome(false);
      openPaywall(session.plan);
      return;
    }
    if (session.error) {
      clearInterval(searchTick);
      goHome(false);
      const msg = {
        already_playing: "You already have a game open in another tab or device.",
        daily_done: "You already played today's Daily Duel. A new one starts at midnight (US Eastern).",
        expired: "That challenge link has expired. Ask your friend for a new one.",
        own_challenge: "That's your own challenge link. Send it to a friend!"
      }[session.error] || ERR[session.error] || ERR.network;
      $("modeNote").hidden = false;
      $("modeNote").textContent = msg;
      return;
    }
    S.session = session;
  }

  function ctx() {
    return {
      me: S.me, solo: S.mode === "solo", players: S.players, mod: S.mod,
      act: (type, extra) => (S.session ? S.session.act(type, extra) : null),
      report: (text) => { if (S.mode === "duel" && S.session) S.session.act("progress", { text }); }
    };
  }

  function searchCard() {
    S.online = 1;
    const t0 = Date.now();
    const p = mount(
      '<div class="card search-card"><div class="card-body center">' +
      '<div class="radar"><div class="big-av" style="--pc:var(--p1)">' + DL.art.avatar(av(mine())) + "</div></div>" +
      '<h2 class="card-title">Finding an opponent</h2><p class="card-sub" id="searchInfo">Searching the world...</p></div>' +
      '<div class="card-actions"><button class="btn btn-p1" id="botNow" type="button">Play a practice bot now</button>' +
      '<button class="btn btn-ghost" id="cancelSearch" type="button">Cancel</button></div></div>'
    );
    p.querySelector("#botNow").addEventListener("click", (e) => { e.target.disabled = true; if (S.session) S.session.act("bot"); });
    clearInterval(searchTick);
    searchTick = setInterval(() => {
      const info = $("searchInfo");
      if (!info) return;
      const s = Math.round((Date.now() - t0) / 1000);
      info.textContent = s >= 10 ? "Nobody free right now. A practice bot is joining you..." : "Searching for " + s + " sec · " + S.online + " online now";
    }, 1000);
    p.querySelector("#cancelSearch").addEventListener("click", () => goHome(false));
  }

  async function onMatch(d) {
    clearInterval(searchTick);
    S.phase = "starting"; // in a match now: quitting asks for confirmation
    S.me = d.seat;
    S.rounds = d.rounds;
    S.round = d.round;
    S.spinner = d.spinner;
    S.players = d.players.map((p) => ({ name: p.name, avatar: p.avatar, rating: p.rating, rank: p.rank, score: 0, pro: p.pro, guest: p.guest, bot: p.bot }));
    S.friendly = !!d.friendly;
    S.botMatch = !!d.bot;
    S.daily = d.daily || null;
    renderHud();
    if (!d.solo) {
      const side = (p, cls) =>
        '<div class="vs-side" data-p="' + cls + '"><div class="big-av" style="--pc:' + PCOL[cls] + '">' + DL.art.avatar(av(p)) + "</div>" +
        '<div class="vs-name">' + esc(p.name) + '</div><div class="vs-meta">' + (p.bot ? "Practice bot" : p.guest ? "Guest" : p.rank ? "Rating " + p.rating + " · #" + p.rank : "New player") + "</div></div>";
      mount('<div class="card vs-card"><div class="card-body center"><div class="vs-row">' + side(mine(), 0) +
        '<div class="vs" aria-hidden="true">VS</div>' + side(opp(), 1) + "</div>" +
        '<p class="card-sub">' + S.rounds + " rounds. Same challenges, judged by the server. " + (d.bot ? "A practice bot stepped in. Unranked, so play freely. " : d.friendly ? "Friendly match: no rating change. " : S.players.some((p) => p.guest) ? "Unranked: guests don't change ratings. " : "") +
        esc(S.spinner === S.me ? "You spin first." : opp().name + " spins first.") + "</p></div></div>");
      sfx.fanfare();
      DL.fx.burst(innerWidth / 2, innerHeight / 2, { count: 70 });
      await wait(2600);
    } else {
      sfx.fanfare();
      if (d.daily) await DL.fx.banner("Daily Duel", "Same 5 spins for everyone today", "#ffe14d", 1500);
    }
    phaseSpin();
  }

  function lostConnection() {
    S.phase = "final";
    mount('<div class="card"><div class="card-body center"><h2 class="card-title">Connection lost</h2>' +
      '<p class="card-sub">The game server stopped answering. If you are not back within 25 seconds, the game ends.</p></div>' +
      '<div class="card-actions"><button class="btn btn-big btn-go" type="button" id="lostHome">Back to start</button></div></div>')
      .querySelector("#lostHome").addEventListener("click", () => goHome(false));
  }

  /* ---------------- Spinning ---------------- */
  let spinRetry = 0;
  function phaseSpin() {
    if ($("scr-arena").hidden) return;
    S.phase = "spin";
    DL.ui.clearOpp();
    $("panel").hidden = true;
    $("wheelView").hidden = false;
    wheel.setIdle(true);
    const myTurn = S.mode === "solo" || S.spinner === S.me;
    const spinnerP = S.mode === "solo" ? mine() : S.players[S.spinner];
    wheel.setHub(DL.art.avatarImage(av(spinnerP)));
    $("spinLabel").textContent = myTurn ? "Your spin" + (S.mult > 1 ? " for score x" + S.mult + "!" : "!") : spinnerP.name + " is spinning...";
    const b = $("spinBtn");
    b.disabled = !myTurn;
    b.className = "btn btn-big " + (myTurn ? "btn-p0 pulse" : "btn-ghost");
    b.textContent = myTurn ? "Spin!" : "Waiting...";
    renderHud();
  }

  function doSpin() {
    if (S.phase !== "spin" || wheel.spinning || $("scr-arena").hidden || !S.session) return;
    if (S.mode === "duel" && S.spinner !== S.me) return;
    S.phase = "spinning";
    $("spinBtn").disabled = true;
    $("spinBtn").classList.remove("pulse");
    S.session.act("spin");
    clearTimeout(spinRetry);
    spinRetry = setTimeout(() => { if (S.phase === "spinning" && !wheel.spinning) phaseSpin(); }, 4000);
  }

  async function onSpin(d) {
    const gen = S.gen;
    clearTimeout(spinRetry);
    S.phase = "spinning";
    if ($("wheelView").hidden) { $("panel").hidden = true; $("wheelView").hidden = false; }
    $("spinBtn").disabled = true;
    $("spinBtn").classList.remove("pulse");
    if (d.auto) DL.fx.toast(DL.art.icon("clock"), "Auto spin", "The wheel spun itself after 30 seconds");
    sfx.whoosh();
    wheel.setIdle(false);
    await wheel.spin(d.index);
    if (gen !== S.gen) return;
    sfx.land();
    const wc = DL.fx.centerOf($("wheel"));
    DL.fx.burst(wc.x, wc.y - 60, { count: 50 });
    await wait(650);
    if (gen !== S.gen) return;
    S.mult = d.mult;
    if (d.jackpot) {
      if ((S.mode === "solo" || d.spinner === S.me) && ++S.jackCount >= 2) unlock("jackpotJunkie");
      sfx.jackpot();
      DL.fx.rain(1.4, ["#ffe14d", "#ffffff", "#ff7a00"]);
      renderHud();
      await DL.fx.banner("Jackpot!", "Next challenge scores x" + S.mult + ". Spin again!", "#ffe14d", 1700);
      if (gen !== S.gen) return;
      phaseSpin();
      return;
    }
    S.cat = d.cat;
    S.mod = d.mod;
    if (d.mod) {
      sfx.chaos();
      DL.fx.shake();
      await DL.fx.banner("Chaos!", DL.CATS[d.cat].name + ": " + d.mod.label, "#ff2e63", 1500);
      if (gen !== S.gen) return;
    }
    await reveal(d);
  }

  function blurb(cat, mod) {
    const is = (id) => mod && mod.id === id;
    if (cat === "trivia") return (is("extra") ? 4 : 3) + " questions, " + (is("speed") ? 5 : 10) + " seconds each. Faster right answers score more." + (is("sudden") ? " Wrong answers cost 50 pts." : "");
    if (cat === "code") return "Write one JavaScript function. The server checks it with hidden tests, and a faster solve earns a bigger bonus. Stuck? Each hint costs 20% of the round.";
    if (cat === "scam") return (is("extra") ? 5 : 4) + " real-looking texts, emails and calls, " + (is("speed") ? 6 : 12) + " seconds each. Call each one Scam or Legit." + (is("sudden") ? " Wrong calls cost 50 pts." : "");
    return (is("extra") ? 4 : 3) + " numbers to estimate, " + (is("speed") ? 8 : 15) + " seconds each. The closer your guess, the more you score." + (is("bullseye") ? " Only close guesses count, but they pay 1.5 times as much." : "");
  }

  async function reveal(d) {
    S.phase = "reveal";
    DL.ui.clearOpp();
    const p = mount(
      '<div class="card">' + catHead(d.cat, S.mult > 1 ? '<span class="mult-sticker">Score x' + S.mult + "</span>" : "") +
      '<div class="card-body center"><h2 class="card-title">' + esc(DL.CATS[d.cat].name) + '</h2><p class="card-sub">' + esc(blurb(d.cat, d.mod)) +
      (S.mode === "duel" ? " " + esc(opp().name) + " gets the exact same challenge." : "") + "</p>" +
      (d.mod ? '<div><span class="mod-sticker">Chaos: ' + esc(d.mod.label) + ". " + esc(d.mod.desc) + "</span></div>" : "") +
      '<div class="countdown" id="cd" aria-live="polite"></div></div></div>'
    );
    sfx.coin();
    const startAt = d._at + d.startIn;
    const cd = p.querySelector("#cd");
    let lastN = -1;
    const gen = S.gen;
    while (performance.now() < startAt - 250) {
      if (gen !== S.gen) return;
      const n = Math.max(1, Math.ceil((startAt - performance.now()) / 1000));
      if (n !== lastN) {
        lastN = n;
        cd.textContent = n;
        cd.classList.remove("tick"); void cd.offsetWidth; cd.classList.add("tick");
        if (n <= 3) sfx.beep();
      }
      await wait(100);
    }
    cd.textContent = "Go!";
    sfx.go();
    S.phase = "play";
  }

  /* ---------------- Results ---------------- */
  function resultRow(p, cls, chips, total, win) {
    return '<div class="res-row' + (win ? " win" : "") + '" data-p="' + cls + '"><div class="res-av">' + DL.art.avatar(av(p)) + "</div>" +
      '<div style="min-width:0"><div class="res-name">' + esc(p.name) + '</div><div class="res-chips">' +
      chips.map((c) => '<span class="bonus' + (c[1] ? " hot" : "") + '">' + esc(c[0]) + "</span>").join("") +
      '</div></div><div class="res-pts"><b data-total="' + total + '">+0</b><span class="unit">pts</span></div></div>';
  }

  function onRound(d) {
    S.phase = "result";
    const me = S.me;
    const solo = S.mode === "solo";
    const o = 1 - me;
    const before = S.players.map((p) => p.score);
    S.players.forEach((p, i) => { p.score = d.scores[i]; });
    const ev = (d.ev && d.ev[me]) || {};
    Object.keys(ev).forEach((k) => { if (ev[k]) unlock(k); });
    const win = !solo && d.winner === me;
    if (win) {
      if (!S.wonRound) { S.wonRound = true; unlock("firstBlood"); }
      if (d.streak[me] === 3) unlock("hatTrick");
      if (d.streak[me] === 5) unlock("unstoppable");
      if (d.bonus[me].some((b) => b.startsWith("Comeback"))) unlock("comeback");
    }
    const chips = (i) => d.tags[i].map((t) => [t, false]).concat(d.bonus[i].map((b) => [b, true]));
    const head = solo ? (d.totals[me] >= 150 ? "Huge round!" : d.totals[me] > 0 ? "Nice!" : "Ouch.")
      : d.winner === -1 ? "Dead even!" : win ? "You take the round!" : esc(S.players[o].name) + " takes the round";
    const rows = resultRow(S.players[me], 0, chips(me), d.totals[me], win || (solo && d.totals[me] >= 150)) +
      (solo ? "" : resultRow(S.players[o], 1, chips(o), d.totals[o], d.winner === o));
    const p = mount('<div class="card">' + catHead(d.cat || S.cat || "trivia", '<span class="pill">Round ' + d.round + " of " + S.rounds + "</span>") +
      '<div class="card-body"><h2 class="card-title">' + head + '</h2><div class="res-rows">' + rows + "</div>" + (d.code ? codeCompare(d.code, me, o, solo) : "") + "</div>" +
      '<div class="card-actions"><button class="btn btn-big btn-go" type="button" id="nextBtn">' + (d.final ? "See the result" : "Next spin") + "</button></div>" +
      (d.final || solo ? "" : '<p class="card-sub center-note">The next round starts when you both continue, or in 25 seconds.</p>') + "</div>");
    if (win || (solo && d.totals[me] > 0)) {
      sfx.win();
      const c = DL.fx.centerOf(p.querySelector(".res-row"));
      DL.fx.burst(c.x, c.y, { count: 80, colors: [PCOL[0], "#ffe14d", "#ffffff"] });
    } else if (!solo && d.winner === -1) sfx.coin(); else sfx.wrong();
    p.querySelectorAll(".res-pts b").forEach((el) => {
      const v = Number(el.dataset.total);
      countUp(el, 0, v, (x) => (x >= 0 ? "+" : "") + x);
    });
    setTimeout(() => {
      [[me, 0], [o, 1]].forEach(([seat, cls]) => {
        const sc = $("score" + cls);
        if (!sc || S.players[seat] === undefined) return;
        const delta = d.scores[seat] - before[seat];
        const c = DL.fx.centerOf(sc);
        if (delta) DL.fx.floatText((delta > 0 ? "+" : "") + delta, c.x, c.y, PCOL[cls]);
        countUp(sc, before[seat], d.scores[seat], String);
        sc.classList.remove("bump"); void sc.offsetWidth; sc.classList.add("bump");
      });
    }, 450);
    const btn = p.querySelector("#nextBtn");
    btn.focus();
    btn.addEventListener("click", () => {
      sfx.click();
      if (d.final) return finalScreen(d.final);
      if (solo) { btn.disabled = true; S.session.act("next"); return; }
      btn.disabled = true;
      btn.textContent = "Waiting for " + S.players[o].name + "...";
      S.session.act("next");
    }, { once: true });
  }

  /* ---------------- Final screens ---------------- */
  const crowned = (avatar) => '<div class="crowned"><span class="crown">' + DL.art.icon("crown") + '</span><div class="big-av" style="--pc:var(--jack)">' + DL.art.avatar(avatar) + "</div></div>";

  function finalScreen(f) {
    if (S.phase === "final") return;
    S.phase = "final";
    clearInterval(searchTick);
    if (S.session) { S.session.close(); S.session = null; }
    const solo = S.mode === "solo";
    const me = S.me;
    const o = 1 - me;
    let hero, title, sub, extra = "", color = PCOL[0];
    if (solo) {
      hero = crowned(av(mine()));
      title = f.forfeit === null ? f.scores[0] + " pts" : "Run ended";
      sub = f.forfeit === null ? "Solo run complete. Every point was judged by the server." : "You left the run, so it was not saved.";
      if (f.solo) extra = '<div class="world"><span class="pill">' + (f.solo.rank ? "World solo board" : "Guest run") + "</span><span>" +
        (f.solo.newBest ? "<b>New personal best!</b> " : "Best " + f.solo.best + ". ") + (f.solo.rank ? "World #" + f.solo.rank : "Save your progress to put scores on the world ranking.") + "</span></div>";
      if (f.solo && f.solo.newBest) { sfx.achievement(); DL.fx.rain(3); } else sfx.fanfare();
    } else {
      const won = f.winner === me;
      const tie = f.winner === -1;
      if (won) unlock("champion");
      title = tie ? "Dead heat!" : won ? "You win!" : esc(S.players[o].name) + " wins";
      sub = f.scores[me] + " to " + f.scores[o] + " pts.";
      if (f.forfeit === o) sub = esc(S.players[o].name) + " left the match. You win!";
      if (f.forfeit === me) { title = "Match lost"; sub = "You left the match or lost connection."; }
      color = won ? PCOL[0] : tie ? "var(--jack)" : PCOL[1];
      hero = tie ? '<div class="vs-row small">' + crowned(av(S.players[me])) + crowned(av(S.players[o])) + "</div>" : crowned(av(S.players[won ? me : o]));
      const r = f.ratings && f.ratings[me];
      if (r) extra = '<div class="world"><span class="pill">World rating</span><span>Rating <b id="ratingNum">' + r.before + "</b> " +
        '<span class="delta ' + (r.delta >= 0 ? "up" : "down") + '">' + (r.delta >= 0 ? "+" : "") + r.delta + "</span> · world #" + r.rank + "</span></div>";
      else if (f.unranked === "bot") extra = '<div class="world"><span class="pill">Practice match</span><span>Bot games don\'t change ratings.</span></div>';
      else if (f.unranked === "friendly") extra = '<div class="world"><span class="pill">Friendly match</span><span>No rating change. Want a rematch?</span></div>';
      else if (S.players.some((p) => p.guest)) extra = '<div class="world"><span class="pill">Unranked</span><span>Matches with guests don\'t change ratings.</span></div>';
      if (won) { sfx.fanfare(); DL.fx.rain(4, [PCOL[0], "#ffe14d", "#ffffff", "#b6f03c"]); } else if (tie) sfx.coin(); else sfx.wrong();
      if (r) setTimeout(() => countUp($("ratingNum"), r.before, r.after, String), 600);
    }
    const stk = f.streaks ? f.streaks[S.me] : null;
    if (stk && stk.count) {
      extra += '<div class="streak-line"><span class="mini-ic">' + DL.art.icon("flame") + "</span>" + stk.count + "-day streak" + (stk.extended && stk.count > 1 ? "!" : "") + "</div>" +
        (stk.saved ? '<p class="plan-note">Streak Freeze, part of your plan, saved your streak from a missed day.</p>' : "");
      if (stk.extended && stk.count > 1) sfx.achievement();
    }
    if (f.daily) {
      extra += '<div class="world"><span class="pill">Daily Duel #' + f.daily.num + "</span><span>" +
        (f.daily.rank ? "#" + f.daily.rank + " of " + f.daily.players + " today" : "Save your progress to rank today") +
        '</span><button class="btn btn-sm btn-jack" type="button" id="shareDaily">Share result</button></div>';
    }
    let buttons = S.daily
      ? [["Solo run", "btn-go", () => start("solo")], ["Find a match", "btn-p1", () => start("duel")], ["Home", "btn-ghost", () => goHome(true)]]
      : solo
        ? [["Play again", "btn-go", () => start("solo")], ["Find a match", "btn-p1", () => start("duel")], ["Home", "btn-ghost", () => goHome(true)]]
        : S.friendly
          ? [["Challenge again", "btn-go", () => start("friend")], ["Find a match", "btn-p1", () => start("duel")], ["Home", "btn-ghost", () => goHome(true)]]
          : [["Find another match", "btn-go", () => start("duel")], ["Challenge a friend", "btn-p1", () => start("friend")], ["Home", "btn-ghost", () => goHome(true)]];
    const plan = f.plans ? f.plans[S.me] : null;
    if (plan && !plan.pro) {
      extra += '<p class="plan-note">' + (plan.left ? plan.left + " free " + (plan.left === 1 ? "game" : "games") + " left today." : "That was your last free game today. More in " + untilReset(plan.resetAt) + ".") + "</p>";
      if (!plan.left) buttons = [["Upgrade", "btn-jack", () => openPaywall(plan)], buttons[2]];
    }
    if (DL.net.me && DL.net.me.guest) extra += '<p class="plan-note">Playing as a guest. <button class="text-btn" type="button" id="finalSave">Save your progress</button></p>';
    const scr = $("scr-final");
    scr.innerHTML = '<div class="card final-card"><div class="card-body center">' + hero +
      '<h2 class="final-title" style="--pc:' + color + '">' + title + '</h2><p class="card-sub">' + sub + "</p>" + extra +
      '<div class="ach-list">' + (Array.from(S.unlocked).map((k) => '<span class="bonus hot"><span class="mini-ic">' + DL.art.icon(ACH[k][0]) + "</span>" + esc(ACH[k][1]) + "</span>").join("") ||
        '<span class="bonus">No badges this time</span>') + "</div></div>" +
      '<div class="card-actions">' + buttons.map((b, i) => '<button class="btn btn-big ' + b[1] + '" type="button" data-b="' + i + '">' + b[0] + "</button>").join("") + "</div></div>";
    scr.querySelectorAll("[data-b]").forEach((el) => el.addEventListener("click", () => buttons[Number(el.dataset.b)][2]()));
    const sd = $("shareDaily");
    if (sd && f.daily) sd.addEventListener("click", () => shareText(dailyShareText(f.daily, stk), sd));
    const fsave = $("finalSave");
    if (fsave) fsave.addEventListener("click", () => { goHome(true); focusSave(); });
    show("scr-final");
    DL.net.loadMe().then(renderHome);
  }

  function goHome(fromFinal) {
    S.gen++;
    clearInterval(searchTick);
    clearTimeout(spinRetry);
    wheel.stop();
    DL.audio.hush();
    DL.games.reset();
    if (S.session) { if (S.phase !== "final") S.session.leave(); else S.session.close(); S.session = null; }
    S.phase = "home";
    S.mode = null;
    DL.fx.clear();
    wheel.setIdle(true);
    show("scr-home");
    $("modeNote").hidden = true;
    renderHome();
    if (!fromFinal) DL.net.loadMe().then(renderHome);
  }

  /* ---------------- HUD ---------------- */
  function plate(p, cls, meta) {
    if (p.pro) meta = '<span class="tok pro-tok">Member</span>' + meta;
    return '<div class="plate-av">' + DL.art.avatar(av(p)) + '</div><div class="plate-name">' + esc(p.name) + "</div>" +
      '<div class="plate-score" title="Score"><b id="score' + cls + '">' + p.score + '</b><span class="unit">pts</span></div><div class="plate-meta">' + meta + "</div>";
  }
  function renderHud() {
    const p0 = $("plate0");
    const p1 = $("plate1");
    const me = DL.net.me;
    if (S.mode === "solo") {
      p0.innerHTML = plate(mine(), 0, '<span class="tok">You</span>');
      p1.innerHTML = '<div class="plate-av best-av">' + DL.art.icon("crown") + '</div><div class="plate-name">Your best</div>' +
        '<div class="plate-score" title="Best solo score"><b id="score1">' + (me ? me.soloBest : 0) + '</b><span class="unit">pts</span></div><div class="plate-meta"><span class="tok">Solo</span></div>';
      p0.classList.add("is-turn"); p1.classList.remove("is-turn");
    } else {
      const o = opp();
      p0.innerHTML = plate(mine(), 0, '<span class="tok">You</span>' + (mine().rank ? '<span class="tok" title="World rating">' + mine().rating + "</span>" : ""));
      p1.innerHTML = o.hidden
        ? '<div class="plate-av searching">' + DL.art.icon("globe") + '</div><div class="plate-name">Searching...</div><div class="plate-score"><b id="score1">0</b><span class="unit">pts</span></div><div class="plate-meta"></div>'
        : plate(o, 1, o.rank ? '<span class="tok" title="World rating">' + o.rating + "</span>" : '<span class="tok">New</span>');
      p0.classList.toggle("is-turn", S.phase !== "search" && S.spinner === S.me);
      p1.classList.toggle("is-turn", S.phase !== "search" && S.spinner !== S.me);
    }
    $("roundTxt").textContent = "Round " + S.round + " of " + S.rounds;
    $("multTxt").hidden = S.mult < 2;
    $("multTxt").textContent = "Jackpot: score x" + S.mult;
  }

  function countUp(el, from, to, fmt) {
    if (!el) return;
    const t0 = performance.now();
    let i = 0;
    (function step(now) {
      const t = Math.min(1, (now - t0) / 700);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (i++ % 3 === 0 && from !== to) sfx.count(i % 8);
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  function unlock(key) {
    if (S.unlocked.has(key) || !ACH[key]) return;
    S.unlocked.add(key);
    const a = ACH[key];
    setTimeout(() => { sfx.achievement(); DL.fx.toast(DL.art.icon(a[0]), "Badge unlocked", a[1]); }, 400 + S.unlocked.size * 250);
  }

  /* ---------------- World ranking ---------------- */
  let board = "duel";
  let rankFrom = "scr-home";
  function openRank() {
    rankFrom = $("scr-final").hidden ? "scr-home" : "scr-final";
    show("scr-rank");
    loadBoard();
  }
  async function loadBoard() {
    $("tabToday").setAttribute("aria-selected", String(board === "today"));
    $("tabDuel").setAttribute("aria-selected", String(board === "duel"));
    $("tabSolo").setAttribute("aria-selected", String(board === "solo"));
    $("rankNote").textContent = board === "today" ? "Today's Daily Duel: same 5 spins for everyone. Resets at midnight US Eastern."
      : board === "duel"
      ? "Ratings start at 1000. Beating a stronger player moves you up faster."
      : "Best score from a single 5 round solo run. Every score is judged by the server.";
    if (DL.net.me && DL.net.me.guest) $("rankNote").textContent += " You're playing as a guest, so your games don't count here yet. Save your progress to join the ranking.";
    const list = $("rankList");
    list.innerHTML = '<p class="rank-empty">Loading the world ranking...</p>';
    const r = await DL.net.board(board);
    if (r.status !== 200) {
      list.innerHTML = '<p class="rank-empty">' + (DL.net.online ? "Can't reach the ranking server right now." : "Open the hosted link to see the world ranking.") + "</p>";
      return;
    }
    const rows = r.data.players;
    if (!rows.length) {
      list.innerHTML = '<p class="rank-empty">' + (board === "today" ? "Nobody has played today's Daily Duel yet. Be the first." : board === "duel" ? "No duels yet. Find a match and take the top spot." : "No solo runs yet. Be the first on the board.") + "</p>";
      return;
    }
    const myName = DL.net.me ? DL.net.me.name.toLowerCase() : "";
    const head = board === "today" ? '<th scope="col">Score</th><th scope="col">Streak</th>' : board === "duel" ? '<th scope="col">Rating</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col">Best</th>' : '<th scope="col">Best</th><th scope="col">Runs</th>';
    list.innerHTML = '<div class="rank-scroll"><table class="rank-table"><thead><tr><th scope="col">#</th><th scope="col">Player</th>' + head + "</tr></thead><tbody>" +
      rows.map((p) => {
        const isMe = p.name.toLowerCase() === myName;
        const cells = board === "today" ? '<td class="num strong">' + p.score + '</td><td class="num">' + p.streak + "</td>" : board === "duel"
          ? '<td class="num strong">' + p.rating + '</td><td class="num">' + p.wins + '</td><td class="num">' + p.losses + '</td><td class="num">' + p.best + "</td>"
          : '<td class="num strong">' + p.soloBest + '</td><td class="num">' + p.soloRuns + "</td>";
        return '<tr class="' + (p.rank <= 3 ? "medal-" + p.rank : "") + (isMe ? " is-me" : "") + '"><td class="num rank-no">' + p.rank + "</td>" +
          '<td><span class="rank-player"><span class="rank-av">' + DL.art.avatar(DL.art.fromId(p.avatar)) + "</span>" + esc(p.name) + (p.pro ? ' <span class="tok pro-tok">Member</span>' : "") +
          (isMe ? ' <span class="tok">You</span>' : "") + "</span></td>" + cells + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="rank-foot">' + r.data.online + " playing right now</p>";
  }

  /* ---------------- Controls ---------------- */
  let quitArmed = 0;
  $("quitBtn").addEventListener("click", () => {
    const atStake = S.phase !== "search" && S.phase !== "final";
    if (atStake && Date.now() - quitArmed > 3000) {
      quitArmed = Date.now();
      $("quitBtn").textContent = S.mode === "duel" ? "Tap again: you lose" : "Tap again to quit";
      $("quitBtn").classList.add("armed");
      setTimeout(() => { $("quitBtn").textContent = S.mode === "duel" ? "Forfeit" : "Quit run"; $("quitBtn").classList.remove("armed"); }, 3000);
      return;
    }
    $("quitBtn").classList.remove("armed");
    goHome(false);
  });
  $("homeBtn").addEventListener("click", () => { if (S.phase === "home") return; if (!$("scr-arena").hidden) return $("quitBtn").click(); goHome(true); });
  const muteBtn = $("muteBtn");
  const paintMute = () => { muteBtn.textContent = DL.audio.muted ? "Sound: Off" : "Sound: On"; muteBtn.setAttribute("aria-pressed", String(!DL.audio.muted)); };
  muteBtn.addEventListener("click", () => { DL.audio.toggle(); paintMute(); sfx.click(); });
  paintMute();
  $("soloBtn").addEventListener("click", () => start("solo"));
  $("matchBtn").addEventListener("click", () => start("duel"));
  $("spinBtn").addEventListener("click", doSpin);
  $("wheel").addEventListener("click", doSpin);
  $("rankBtn").addEventListener("click", openRank);
  $("rankBack").addEventListener("click", () => show(rankFrom));
  $("tabDuel").addEventListener("click", () => { board = "duel"; loadBoard(); });
  $("tabSolo").addEventListener("click", () => { board = "solo"; loadBoard(); });
  addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (e.code === "Space" && S.phase === "spin" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") { e.preventDefault(); doSpin(); }
  });

  buildHome();
  show("scr-home");
  renderHome();
  (DL.net.online && DL.net.signedIn ? DL.net.loadMe() : Promise.resolve(null)).then((r) => {
    renderHome();
    if (r === "offline") { $("modeNote").hidden = false; $("modeNote").textContent = ERR.network; }
    checkLegacy();
  });
  // A friend challenge link: ?c=CODE
  const invite = (new URLSearchParams(location.search).get("c") || "").toUpperCase();
  if (invite && DL.net.online) {
    history.replaceState(null, "", location.pathname);
    DL.net.challenge(invite).then((r) => {
      if (r.status === 200 && r.data.valid) {
        $("inviteAv").innerHTML = DL.art.avatar(DL.art.fromId(r.data.avatar));
        $("inviteTitle").textContent = r.data.host + " challenged you to a duel!";
        $("inviteCard").hidden = false;
        $("inviteAccept").onclick = () => { $("inviteCard").hidden = true; start("join", invite); };
        $("inviteSkip").onclick = () => { $("inviteCard").hidden = true; };
      } else {
        DL.fx.toast(DL.art.icon("clock"), "Challenge expired", "Ask your friend to send a new link.");
      }
    });
  }
  // Back from Lemon Squeezy checkout: wait for the webhook to switch the plan on.
  if (/[?&]pro=thanks\b/.test(location.search)) {
    history.replaceState(null, "", location.pathname);
    DL.fx.toast(DL.art.icon("crown"), "Thank you!", "Switching on your plan...");
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      const me = await DL.net.loadMe();
      const pro = !!(me && me.plan && me.plan.pro);
      if (pro || tries > 20) {
        clearInterval(poll);
        renderHome();
        if (pro) { sfx.achievement(); DL.fx.rain(2.5, ["#ffe14d", "#ffffff", "#ff2e63"]); DL.fx.toast(DL.art.icon("crown"), "You're unlimited", "Unlimited games are on"); }
        else DL.fx.toast(DL.art.icon("clock"), "Still processing", "Your plan switches on as soon as the payment is confirmed.");
      }
    }, 3000);
  }
  DL.game = { S };
})();
