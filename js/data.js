// Display info for the challenge categories. The challenges themselves (questions, answers,
// code tests, estimates) live only on the server in content.json, so answers never reach the browser.
window.DL = window.DL || {};

DL.CATS = {
  code:   { id: "code",   label: "Code",   name: "Code Sprint",  color: "#b6f03c", text: "#1b1035", icon: "code" },
  guess:  { id: "guess",  label: "Guess",  name: "Ballpark",     color: "#ff7a00", text: "#1b1035", icon: "target" },
  trivia: { id: "trivia", label: "Trivia", name: "Trivia Blitz", color: "#8c52ff", text: "#ffffff", icon: "quiz" }
};
