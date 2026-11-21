# Güncelleme

Plugin'i nasıl güncellersin ve güncelleme bildirimleri ne söyler.

[← README](../../README.tr.md) · [English](../guide/updating.md)

Üçüncü taraf marketplace'ler varsayılan olarak **otomatik güncellenmez**; bir kez aç: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Sonra Claude Code, oturumdaki ilk mesajından kısa süre sonra plugin'i kendisi günceller. Elle güncellemek için: `claude plugin update crew-chief@crew-chief`.

Güncelleme, zaten açık olan oturumu değiştirmez:
- Otomatik güncellemeden sonra Claude Code `Plugin updated: crew-chief · Run /reload-plugins to apply` yazar. O oturumda yeni sürüme geçmek için `/reload-plugins` çalıştır (yeni oturum zaten yeni sürümle açılır).
- Terminalde `claude plugin update` yaptıysan, açık kalan diğer oturumlara Claude Code bir şey söylemez. Crew Chief bu boşluğu kapatır: bir sonraki mesajında, oturum başına bir kez, o oturumun eski kopyada çalıştığını ve `/reload-plugins` gerektiğini söyler.
- Güncellemeden sonraki ilk mesajında kısa bir "ne yeni" çıkar: o sürümün [CHANGELOG](../../CHANGELOG.md) bölümünün ilk üç maddesi. İlk kurulumda, eski Claude Code uyarısı dışında hiçbir şey göstermez. Kapatmak için `CREW_CHIEF_WHATS_NEW=off`.

İki bildirimi de model değil, UserPromptSubmit hook'u (`systemMessage`) mesaj kutunun altına basar. SessionStart hook'unun `systemMessage`'ını Claude Code 2.1.295 göstermiyor; bildirim bu yüzden ilk mesajı bekler.
