# Değişiklik günlüğü (Türkçe)

Türkçe notlar 0.3.0'dan başlar; öncesi için [CHANGELOG.md](CHANGELOG.md) (İngilizce). Bildirim Türkçe olduğunda "ne yeni" maddeleri buradan okunur; bu dosyada o sürümün bölümü yoksa İngilizce olanı gösterilir.

## 0.6.4 (2026-10-24)
- `/saver` birçok session'da "registered /saver but no command.run hook answered" hatası veriyordu; `/clear`, `/resume` ya da plugin yenilemesinden sonra mod komutu kendisine ait saymayıp susuyordu. Artık reddetmeden önce komut listesine bakıyor.

## 0.6.3 (2026-10-16)
- Compact önerileri artık gerçek bir molayı bekler: bir alt ajan çalışırken hiçbir şey önerilmez ve onaylanmış compact başlamaz; yalnızca cevapla biten turn faz sınırı sayılır (iptal, hata, ret sayılmaz). Arka planda açık bırakılan dev server ya da watcher beklenmez (başlattığı sunucuyu bekleyen `waiting` alt ajan da): soru onu gösterir ve özetleyiciye görev kimliğini ve komutunu koruması söylenir, çünkü compact'ten sonra Claude arka plan görevlerinin tutamaçlarını unutuyor (anthropics/claude-code#29193).
- Compact sorusu artık ne olduğunu söyler (`Şu an: çalışan alt ajan: 0, arka plan süreci: 2 (npm run dev, ...), commit'lenmemiş dosya: 3`). Alt ajanlar çalışırken `/crew-compact` bitince tekrar sormanı söyler.

