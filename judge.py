"""Server-side judging: estimation guesses and sandboxed code checks.

Nothing a browser reports is trusted. Guesses are scored here against answers the browser
never sees, and code is re-run here inside bubblewrap (no network, no home folder) against
visible and hidden tests.
"""
import json
import math
import os
import re
import shutil
import subprocess
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "sandbox", "runner.js")
NODE = shutil.which("node") or "/usr/bin/node"
BWRAP = shutil.which("bwrap")
# Local development without bubblewrap (for example on Windows) must opt in explicitly.
UNSAFE_LOCAL = os.environ.get("DUELETTE_UNSAFE_LOCAL") == "1"
_slots = threading.BoundedSemaphore(3)


# ------------------------------------------------------------------ estimation

def guess_points(item, value, bullseye=False):
    """Points for a guess, plus a 0..1 accuracy used for ratings.

    "log" questions score by ratio (tol is the factor at which points reach zero), so
    being 2x off on a population counts the same whatever its size. "lin" questions score
    by distance (tol is in the question's own units), which suits years and small counts.
    """
    answer = float(item["a"])
    guess = float(value)
    if item["scale"] == "log":
        err = abs(math.log(max(guess, 1e-9) / answer))
        tol = math.log(item["tol"])
    else:
        err = abs(guess - answer)
        tol = float(item["tol"])
    if bullseye:
        tol /= 2
    accuracy = max(0.0, 1 - err / tol)
    return round(100 * accuracy * (1.5 if bullseye else 1)), accuracy


# ------------------------------------------------------------------ code

def rule_break(code, item, mod_id):
    for banned in item.get("ban", []):
        if banned in code:
            return banned + " is banned in this challenge."
    if mod_id == "noloops" and re.search(r"\b(for|while)\b", code):
        return "No loops allowed."
    if mod_id == "oneliner" and "\n" in code.strip():
        return "One-liner rule: the solution must fit on one line."
    return ""


def run_code(code, item):
    """Run code against visible plus hidden tests. Returns {passed, total, error}."""
    tests = item["tests"] + item.get("hidden", [])
    job = json.dumps({"code": code, "fn": item["fn"], "tests": tests})
    if BWRAP:
        cmd = ["prlimit", "--cpu=4", "--nofile=64", BWRAP, "--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
               "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
               "--symlink", "usr/bin", "/bin", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
               "--ro-bind", RUNNER, "/runner.js", "--chdir", "/tmp",
               NODE, "--max-old-space-size=64", "/runner.js"]
    elif UNSAFE_LOCAL:
        cmd = [NODE, "--max-old-space-size=64", RUNNER]
    else:
        return {"passed": 0, "total": len(tests), "error": "Code checking is not available on this server."}
    with _slots:
        try:
            proc = subprocess.run(cmd, input=job.encode("utf-8"), capture_output=True, timeout=8)
            out = json.loads(proc.stdout.decode("utf-8", "replace")[:200000] or "{}")
        except subprocess.TimeoutExpired:
            return {"passed": 0, "total": len(tests), "error": "Timed out."}
        except (ValueError, OSError):
            return {"passed": 0, "total": len(tests), "error": "The checker crashed on this code."}
    if "error" in out:
        return {"passed": 0, "total": len(tests), "error": str(out["error"])[:200]}
    results = out.get("results") or []
    return {"passed": sum(1 for r in results if r.get("ok") is True), "total": len(tests), "error": ""}
