# Değişiklik günlüğü (Türkçe)

Türkçe notlar 0.3.0'dan başlar; öncesi için [CHANGELOG.md](CHANGELOG.md) (İngilizce). Bildirim Türkçe olduğunda "ne yeni" maddeleri buradan okunur; bu dosyada o sürümün bölümü yoksa İngilizce olanı gösterilir.

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
