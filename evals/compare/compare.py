#!/usr/bin/env python3
"""Cost per finished task: the same small tasks, with and without crew-chief's routing.

    python3 evals/compare/compare.py                 # dry run: lists what would run, runs nothing, costs nothing
    python3 evals/compare/compare.py --run --budget 3 --arms solo,routed,ultra --model sonnet

Arms (each task runs once per arm, in its own fresh temp folder):
  solo    the Agent tool is disallowed: everything stays in the main session
  routed  the plugin as it is (Claude decides what to delegate)
  ultra   the plugin with CREW_CHIEF_ULTRA=on (subagents off Opus)
It reads `total_cost_usd`, turns and duration from `claude -p --output-format json`, then runs the task's
`check` to see whether it was really finished. The table is cost per FINISHED task: a cheap run that did not
finish counts as no result. A multi-model setup is worth keeping only if it beats the solo point.

THIS SPENDS MONEY (real model calls). Nothing runs without --run, each call is capped by --max-budget-usd
(--budget split across the planned runs), and the first failure stops nothing: every run is recorded.
One run per cell is a sample of one; repeat with --repeat before trusting a difference.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(os.path.dirname(HERE))


def run_arm(arm, task, model, effort, per_run_budget, timeout):
    work = tempfile.mkdtemp(prefix="crew-compare-")
    try:
        subprocess.run(task["setup"], shell=True, cwd=work, check=True)
        cmd = ["claude", "-p", "--model", model, "--effort", effort, "--output-format", "json",
               "--max-budget-usd", f"{per_run_budget:.2f}", "--permission-mode", "acceptEdits",
               "--allowedTools", "Bash,Read,Edit,Write,Glob,Grep", "--no-session-persistence"]
        env = dict(os.environ, CREW_CHIEF_UI="off", CREW_CHIEF_GUARD="off")
        if arm == "solo":
            cmd += ["--disallowedTools", "Agent"]
        if arm == "ultra":
            env["CREW_CHIEF_ULTRA"] = "on"
        cmd += ["--plugin-dir", PLUGIN, task["prompt"]]
        start = time.time()
        try:
            out = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            data = json.loads(out.stdout) if out.stdout.strip().startswith("{") else {}
        except subprocess.TimeoutExpired:
            data = {"timeout": True}
        ok = subprocess.run(task["check"], shell=True, cwd=work, capture_output=True).returncode == 0
        return {"arm": arm, "task": task["id"], "cost": data.get("total_cost_usd"), "turns": data.get("num_turns"),
                "seconds": round(time.time() - start, 1), "finished": ok, "error": data.get("is_error") or data.get("timeout") or False}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def table(rows, arms):
    lines = [f"{'arm':8} {'finished':>9} {'cost total':>11} {'$/finished task':>16} {'avg turns':>10} {'avg s':>7}"]
    for arm in arms:
        rs = [r for r in rows if r["arm"] == arm]
        if not rs:
            continue
        done = [r for r in rs if r["finished"]]
        cost = sum(r["cost"] or 0 for r in rs)
        per = f"${cost / len(done):.3f}" if done else "n/a"
        turns = [r["turns"] for r in rs if r["turns"] is not None]
        lines.append(f"{arm:8} {len(done):>4}/{len(rs):<4} ${cost:>9.3f} {per:>16} {sum(turns) / len(turns) if turns else 0:>10.1f} {sum(r['seconds'] for r in rs) / len(rs):>7.1f}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", action="store_true", help="actually call the model (costs money)")
    ap.add_argument("--arms", default="solo,routed", help="comma list from solo,routed,ultra")
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--budget", type=float, default=2.0, help="total dollars for the whole comparison")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--out", default=os.path.join(HERE, "last-run.json"))
    a = ap.parse_args()
    arms = [x for x in a.arms.split(",") if x in ("solo", "routed", "ultra")]
    tasks = json.load(open(os.path.join(HERE, "tasks.json")))["tasks"]
    plan = [(arm, t) for _ in range(a.repeat) for t in tasks for arm in arms]
    per = a.budget / max(1, len(plan))
    print(f"{len(plan)} runs planned ({len(tasks)} tasks x {len(arms)} arms x {a.repeat}), model {a.model}/{a.effort}, about ${per:.2f} cap per run, ${a.budget:.2f} total cap")
    for arm, t in plan:
        print(f"  {arm:7} {t['id']}")
    if not a.run:
        print("\nDry run: nothing was called. Add --run to spend money.")
        return 0
    rows = []
    for arm, t in plan:
        r = run_arm(arm, t, a.model, a.effort, per, a.timeout)
        rows.append(r)
        print(f"  {arm:7} {t['id']:12} cost={r['cost']} finished={r['finished']} turns={r['turns']} {r['seconds']}s")
        json.dump(rows, open(a.out, "w"), indent=2)
    print("\n" + table(rows, arms))
    return 0


if __name__ == "__main__":
    sys.exit(main())
