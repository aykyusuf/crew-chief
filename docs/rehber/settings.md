# Ayarlar: `/crew-config`

crew-chief'in kullandığı tüm sayılar, ortam değişkeni gerektirmeden `/crew-config` ile değiştirilebilir.

[← README](../../README.tr.md) · [English](../guide/settings.md)

crew-chief'in kullandığı sayılar ortam değişkeni gerektirmeden senin elinde. `/crew-config` onları ne işe yaradıklarıyla ve değerin nereden geldiğiyle listeler; `/crew-config set <ad> <değer>` birini kaydeder (eklentinin store'unda, session'lar arasında kalır; `settings.json`'a ya da projeye hiçbir şey yazılmaz); `/crew-config reset <ad>|all` varsayılanı geri koyar. Aynı anlama gelen ortam değişkeni ayarlıysa yine o kazanır ve komut bunu söyler. Okunamayan bir değer reddedilir, bozulmuş eski bir değer yok sayılır; yani bir yazım hatası hiçbir özelliği kapatmaz.

| Ad | Varsayılan | Neyi değiştirir |
|---|---|---|
| `compact.enabled` | on | Tüm compact akışı (`CREW_CHIEF_COMPACT=off`) |
| `compact.arm` | 250k | Claude'a bir sonraki faz sonunda compact önermesi söylenen bağlam boyutu (`CREW_CHIEF_COMPACT_ARM`) |
| `compact.ask` | 400k | Claude hiç önermediyse crew-chief'in kendisinin sorduğu boyut (`CREW_CHIEF_COMPACT_ASK`) |
| `compact.fallback` | on | Kendi kendine sorup sormayacağı; `off`: sadece Claude önerirse ya da `/crew-compact` yazarsan |
| `compact.reask` | 100k | *Şimdi değil*'den sonra bir sonraki öneri için bağlamın ne kadar büyümesi gerektiği |
| `compact.quiet` | 10 sn | Bir turdan sonra sorunun açılması için session'ın ne kadar sessiz kalması gerektiği |
| `compact.armpct`, `compact.askpct` | %60, %85 | Küçük pencerede, ne kadarının akışı kurup soracağı (boyutu kendin ayarlamadıkça geçerli) |
| `saver.ask` | on | Saver'ın limit eşiklerinde sorup sormayacağı (`CREW_CHIEF_SAVER=off`; `/saver` yine çalışır) |
| `saver.five`, `saver.seven` | 70,80,90 ve 50,75,85,90 | Saver sorusunu çıkaran limit yüzdeleri |
| `ask.timeout` | 20 dk | Cevapsız sorunun güvenli cevabını alması için dakika, 1-30 ya da `off` (`CREW_CHIEF_ASK_TIMEOUT_MIN`) |
| `handoff.mode` | nudge | Handoff dosyalarını güncel tutma: `off`, `nudge` (Claude'a hatırlatma) ya da `turn` (hatırlatmalar cevapsız kalırsa güncelleme isteyen fazladan bir tur de); `CREW_CHIEF_HANDOFF` |
| `handoff.files` | 6 | Handoff dosyaları en son yazıldığından beri kaç farklı proje dosyası düzenlenince Claude'a hatırlatılacağı |
| `handoff.minutes` | 45 | Bu kadar dakikalık düzenlemeden sonra bunun üçte biri kadar dosya yeter |
| `handoff.max` | 6 | Session başına en çok olağan hatırlatma |
| `panel.click` | on | Terminal dışında band'daki bir alt ajan satırına tıklamak, ne yaptığını hemen altında açar; *Tam görünüm* ve bir mesaj alanıyla. `off` satırları eskisi gibi düz bırakır (`CREW_CHIEF_PANEL_CLICK`). `/crew-agents` her iki durumda da çalışır |
| `panel.style` | `capsule` | Band'ın terminal dışında çalışan alt ajanı nasıl çizdiği: `capsule`, `cat` ya da `text` (resim yok); terminal her zaman metin satırını alır (`CREW_CHIEF_PANEL_STYLE` ya da `/crew-ui panel <ad>`) |
| `panel.perf` | off | Performans modu, neyin duracağı: `agents`, `theme`, `all` ya da `off` (bkz. [Performans modu](performance.md); `CREW_CHIEF_PANEL_PERF`) |
| `agents.warn` | 5 | Aynı anda bundan fazla alt ajan çalışırsa band izlemenin maliyetini söyler |
| `notify.agent` | on | Bir alt ajan bitince toast (`CREW_CHIEF_NOTIFY_AGENT`) |
| `notify.native` | on | Aynısı senin bildirim kanalından sistem bildirimi olarak; gösterilemeyen yerde sessizce atlanır (`CREW_CHIEF_NOTIFY_NATIVE`) |
| `notify.min` | 10 sn | Bitişinin bildirilmesi için bir alt ajanın en az kaç saniye çalışmış olması gerektiği, 0-3600; hata her zaman bildirilir (`CREW_CHIEF_NOTIFY_MIN`) |

Bir soru sana erken geliyorsa: `/crew-config set compact.arm 400k`, `/crew-config set compact.ask 600k` ya da `/crew-config set compact.fallback off`.

**Projeye özel: `.claude/crew-chief.json`.** Bir proje kendi değerlerini bu dosyada düz anahtarlarla taşıyabilir (`{"compact.ask": "300k", "compact.arm": "200k"}`); `/crew-config`'in kayıtlı değerlerini geçer, ortam değişkenlerine yenilir ve `/crew-config` onları `[this project]` diye işaretler. Compact sorusundaki "Bir daha sorma" buraya `"compact.never": true` olarak yazılır, böylece o projede sonraki oturumlarda da geçerli olur; `/crew-compact` bunu siler, `/crew-compact never` yazar.
