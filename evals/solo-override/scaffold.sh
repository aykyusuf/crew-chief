#!/bin/sh
mkdir -p docs/guides notes
for f in README.md docs/intro.md docs/guides/setup.md docs/guides/usage.md notes/todo.md; do
  printf '# %s\n\nPlaceholder.\n' "$f" > "$f"
done
printf 'print("hi")\n' > app.py
