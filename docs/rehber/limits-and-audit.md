# Limit sıfırlanması, context denetimi ve rapor

Limit sıfırlanmasında toast ve "continue" teklifi; ayrıca `/crew-tidy` (context denetimi) ve `/crew-report` (token ve maliyet).

[← README](../../README.tr.md) · [English](../guide/limits-and-audit.md)

## Limit sıfırlanması

- %90 ve üstü dolmuş, 12 saat içinde sıfırlanacak her pencere için bir zamanlayıcı: session boşta bile kalsa sıfırlanma anında toast (Claude Code yalnızca bir cevaptan sonra ölçüm yapar).
- Bir limit Claude'u gerçekten durdurunca (`StopFailure` olayı, hata `rate_limit`; %100 çizgisi değil, çünkü kullanım kredisiyle %100'ün ötesinde çalışmaya devam edersin) sıfırlanma anında "continue" gönderilsin mi diye sorulur. Yalnızca evet dersen, yalnızca 6 saat içindeki sıfırlanma için; bu arada bir şey yazdıysan hiçbir şey gönderilmez. Mesaj crew-chief'ten geldiğini söyler, senin kendi sözün gibi gönderilmez. `CREW_CHIEF_RESET=off` ikisini de kapatır.

## Context denetimi ve rapor

`/crew-tidy`, Claude Code'un gerçekten yüklediği şeye bakar (`/context`'in gösterdiği liste) ve hiçbir şeyi değiştirmeden raporlar: BÜYÜK HARF vurgusuna ya da eski emirlere ("daha çok düşün", "tembel olma") yaslanan satırlar, her session yüklenen dosyada geçici görünen satırlar (son tarih, "şimdilik"), `@import`'lar (içe aktarılan dosyalar da session başında yüklenir, yani dosyayı düzenler ama ucuzlatmaz), Anthropic'in sınırlarını aşan talimat ve hafıza dosyaları (CLAUDE.md yaklaşık 200 satırın altı; MEMORY.md yalnızca ilk 200 satırı ya da 25 KB'ı yükler, kalanı sessizce düşer), bir dosyada geçen ama artık olmayan yollar, olmayan dosyalara işaret eden `MEMORY.md` girdileri, dosyalar arası tekrarlayan satırlar, 6 KB'ı aşan `STATUS.md` (her başlangıçta okunur), 60 günden eski `PROGRESS.md` girdileri, token maliyetine göre MCP sunucuları, context'in en büyük parçaları. `~/.claude` altındaki dosyalar yalnızca raporlanır. `/crew-tidy archive`, 60 günden eski `PROGRESS.md` girdilerini sorduktan sonra `PROGRESS-archive.md`'ye taşır: arşiv yazılıp geri okunmadan kaynak yeniden yazılmaz, tarihi belirsiz girdi yerinde kalır, hiçbir şey silinmez.

`/crew-report`, ana/alt ajan ve model bazında token (kesin) ve maliyet (yaklaşık) gösterir, en pahalı üç alt ajan koşusunu da (harcamanın çoğunu genelde birkaç zor koşu taşır); çıktının ne kadarının alt ajanlardan, Sonnet ya da Haiku'dan geldiğini de. Claude Code tek bir session toplamı verir, bu yüzden her isteğe önceki istek bittiğinden beri toplamın artışı yazılır. Boşta kalma sırasında prompt cache büyük ihtimalle soğuduysa sonraki prompt'unda bir toast da uyarır (cache ömrü kullanım sayılarından öğrenilir; bir kez süre dolması görülmeden hiçbir şey uyarılmaz; `CREW_CHIEF_CACHE_HINT=off`).
