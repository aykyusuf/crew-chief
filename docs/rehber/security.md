# Güvenlik incelemesi ve doğrulama kapısı

Salt-okunur `security-reviewer`, risk haritası, commit kapısı ve commit öncesi doğrulama kapısı.

[← README](../../README.tr.md) · [English](../guide/security.md)

## Güvenlik incelemesi

Ayrı, salt-okunur bir ajan, **`security-reviewer`** (varsayılan Opus medium; yalnızca bir değişiklik güven sınırında davranışı değiştirdiğinde ve en küçük uygun ayarla kullanılır: tek odaklı soru için Sonnet medium, genelde Opus medium, geniş, para, yetki ya da veri taşıyan migration değişikliğinde Opus high, xhigh yalnızca yayından hemen önce auth, para ve veriyi birlikte kapsayan büyük bir değişiklikte ya da sen istediğinde), paketle gelen `security-audit` skill'ini (Cloudflare, MIT) hazır yüklü alır. Değişikliğin dokunduğu her girdiyi girdiği yerden kullanıldığı yere kadar izler, her bulguyu `path:line` ile doğrular, kendi High ve Critical bulgularını çürütmeye çalışır ve önem sırasıyla raporlar; projeye asla yazmaz.

- **`/crew-chief:security [staged | branch | <yol ya da aralık> | map]`** kapsamdaki güvenlikle ilgili dosyaları bulur, neye dokunduklarına göre model ve effort'u seçer, ajana brief verir, bulduklarını raporlar ve düzeltme önerir.
- **Risk haritası: `.crew-chief/security-map.json`.** `scripts/security-map.sh scan` projenin güvenlikle ilgili dosyalarını kategori ve gerekçeyle listeler; ucuz yol ve içerik regex'leriyle (model çağrısı yok; eşleşme bakma sebebidir, bulgu değil). Elle eklediğin girdiler (`"manual": true` ya da bir `"glob"`) her yeniden taramada korunur. Claude'un yazdığı ve eşleşen yeni dosya var olan haritaya eklenir (Write ve Edit üzerinde PostToolUse); 7 günden eski harita oturum başında arka planda yeniden taranır. Haritanın git'e girip girmeyeceği senin seçimin.
- **Commit kapısı.** `scripts/security-gate.sh` (Bash üzerinde PreToolUse), commit'e girecek dosyalar (staged, `-a` ya da aynı komuttaki bir `git add`) güvenlikle ilgiliyse Claude'un `git commit`'ine bakar. Böyle her commit kısa bir karar rehberiyle bir kez durdurulur (durdurmak ucuzdur: Claude gerek görmedikçe hiçbir ajan çalışmaz): önce bir incelemeye hiç gerek var mı (çoğu commit'te yok: mekanik düzenlemeler, testler, metin, davranışı koruyan refactor), varsa en küçük uygun model ve effort (xhigh asla varsayılan değil). Değişikliğin boyutu ve değişen satırlardaki riskli kalıplar (silinen bir yetki kontrolü, sorguya eklenen girdi, para hesabı) ipucu olarak yazılır; küçük ve düz bir değişiklik "büyük ihtimalle inceleme gerekmez" diye işaretlenir. Dosya ve satır kuralları Türkçe alan kelimelerini de tanır (odeme, tahsilat, fatura, bakiye, kur, doviz, altin, kasa, fiyat, tutar, yetki, sifre, oturum). Aynı komutun 4 saat içinde tekrarı geçer. Yalnızca Claude'un commit'lerini görür, terminalde senin yazdıklarını görmez. `CREW_CHIEF_SECURITY_GATE=off` kapatır.
- **Saver.** Normal saver onu high'da tutar (yalnızca xhigh ve max high'a iner); ultra saver Opus'ta çalıştırmadan önce sana sorar (cevap yoksa: Sonnet high).

## Doğrulama kapısı

Claude'un `git commit`'inden önce crew-chief, bu oturumda son commit'ten beri bir test, build ya da kontrol (ya da `verifier`, `reviewer`, `ui-tester` ajanı) çalışıp çalışmadığına bakar. Varsayılan `observe`: commit çalışır, Claude'a mesajda neyin doğruladığını yazması söylenir (`Verified: npm test (42 passed)` ya da `Verified: not run (docs only)`). `enforce` commit'i oturum başına en fazla iki kez durdurur; `off` kapatır. `CREW_CHIEF_VERIFY_GATE` ya da `.claude/crew-chief.json` içinde `"verify.gate"` ile ayarlanır.