## 0.6.2 (2026-10-15)
- Mod yine tek dosya: plugin'leri inceleyen dizin `$` ve `on`'u yalnızca aynı dosyada tanımlı bir fonksiyona geçirildiğinde kabul ediyor; bu yüzden `$` kullanan parçalar artık `hooks/src/` altında ve `tools/build_mod.py` bunları okunabilir `hooks/register.js` dosyasında birleştiriyor (CI güncel olduğunu ve `$`'ın başka dosyadaki bir fonksiyona geçirilmediğini kontrol eder). Davranış değişmedi.
- README'ye "Mod makinende ne yapar" bölümü eklendi: ne okuyor, çalıştırıyor, gönderiyor ve yazıyor, neden.

## 0.6.1 (2026-10-15)
- Devir dosyası olmayan projede compact akışı: evet dedikten sonra Claude önce bunları kurmayı teklif eder (`crew-handoff` skill'i, kendi önizleme ve onayıyla) ve konuşmada verdiğin kuralları Kısıtlar altına yazar; böylece compact'ten sonra geri basılabilirler. Reddedersen eskisi gibi dosyasız compact edilir.

## 0.6.0 (2026-10-15)
- Compact akışı: 250k token'ı geçince Claude'a doğal bir faz sınırında compact önermesi söylenir; araç sana sorar (400k'dan sonra turn aralarında yedek bir soru). Evet dersen Claude STATUS.md, tasks.json ve PROGRESS.md'yi günceller, compact STATUS.md değişene kadar bekler, sonra turn aralarında özetleyiciye ayrıntılı bir talimatla çalışır. Evet demeden hiçbir şey compact edilmez. `/crew-compact` elle başlatır; `CREW_CHIEF_COMPACT=off` kapatır.
- Önemli hiçbir şey kaybolmaz: talimat varsayılan başlıkların hepsini sayar, kurallarını kelimesi kelimesine kopyalar, başarısız ya da öldürülen süreçlerin çıktısını `UNCONFIRMED` işaretler; `/compact`'e ve otomatik compact'e de eklenir. Her compact'ten sonra yeni bir SessionStart hook'u (`scripts/compact-restore.sh`) sabitlediğin Kısıtlar'ı, Şu an'ı, Sıradaki'ni, Kararlar'ı, son başarısız denemeleri ve açık görevleri devir dosyalarından transcript yoluyla birlikte geri basar; ham özet kaydedilir ve sabitlediğin satırlara karşı kontrol edilir.
- Devir dosyalarına Kısıtlar bölümü eklendi (kuralların, kelimesi kelimesine). 150k token toast'ının yerini compact akışı aldı.
- Limit sıfırlanması: dolmaya yakın bir pencere sıfırlanınca toast; bir limit Claude'u gerçekten durdurunca sıfırlanma anında "continue" gönderme teklifi. `CREW_CHIEF_RESET=off`.
- `/crew-tidy`: Claude Code'un yüklediklerinin salt-okunur denetimi (şişkin CLAUDE.md ve MEMORY.md, bayat yollar, tekrarlar, büyük STATUS.md, MCP maliyeti); `/crew-tidy archive` 60 günden eski PROGRESS.md girdilerini sorduktan sonra arşive taşır. `/crew-report`: model ve rol bazında token ve maliyet, ayrıca öğrenilen bir prompt-cache-soğuma ipucu.
- Claude Code 2.1.300'de canlı doğrulandı: session.compact talimatı varsayılan prompt'a ekleniyor; klasik compact hook'ları plugin'in başlattığı compact için de tetikleniyor; SessionStart çıktısı modele ulaşıyor; transcript compact öncesi satırlarını koruyor. Plugin `claude -p`'de compact edemez. Claude Code 2.1.287+ ister (shell hook kendi başına çalışır).

## 0.5.0 (2026-10-13)
- Alt ajanlarda skill: `deep-reader`, `implementer`, `implementer-hard`, `reviewer` ve `ui-tester` artık skill yükleyebilir (`Skill` tool). Alt ajanlar skill listeni görmez; bu yüzden policy ana session'a brief'te skill adını yazmasını, `general-purpose` kullanırsa `model`'i açıkça vermesini söyler (yoksa ana modeli devralır).
- Raporlar dosyada: `deep-reader` ve `reviewer` `Write` alır ama read-only guard yalnızca `${TMPDIR:-/tmp}/crew-chief-reports/` altına yazdırır. ~40 satırı aşan rapor oraya yazılır, en fazla 15 satır özet ve yol döner; ana context küçük kalır. Geri kalan her şey hâlâ engelli: başka yollar, `Edit`, göreli yol, `..`, klasörden çıkan symlink (guard artık Write/Edit/NotebookEdit çağrılarını da kapsıyor).
- Skill hatırlatması: yeni UserPromptSubmit hook'u `scripts/skill-hint.sh` prompt'u `data/skill-catalog.json` ile eşleştirir (Türkçe ve İngilizce anahtar kelimeler); tercih edilen skill kuruluysa tek satır ekler: "önce X skill'ini yükle". Prompt başına en fazla iki, her iş türü session'da bir kez. Kendi iş türlerin: `~/.claude/crew-chief-skills.json`. `CREW_CHIEF_SKILL_HINTS=off` kapatır.
- Skill teklifi: yeni SessionStart hook'u `scripts/skill-offer.sh` stack'i tanır (Flutter, React/Next.js, SwiftUI, web UI, Supabase); tercih edilen skill kurulu değilse Claude bir kez, isteğe bağlı olarak, elle doğrulanmış skill'leri teklif eder (2026-10-13'te kontrol edildi: Flutter ekibinin `dart-flutter`'ı, Vercel `vercel-react-best-practices`, `swiftui-pro`, Anthropic `frontend-design`, Supabase `postgres-best-practices`). Kaynağı, tam komutu ve riskleri gösterir; evet demeden hiçbir şey kurmaz; çalışma anında talimat çeken ya da script çalıştıran skill'ler dışarıda. `CREW_CHIEF_SKILL_OFFER=off` kapatır.
- Rapor klasörü sana ait olmalı; `TMPDIR` sonundaki slash'a dikkat edilir. `/crew-setup`'ı yeniden çalıştırmak, `.claude/settings.json`'daki eski yalnızca-Bash guard kaydını genişletir; böylece projedeki `deep-reader` ve `reviewer` korunmuş kalır. Kapattığın plugin'lerin skill'leri kurulu sayılmaz. Yeni hook'lar `jq` gerektirir; yoksa hiçbir şey yapmazlar.

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
