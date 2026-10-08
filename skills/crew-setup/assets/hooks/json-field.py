"""Print one field of a JSON document read from stdin.

Used by readonly-guard.sh when jq is not installed. The path uses jq's simple
dot form, for example ".tool_input.command". Missing fields print nothing.
"""
import json
import sys

value = json.load(sys.stdin)
for key in sys.argv[1].strip(".").split("."):
    value = value.get(key) if isinstance(value, dict) else None
if value is not None:
    print(value)
