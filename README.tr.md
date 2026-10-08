# Crew Chief

**Claude Code için zorluğa göre alt ajan yönlendirme.** Ana oturumun modelini ve eforunu sen seçersin. Sonra Claude her işte neyi kendisi yapacağına, neyi daha ucuz ya da daha güçlü bir alt ajana hangi eforla vereceğine kendisi karar verir. Bir seviye takılırsa bir üstüne çıkar, senin geçersiz kılma komutlarına uyar.

[English README](README.md)

## Ne getirir
- **Her oturumda aktif yönlendirme politikası.** Açılışta, `/clear` sonrasında ve sıkıştırmadan sonra bağlama eklenir.
- **Beş seviyeli ajan.**
  - `scanner` (Haiku/low): arama ve uzun log süzme.
  - `deep-reader` (Sonnet/medium): birden çok dosyayı birlikte inceleme.
  - `implementer` (Sonnet/medium): kapsamı net kod değişikliği.
  - `implementer-hard` (Opus/high): zor ve çok modüllü iş.
  - `reviewer` (Opus/high): bağımsız inceleme.
- **Yükselme merdiveni.** Aynı seviyeyi tekrar denemek yerine `implementer` → `implementer-hard` → ana oturum sırasıyla bir üste çıkar.
- **Salt-okuma bekçisi.** Okuyan ajanların dosya yazmasını, git'e yazmasını ve paket kurmasını engelleyen bir hook. İzinleri kapatsan da çalışır.
- **Doğal dilde geçersiz kılma.** "tek başına yap", "ajanları kullan", "bunu Sonnet medium'a ver" ya da `/crew-chief:crew-mode solo`.
- **Mekanizma rehberi.** Fork, Monitor, `/loop`, `/goal`, workflow, agent team ve routine'den hangisinin ne zaman kullanılacağını anlatır.

## Kurulum

Tam paket (ajan + hook + skill):
```bash
claude plugin marketplace add aykyusuf/crew-chief
claude plugin install crew-chief@crew-chief
```

Sadece skill'ler (Cursor, Codex gibi başka araçlarda da çalışır):
```bash
npx skills add aykyusuf/crew-chief
```
Bu yol ajanları ve hook'ları kurmaz. Claude Code'da her proje için bir kez `/crew-chief:crew-setup` çalıştır; ajanları, bekçiyi ve politikayı `.claude/` klasörüne ve `CLAUDE.md`'ye yazar. `.claude/agents/` klasörü yeni oluştuysa Claude Code'u yeniden başlat.

Bir makinede tek bir yol seç. Plugin ve `npx` skill'leri birlikte kurarsan her skill iki kez listelenir (`/crew-chief:crew-routing` ve `/crew-routing`); bir şey bozulmaz ama bağlam boşa dolar. `/crew-setup` plugin'i görünce ajanları ve bekçiyi kopyalamaz, plugin'in açılış hook'u da politika zaten `CLAUDE.md`'de varsa tekrar eklemez.

Gereksinimler:
- Çağrı başına efor için Claude Code 2.1.292 veya üstü. Eski sürümlerde de çalışır, o zaman seviyelerin varsayılan eforları kullanılır.
- Bekçi için `jq` ya da `python3`.

## Kullanım
| Sen dersin | Olan |
|---|---|
| *(hiçbir şey)* | `auto`: zorluğa göre yönlendirme |
| "tek başına yap", "alt ajan kullanma" | `solo`: her şeyi ana oturum yapar |
| "ajanları kullan", "dağıt" | `delegate`: bağımsız parçalar paralel olarak seviyelere gider |
| "UI'ı direkt Opus yapsın" | O kısım ana oturumda kalır, gerisi normal yönlendirilir |
| "testleri Haiku'ya ver", "bunu Sonnet medium yapsın" | Alt ajan tam o model ve eforla açılır |
| `@agent-crew-chief:implementer-hard ...` | O ajan kesin çağrılır |
| `/crew-chief:crew-mode auto\|solo\|delegate\|status` | Modu değiştirir ya da gösterir |

Bir seviyenin modelini ya da eforunu değiştirmek için projende aynı adla `.claude/agents/<ad>.md` dosyası aç. Proje ajanı plugin ajanının önüne geçer ve güncellemeler onu ezmez.

## Ne çalıştırır
Her şey bu repoda okunabilir shell ve Python olarak duruyor. Ağa hiçbir şey göndermez.
- `session-policy.sh`: oturum açılırken yaklaşık 2 KB'lık politikayı bağlama ekler.
- `readonly-guard.sh`: Bash çağrılarında çalışır. Sadece `scanner`, `deep-reader` ve `reviewer` için yazma komutlarını engeller, diğer çağrılara dokunmaz.

Ayrıntılar ve geliştirme komutları için İngilizce README'ye bak.

## Lisans
MIT
