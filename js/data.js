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
  first:  { id: "first",  label: "First?", name: "Which Came First", color: "#fff3d6", text: "#1b1035", icon: "hourglass" }
};
