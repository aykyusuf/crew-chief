# Crew Chief

**Claude Code için zorluğa göre alt ajan yönlendirme.** Ana oturumun modelini ve eforunu sen seçersin. Sonra Claude her işte neyi kendisi yapacağına, neyi daha ucuz ya da daha güçlü bir alt ajana hangi eforla vereceğine kendisi karar verir. Bir seviye takılırsa bir üstüne çıkar, senin geçersiz kılma komutlarına uyar.

[English README](README.md)

## Ne getirir
- **Her oturumda aktif yönlendirme politikası.** Açılışta, `/clear` sonrasında ve sıkıştırmadan sonra bağlama eklenir.
- **Yedi seviyeli ajan.**
  - `scanner` (Haiku/low): arama ve uzun log süzme.
  - `deep-reader` (Sonnet/medium): birden çok dosyayı birlikte inceleme.
  - `implementer` (Sonnet/medium): kapsamı net kod değişikliği.
  - `implementer-hard` (Opus/high): zor ve çok modüllü iş.
  - `ui-smoke` (Haiku/low): sayfa/ekran açık mı, metin var mı, hata var mı; sadece okur.
  - `ui-tester` (Sonnet/medium): tarayıcı, emülatör ve simülatörde çok adımlı test; ekran görüntüleri ana sohbeti şişirmez.
  - `reviewer` (Opus/high): bağımsız inceleme.
- **Yükselme merdiveni.** Aynı seviyeyi tekrar denemek yerine `implementer` → `implementer-hard` → ana oturum sırasıyla bir üste çıkar.
- **Salt-okuma bekçisi.** Okuyan ajanların dosya yazmasını, git'e yazmasını ve paket kurmasını engelleyen bir hook. İzinleri kapatsan da çalışır.
- **Doğal dilde geçersiz kılma.** "tek başına yap", "ajanları kullan", "bunu Sonnet medium'a ver" ya da `/crew-chief:crew-mode solo`.
- **Kim hangi modelde, görürsün.** Prompt'un altındaki ajan listesinde her alt ajanın modeli ve eforu yazar: `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow` (`jq` gerekir).
- **Oturum devri, proje başına bir kez önerilir.** Üç küçük dosya (durum, iş listesi, ilerleme günlüğü) sayesinde yeni oturum, öncekinin bıraktığı yerden devam eder. Ayrıntı: [Oturum devri](#oturum-devri).
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
- Bekçi, `jq` kuruluysa onu, değilse `sed` kullanır; ek bir şey gerekmez.

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

## Oturum devri

Yeni oturum öncekini hatırlamaz; projeyi baştan keşfeder: ne çalışıyor, ne denendi, sırada ne var. Crew Chief bunu taşıyan üç küçük dosya kurabilir. Bu, Anthropic'in mühendislik yazısı [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Kasım 2025) ile aynı düzen: bir ilerleme dosyası, yalnız durum alanı değişen bir JSON iş listesi (model JSON'u Markdown'a göre daha az bozar) ve her oturum başında `git log` ile ilerleme dosyasını okumak.

| Dosya | Ne tutar | Nasıl değişir |
|---|---|---|
| `STATUS.md` | Şu an, ortam komutları, sıradaki, açık sorular, başarısız denemeler, kararlar | Bugünü anlatacak şekilde güncellenir |
| `tasks.json` | `id`, `title`, `priority`, ölçülebilir `done_when`, `status`, `evidence` | Yalnız `status` ve `evidence` değişir: `todo` → `in_progress` → `done` (`done_when`'in tamamı, onaylar dahil) ya da `blocked` (sebebi `evidence`'ta) |
| `PROGRESS.md` | Tarihli günlük, en yeni üstte | Her oturum bir paragraf |
| `CLAUDE.md` | `<!-- crew-chief:handoff:start -->` / `:end` işaretleri arasında oturum başı/sonu rutini | Bir kez eklenir; dosyanın geri kalanına dokunulmaz |

**Nasıl önerilir.** Yeni açılan bir oturumda (devam, `/clear` ya da sıkıştırmada değil), bu dosyaların hiçbiri olmayan bir git reposunda açılış hook'u Claude'dan sana bir kez sormasını ister; neyin değişeceğini ve nedenini söyler. Cevaplar: *Kur*, *Şimdi değil* (7 gün sonra tekrar sorar), *Bu projede bir daha sorma*. Şu durumlarda sessiz kalır:
- kökte ya da bir alt klasörde benzer bir dosya varsa (`tasks.json`, `STATUS.md`, `PROGRESS.md`, `HANDOFF.md`, `claude-progress.txt`, `feature_list.json`, `durum.md`, `ilerleme.md`) ya da `CLAUDE.md`'de `crew-chief:handoff` bloğu varsa;
- git reposu dışında, ev dizininde ve geçici klasörlerde;
- ortamda `CREW_CHIEF_HANDOFF_OFFER=off` varsa.

**Kurulum ne yapar** (`/crew-chief:crew-handoff` ya da sadece "devir dosyalarını kur"): önce benzer dosyaları arar, varsa yanına ikinci bir set kurmak yerine onları kullanmayı önerir; dosyaları ve depodan doğrulanabilen bilgilerle doldurulmuş önizlemeyi gösterir (doğrulanamayanı "doğrulanmadı" diye işaretler); sadece eksik dosyaları oluşturur, `CLAUDE.md` bloğunu ekler; hiçbir şeyin üzerine yazmaz, adını değiştirmez, commit atmaz. `/crew-chief:crew-setup --handoff` proje kurulumundan sonra aynı adımları çalıştırır.

## Ne çalıştırır
Her şey bu repoda okunabilir shell olarak duruyor. Ağa hiçbir şey göndermez.
- `session-policy.sh`: oturum açılırken yaklaşık 2 KB'lık politikayı bağlama ekler. Devir dosyası olmayan bir git reposunda yeni oturumda bir kezlik [devir önerisini](#oturum-devri) de ekler; kendisi dosya yazmaz.
- `subagent-row.sh`: alt ajanlar çalışırken listedeki her satıra model, efor ve token bilgisini yazar.
- `readonly-guard.sh`: Bash çağrılarında çalışır. Sadece `scanner`, `deep-reader`, `reviewer` ve `ui-smoke` için yazma komutlarını engeller, diğer çağrılara dokunmaz.

Saklanan tek şey devir önerisine verdiğin cevaplar: her cevap için bir satır (proje yolu ve `installed`/`never`/`later`; her projede son satır geçerli), kendi makinende `~/.claude/plugins/data/<plugin>/handoff-offers.tsv` içinde. Plugin kaldırılınca Claude Code bu klasörü siler.

Ayrıntılar ve geliştirme komutları için İngilizce README'ye bak.

## Lisans
MIT
