// Display info for the challenge categories. The challenges themselves (questions, answers,
// code tests, estimates) live only on the server in content.json, so answers never reach the browser.
window.DL = window.DL || {};

DL.CATS = {
  code:   { id: "code",   label: "Code",   name: "Code Sprint",  color: "#b6f03c", text: "#1b1035", icon: "code" },
  guess:  { id: "guess",  label: "Guess",  name: "Ballpark",     color: "#ff7a00", text: "#1b1035", icon: "target" },
  trivia: { id: "trivia", label: "Trivia", name: "Trivia Blitz", color: "#8c52ff", text: "#ffffff", icon: "quiz" },
  scam:   { id: "scam",   label: "Scam?",  name: "Spot the Scam", color: "#00c9c8", text: "#1b1035", icon: "shield" },
  math:   { id: "math",   label: "Math",   name: "Money Math",    color: "#1f6bff", text: "#ffffff", icon: "calc" },
  myth:   { id: "myth",   label: "Myth?",  name: "Myth or Fact",  color: "#ff2e63", text: "#1b1035", icon: "toggle" },
  first:  { id: "first",  label: "First?", name: "Which Came First", color: "#fff3d6", text: "#1b1035", icon: "hourglass" },
  review: { id: "review", label: "Review", name: "Smart Review",  color: "#19c37d", text: "#1b1035", icon: "rise" }
};

// Two color themes. Classic: sunburst yellow stickers. Zimrany: the violet, black and white of zimran.io.
// CSS handles the page; these cover what scripts draw (wheel, confetti, banners, category colors).
DL.PALETTES = {
  classic: {
    ink: "#1b1035", paper: "#fff8e7", font: '"Bungee", "Arial Black", Impact, sans-serif',
    you: "#ff2e63", opp: "#1f6bff", gold: "#ffe14d", hot: "#ff2e63", warm: "#ff7a00", zest: "#b6f03c",
    pointer: "#ff2e63", bulbOn: "#fff3a0", bulbOff: "#6b4f00", glow: "#ffe14d", stripe: "rgba(255,255,255,.55)",
    confetti: ["#ff2e63", "#1f6bff", "#b6f03c", "#ff7a00", "#8c52ff", "#00c9c8", "#ffe14d", "#ffffff"],
    cats: { code: ["#b6f03c", "#1b1035"], guess: ["#ff7a00", "#1b1035"], trivia: ["#8c52ff", "#ffffff"], scam: ["#00c9c8", "#1b1035"],
      math: ["#1f6bff", "#ffffff"], myth: ["#ff2e63", "#1b1035"], first: ["#fff3d6", "#1b1035"], jack: ["#ffe14d", "#1b1035"], chaos: ["#1b1035", "#ffe14d"], review: ["#19c37d", "#1b1035"] }
  },
  zimrany: {
    ink: "#0c0c0c", paper: "#ffffff", font: '"Unbounded", "Arial Black", sans-serif',
    you: "#5b42dc", opp: "#0c0c0c", gold: "#ffffff", hot: "#c9c2ff", warm: "#9d8fff", zest: "#e2e2ed",
    pointer: "#ffffff", bulbOn: "#ffffff", bulbOff: "#3b2a8f", glow: "#c9c2ff", stripe: "rgba(91,66,220,.2)",
    confetti: ["#ffffff", "#e2e2ed", "#c9c2ff", "#9d8fff", "#7367ff", "#5b42dc", "#0c0c0c"],
    cats: { trivia: ["#5553f5", "#ffffff"], guess: ["#e2e2ed", "#0c0c0c"], scam: ["#0c0c0c", "#ffffff"], math: ["#9d8fff", "#0c0c0c"],
      code: ["#2a1d7a", "#ffffff"], myth: ["#c9c2ff", "#0c0c0c"], first: ["#f2f2f2", "#4f31ba"], jack: ["#ffffff", "#5b42dc"], chaos: ["#4f31ba", "#ffffff"], review: ["#7367ff", "#ffffff"] }
  }
};
DL.theme = () => (document.documentElement.dataset.theme === "zimrany" ? "zimrany" : "classic");
DL.pal = () => DL.PALETTES[DL.theme()];
DL.applyPalette = () => {
  const p = DL.pal();
  Object.keys(DL.CATS).forEach((k) => { if (p.cats[k]) { DL.CATS[k].color = p.cats[k][0]; DL.CATS[k].text = p.cats[k][1]; } });
};
DL.applyPalette();
