# Geliştirme

Plugin'i test etme ve derleme komutları.

[← README](../../README.tr.md) · [English](../guide/develop.md)

```bash
claude --plugin-dir .                      # bu checkout'u tek oturum için yükle
python3 tests/test_guard.py                # guard testleri, jq'lu ve jq'suz
python3 tests/test_session_policy.py       # oturum hook'u: politika ve devir teklifinin ne zaman çıktığı
python3 tests/test_mode_guard.py           # solo modu: kaydet ve engelle
python3 tests/test_plugin_notices.py       # ne yeni, Claude Code sürümü ve eski oturum bildirimleri
python3 tests/test_compact_restore.py      # compact'ten sonra geri basılanlar (sh ve dash)
python3 tools/build_mod.py                 # modu düzenledikten sonra hooks/register.js'i hooks/src/'den yeniden üret (--check ile doğrula)
python3 tools/build_assets.py              # agents/ ya da scripts/ düzenlendikten sonra skills/crew-setup/assets'i yeniden üret
node --test tests/*.test.mjs               # saver, compact, tidy, report ve ajan satırı mantığı, mesajlar, dil tespiti (düz Node)
claude plugin test                         # modun hook'ları, stub'larla (oturum yok, ağ yok)
claude plugin validate . --strict          # marketplace manifest'i
claude plugin validate .claude-plugin/plugin.json --strict
```

Davranış eval'leri (`evals/`, gerçek model çağrısı yapar ve faturalanır) ve görev başına maliyet karşılaştırması (`python3 evals/compare/compare.py`) için [İngilizce develop sayfasına](../guide/develop.md) bak.
