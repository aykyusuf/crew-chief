"""Tests for scripts/subagent-row.sh. Run: python3 tests/test_subagent_row.py (needs jq)."""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "subagent-row.sh")

if not shutil.which("jq"):
    print("skip: jq not installed")
    sys.exit(0)

payload = {
    "columns": 80,
    "tasks": [
        {"id": "a", "agentType": "crew-chief:ui-tester", "status": "running", "description": "Check login",
         "label": "Checking the login flow", "startTime": 1, "model": "claude-sonnet-5-5", "effort": "medium",
         "tokenCount": 41234, "tokenSamples": [1], "cwd": "/x"},
        {"id": "b", "agentType": "Explore", "status": "running", "description": "Find files", "startTime": 1,
         "tokenCount": 812, "tokenSamples": [1], "cwd": "/x"},
        {"id": "c", "name": "architect", "agentType": "architect", "model": "claude-opus-5-5", "effort": "xhigh",
         "status": "running", "description": "x" * 200, "startTime": 1, "tokenCount": 63100,
         "tokenSamples": [1], "cwd": "/x"},
    ],
}
out = subprocess.run([SCRIPT], input=json.dumps(payload), capture_output=True, text=True, check=True).stdout
rows = {r["id"]: r["content"] for r in map(json.loads, out.splitlines())}
checks = [
    ("a" in rows and rows["a"].startswith("ui-tester ") and "sonnet-5.5 · medium · 41.2k" in rows["a"], "plugin agent row"),
    ("starting · default · 812" in rows.get("b", ""), "unresolved model, no effort"),
    ("opus-5.5 · xhigh · 63.1k" in rows.get("c", "") and rows["c"].endswith("…"), "long row keeps model and tokens, truncates text"),
    (subprocess.run([SCRIPT], input="{}", capture_output=True, text=True).stdout == "", "no tasks, no output"),
]
failed = [name for ok, name in checks if not ok]
if failed:
    print("FAIL:", failed, rows)
    sys.exit(1)
print(f"OK {len(checks)}/{len(checks)}")
