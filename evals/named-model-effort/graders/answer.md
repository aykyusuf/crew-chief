---
type: llm
---

PASS if the final reply lists both TODOs: one in src/a.py about handling empty input and one in src/b.py about caching, each with a line number.
FAIL if either is missing or src/c.py is reported as having a TODO.
