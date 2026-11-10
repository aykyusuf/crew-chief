mkdir -p src tests
printf "def calc_total(x):\n    return x\n" > src/a.py
printf "from a import calc_total\nprint(calc_total(2))\n" > src/b.py
printf "from a import calc_total\n" > tests/test_a.py
