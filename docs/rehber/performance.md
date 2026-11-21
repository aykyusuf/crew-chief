# Performans modu

Band'ın hareketli resimlerini (ve bir tema modunun animasyonunu) durdurarak çizim maliyetini azaltır.

[← README](../../README.tr.md) · [English](../guide/performance.md)

Hareketli resimler çizilirken biraz yük getirir. Desktop uygulamasında band'ın durum satırının sonundaki ⚡ (ya da `/crew-perf`) onları durdurur:

- **Ajanlar** band'daki ajan resimlerini durdurur; **tema** bir masaüstü temasının animasyonunu durdurur; **hepsi** ikisini birden. `/crew-perf all|agents|theme|off` doğrudan ayarlar, `/crew-config set panel.perf <değer>` de aynısını yapar; `CREW_CHIEF_PANEL_PERF` ayarlıysa o geçerlidir.
- **Tema kısmı için dinleyen bir tema modu gerekir.** crew-chief temayı kendisi çizmez; `~/.claude/perf-mode.json` dosyasını yazar, bir tema modu onu okur. Böyle bir mod kurulu değilse ⚡ sormadan yalnızca ajanları açıp kapatır, `/crew-perf theme|all` hiçbir şeyi değiştirmez, kayıtlı bir `theme` ya da `all` değeri `agents` gibi çalışır.
- **Dosya:** `{"on": true, "agents": true, "theme": true, "at": "<iso zaman>"}`, ayar her değiştiğinde yazılır. `on` tema kısmının aynısıdır; yalnızca `on`'u bilen bir mod da temayı istendiği gibi durdurur.
- **Tema modu yazanlar için.** Oturum başında `~/.claude/perf-mode.readers/<mod adı>.json` = `{"name": "<mod adı>", "theme": true, "at": "<şimdi, iso>"}` dosyasını yaz; böyle bir dosya 14 günden yeniyse crew-chief tema seçeneğini sunar. `~/.claude/perf-mode.json` dosyasını oturum başında ya da bağlanınca ve her turda oku (ya da aralıklarla yokla), `theme` true iken dur.
