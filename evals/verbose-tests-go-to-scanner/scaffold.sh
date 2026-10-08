#!/bin/sh
cat > run_tests.sh <<'SH'
#!/bin/sh
i=1
while [ $i -le 1500 ]; do
  echo "test_case_$i ... ok (0.0${i}s) [debug: fixture loaded, cache warm, retries=0]"
  if [ $i -eq 412 ]; then echo "test_parse_dates ... FAILED: expected 2026-01-31, got 2026-02-31"; fi
  if [ $i -eq 1188 ]; then echo "test_refund_rounding ... FAILED: expected 10.05, got 10.04"; fi
  i=$((i + 1))
done
echo "1502 tests, 2 failed"
exit 1
SH
chmod +x run_tests.sh
