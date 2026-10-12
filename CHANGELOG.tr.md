# Değişiklik günlüğü (Türkçe)

Türkçe notlar 0.3.0'dan başlar; öncesi için [CHANGELOG.md](CHANGELOG.md) (İngilizce). Bildirim Türkçe olduğunda "ne yeni" maddeleri buradan okunur; bu dosyada o sürümün bölümü yoksa İngilizce olanı gösterilir.

## 0.4.0 (2026-10-12)
- Panel satırı çalışan alt ajanlar için geçen süreyi (`· 4m12s`) gösterir; ajan rapor verdiyse yaklaşık yüzdeyi, o an yaptığı işi ve neden yavaş olduğunu da ekler: `implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite`.
- Yeni PostToolUse hook'u `scripts/progress-hook.sh` her alt ajan için `${TMPDIR:-/tmp}/crew-chief-progress/` altında küçük bir ilerleme dosyası tutar (12 saat sonra silinir). `deep-reader`, `implementer`, `implementer-hard`, `reviewer` ve `ui-tester` yaklaşık her 10 tool çağrısında `: 'crew-progress 40 | adım | gecikme'` diye tek satırlık rapor verir (turn limitine sayılan, etkisiz bir Bash çağrısı). Yüzde ajanın kendi tahminidir. 45 sn ve üstü süren tool çağrısı gecikme notunu kendisi ekler. `jq` gerekir.
- Read-only guard, read-only ajanların ilerleme raporuna izin verir.
- Claude Code 2.1.296'da doğrulandı: panel satırındaki task `id`, hook'taki `agent_id` ile aynı; satır birkaç saniyede bir yenileniyor.

## 0.3.3 (2026-10-11)
- Panel satırı düzeltildi: Claude Code, plugin `settings.json`'ındaki `subagentStatusLine`'ı okuyor ama panele uygulamıyor (aynı komut kullanıcının `settings.json`'ından çalışıyor). Kurulum ya da güncellemeden sonraki ilk session'da `scripts/install-row.sh` satır script'ini `~/.claude/` altına kopyalar ve anahtarı senin `settings.json` dosyana ekler. Kendi `subagentStatusLine`'ına dokunmaz, bir kez kurar (sildiğin anahtarı geri eklemez), yedek alır, `jq` gerekir. `CREW_CHIEF_ROW=off` kapatır.

## 0.3.2 (2026-10-11)
- `deep-reader` artık web'de arama yapıp sayfa çekebiliyor (WebSearch, WebFetch); tek ajan kodu güncel vendor dokümanları, paket sayfaları ya da tasarım rehberleriyle birlikte okuyabilir. Hâlâ read-only: raporu metin olarak döndürür, dosyaya çağıran yazar.
- Turn limitleri: `implementer-hard` 80 -> 120, `reviewer` 60 -> 80. Ajanlar kalan turn'ü göremedikleri için kendi tool çağrılarını sayar, limitin yaklaşık %70'inde yeni iş açmayıp raporlar. Reviewer bulguları biriktirir ve ulaşamadığı yeri `not reviewed` diye işaretler; artık raporsuz durmaz.
- Implementer'lar arka plandaki test koşusunu beklemek yerine build/test'i ön planda, sınırlı çıktıyla çalıştırır; `implementer-hard`, brief ilerleme dosyası belirtirse oraya checkpoint yazar.
- Reviewer: Important yalnızca doğruluk hataları ve karşılanmayan gereksinimler için; sağlam bir değişiklik şişirilmiş bulgular yerine `No blocking issues` alır.
- Routing: paralel implementer'lara ayrık dosyalar verilir (worktree yalnızca son çare); büyük çok-dosyalı iş 2-3 bağımsız parçaya bölünür; duran (partial) ajan baştan başlatılmaz, SendMessage ile devam ettirilir.

## 0.3.1 (2026-10-09)
- Advisor teklifi: `/advisor` kapalıysa tasarruf modu, ilk biten turdan sonra faydasını bir kez anlatır ve "evet" denirse `/advisor`'ı senin yerine çalıştırır. `CREW_CHIEF_ADVISOR_OFFER=off` kapatır.
- "Bir hafta sonra hatırlat" ve "hiç" cevaplarını hatırlar; advisor'ı olmayan bulut yollarında sormaz; ana model Opus/Fable ise "ikinci görüş" der.
- Reddedilen `/advisor` (politika, Fable kullanım kredisi) tekrarlanmaz; toast nedenini görmek için `/advisor` çalıştırmanı söyler.

## 0.3.0 (2026-10-09)
- Token tasarrufu (mod, Claude Code 2.1.287+): her yeni session kapalı başlar; 5 saatlik limitin %70/80/90'ında (haftalık %50/75/85/90) effort'u düşürmeden önce sorar. `/saver on|off|status`.
- Bağlam 150k token'ı geçince ve session 8 saati aşınca toast: limiti en çok yiyen iki şey.
- Kurulum ya da güncellemeden sonraki ilk mesajda Claude Code 2.1.287'den eskiyse tek satır uyarı (tasarruf modu bunu ister; gerisi çalışır).
- Mesajlar yazdığın dile uyar (Türkçe ya da İngilizce): `CREW_CHIEF_LANG`, Claude Code `language` ayarı, son promptların dili, locale sırasıyla.
- Güncelleme bildirimi: güncellemeden sonraki ilk mesajında neyin değiştiği çıkar; `CREW_CHIEF_WHATS_NEW=off` kapatır.
- Eski kopya uyarısı: açık bir session değiştirilmiş kopyayı çalıştırıyorsa bir kez `/reload-plugins` der.
- `/crew-chief:crew-mode solo` artık tutuyor: bir hook modu session başına kaydeder ve geri alana kadar Agent aracını bloklar.
- Brief'ler kullanıcının koyduğu kısıtları ("X'e dokunma", "commit yok") alt ajanlara taşır.
- Zorluk görünür sinyallerden okunur; escalation kanıta dayanır (check çalışmadı, brief dışı dosya, `maxTurns`); iş yarıda zorlaşırsa yönlendir, durdur ya da güçlü modelle devam ettir.
- `implementer` ve `implementer-hard` durup raporlarken neyi denediklerini ve ne öğrendiklerini bırakır.
- Deneysel `/advisor` ve plugin'in nasıl güncelleneceği belgelendi.
- Dört yeni eval case'i ve yeni hook script'leri için testler.
