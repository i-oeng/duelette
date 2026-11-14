// Runs one code submission against its tests. Started by judge.py inside a bubblewrap sandbox
// (no network, no home folder, private /tmp), reading one JSON job on stdin:
//   { code, fn, tests: [[args, expected], ...] }
// and printing { error } or { results: [{ ok, got }] } on stdout.
"use strict";
const vm = require("vm");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 100000) process.exit(3);
});
process.stdin.on("end", () => {
  let job;
  try { job = JSON.parse(input); } catch (e) { process.stdout.write(JSON.stringify({ error: "bad job" })); return; }
  process.stdout.write(JSON.stringify(run(job)));
});

function text(err) {
  return String((err && err.message) || err).slice(0, 200);
}

function run(job) {
  // A fresh realm with only the JavaScript built-ins: no require, no process.
  const ctx = vm.createContext(Object.create(null));
  try {
    vm.runInContext(job.code + "\n;globalThis.__fn = typeof " + job.fn + ' === "function" ? ' + job.fn + " : undefined;", ctx, { timeout: 1000 });
  } catch (e) {
    return { error: text(e) };
  }
  if (typeof ctx.__fn !== "function") return { error: "No function named " + job.fn };
  const results = job.tests.map(([args, expected]) => {
    try {
      ctx.__args = JSON.stringify(args);
      const got = vm.runInContext("__fn.apply(undefined, JSON.parse(__args))", ctx, { timeout: 1000 });
      const g = got === undefined ? "undefined" : JSON.stringify(got);
      return { ok: g === JSON.stringify(expected), got: String(g).slice(0, 120) };
    } catch (e) {
      return { ok: false, got: "Error: " + text(e) };
    }
  });
  return { results };
}
