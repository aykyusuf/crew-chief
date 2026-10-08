#!/bin/sh
mkdir -p src
printf 'def a():\n    # TODO: handle empty input\n    return 1\n' > src/a.py
printf 'def b():\n    return 2  # TODO: cache this\n' > src/b.py
printf 'def c():\n    return 3\n' > src/c.py
