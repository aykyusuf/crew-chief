#!/bin/sh
mkdir -p src docs
printf '# TODO: validate input\nprint(1)\n' > src/a.py
printf '# TODO: handle errors\n# TODO: add logging\nprint(2)\n' > src/b.py
printf '# Notes\nTODO in docs is not counted.\n' > docs/notes.md
