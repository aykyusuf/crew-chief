#!/bin/sh
# Writes a fake test runner whose output is long and noisy, with two failures
# buried in it. Static text only.
printf '%s\n' \
  '#!/bin/sh' \
  "ok='test_case ... ok (0.01s) [debug: fixture loaded, cache warm, retries=0]'" \
  'yes "$ok" | head -n 411' \
  "echo 'test_parse_dates ... FAILED: expected 2026-01-31, got 2026-02-31'" \
  'yes "$ok" | head -n 776' \
  "echo 'test_refund_rounding ... FAILED: expected 10.05, got 10.04'" \
  'yes "$ok" | head -n 313' \
  "echo '1502 tests, 2 failed'" \
  'exit 1' > run_tests.sh
chmod +x run_tests.sh
