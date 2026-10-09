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
- Çağrı başına efor için Claude Code 2.1.292 veya üstü. Eski sürümlerde de çalışır, o zaman seviyelerin varsayılan eforları kullanılır. Token saver için 2.1.287+.
- Bekçi, `jq` kuruluysa onu, değilse `sed` kullanır; ek bir şey gerekmez.

## Güncelleme

Üçüncü taraf marketplace'ler varsayılan olarak **otomatik güncellenmez**; bir kez aç: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Sonra Claude Code, oturumdaki ilk mesajından kısa süre sonra plugin'i kendisi günceller. Elle güncellemek için: `claude plugin update crew-chief@crew-chief`.

Güncelleme, zaten açık olan oturumu değiştirmez:
- Otomatik güncellemeden sonra Claude Code `Plugin updated: crew-chief · Run /reload-plugins to apply` yazar. O oturumda yeni sürüme geçmek için `/reload-plugins` çalıştır (yeni oturum zaten yeni sürümle açılır).
- Terminalde `claude plugin update` yaptıysan, açık kalan diğer oturumlara Claude Code bir şey söylemez. Crew Chief bu boşluğu kapatır: bir sonraki mesajında, oturum başına bir kez, o oturumun eski kopyada çalıştığını ve `/reload-plugins` gerektiğini söyler.
- Güncellemeden sonraki ilk mesajında kısa bir "ne yeni" çıkar: o sürümün [CHANGELOG](CHANGELOG.md) bölümünün ilk üç maddesi. İlk kurulumda, eski Claude Code uyarısı dışında hiçbir şey göstermez. Kapatmak için `CREW_CHIEF_WHATS_NEW=off`.

İki bildirimi de model değil, UserPromptSubmit hook'u (`systemMessage`) mesaj kutunun altına basar. SessionStart hook'unun `systemMessage`'ını Claude Code 2.1.295 göstermiyor; bildirim bu yüzden ilk mesajı bekler.

## Token tasarrufu (saver)

Plan limitini en çok uzun session'lar ve şişmiş bağlam yer, sonra Opus'lu subagent'lar. Saver, Claude Code'un içinde limitini izleyen küçük bir [mod](https://code.claude.com/docs/en/plugins/mods/overview) (`hooks/register.js`); bir şeyi değiştirmeden önce sorar.

- **Ne zaman sorar:** 5 saatlik limit %70, %80, %90'ı; haftalık limit %50, %75, %85, %90'ı geçince, her eşik ve limit penceresi için bir kez. Session eşik geçilmiş halde açılırsa hemen sorar. İki eşik birden geçilirse bir kez sorar.
- **Cevaplar:** *Tasarruf modunu aç*, *Şimdi değil* (sonraki eşikte tekrar sorar), *Bu session'da bir daha sorma* (İngilizce görünümde: *Turn on saver*, *Not now*, *Don't ask again this session*).
- **Açıkken ne yapar, sadece subagent'lara:** Opus (ve Fable) en fazla **medium** effort'ta, Sonnet en fazla **high**'da çalışır (`xhigh`/`max` yok). Haiku'ya ve ana session'a dokunmaz. Modeli değil, her subagent isteğinin effort'unu düşürür.
- **Takılı kalmaz:** her yeni session, `/clear` ve `/resume` saver kapalı başlar. Saver durumu hiçbir yere kaydedilmez; session'lar arasında dil ve advisor teklifi cevabı hatırlanır (aşağıda).
- **`/saver on|off|status`** elle açıp kapatır; limitlerini, sıfırlanma zamanlarını ve bağlam boyutunu gösterir.
- **Session başına bir kez toast:** bağlam 150k token'ı geçince ve session 8 saatlik olunca.

**Dil.** Sorular, toast'lar, `/saver` ve güncelleme bildirimleri yazdığın dile göre Türkçe ya da İngilizce olur. Öncelik: `CREW_CHIEF_LANG=tr|en`, sonra Claude Code `language` ayarı (`turkish` ya da `english`), sonra son promptların dili (Türkçe harfler ve yaygın Türkçe sözcükler; son beş promptun çoğunluğu, yani tek bir İngilizce cümle bir şey değiştirmez; slash komutları ve kod sayılmaz), sonra en son tespit edilen dil (yeni session'ın ilk sorusu bile o dilde gelir), sonra `LANG` locale, sonra İngilizce. Session'lar arasında plugin'in deposunda tutulanlar: bu `tr`/`en` kelimesi ve [advisor teklifine](#advisor-teklifi) verdiğin cevap. "Ne yeni" notları sürüm `CHANGELOG.tr.md`'de varsa oradan, yoksa `CHANGELOG.md`'den okunur.

Ortam değişkenleri: `CREW_CHIEF_ADVISOR_OFFER=off` (advisor teklifi yok), `CREW_CHIEF_LANG=tr|en` (dili zorla), `CREW_CHIEF_SAVER=off` (saver sorusu ve toast yok; advisor teklifinin kendi anahtarı var), `CREW_CHIEF_SAVER_FIVE_HOUR=60,85` ve `CREW_CHIEF_SAVER_SEVEN_DAY=50,90` (kendi eşiklerin).

**Gereksinim:** Claude Code 2.1.287+ (eskisi modu hiç yüklemez; kurulumdan sonraki ilk mesajda uyarır) ve limit verisi için Pro/Max plan. Sorular interaktif session ister; `claude -p` hiç sormaz. Soru istemeyen sert bir tavan için ayarlarına `"maxEffortLevel": "medium"` yaz.

## Advisor teklifi

`/advisor` (deneysel, sadece Anthropic API) Claude'un zor anlarda (yaklaşım seçmeden önce, takılınca, bitirmeden önce) daha güçlü bir modele danışmasını sağlar. Alt ajanlar da miras alır: Sonnet `implementer` durup `implementer-hard` olarak yeniden koşmak yerine Opus'a danışabilir. Anthropic'in kendi ölçümünde Sonnet ve Opus ikilisi görevleri yaklaşık %12 daha ucuza ve biraz daha iyi bitirdi; her danışma advisor modelinin fiyatından faturalanır.

Advisor kapalıysa mod bunu **bir kez** önerir: session'ın ilk biten turundan sonra (açılışta ve saver sorusunun üstüne asla):
- **Ana model Sonnet/Haiku:** "zor anlarda Opus'a danışır". **Ana model Opus/Fable:** metin "ikinci bir Opus (Fable) planı gözden geçirir" olur, ek maliyetli bağımsız bir kontrol.
- **Cevaplar:** *Aç* `/advisor opus` (Fable için `/advisor fable`) komutunu senin yerine çalıştırır; bu, komutu kendin yazmış gibi `advisorModel`'i kullanıcı ayarına kaydeder ve bir toast ile söyler. Ayar görünmezse (bir politika, Fable kullanım kredisinin açık olmaması) toast nedenini görmek için `/advisor` çalıştırmanı söyler ve teklif tekrarlanmaz. *Bir hafta sonra hatırlat* ve *Bir daha sorma* plugin'in deposunda hatırlanır. Diyaloğu kapatırsan hiçbir şey hatırlanmaz.
- **Hiç sorulmaz:** `advisorModel` zaten ayarlıysa, Bedrock/Vertex/Foundry gibi bulut yollarında, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` varsa, `/advisor` komutu yoksa, ana model bilinmiyorsa, `claude -p`'de ya da bir kez "Aç" dedikten sonra (sonradan `/advisor off` dersen geri gelmez).
- `CREW_CHIEF_ADVISOR_OFFER=off` teklifi tamamen kapatır.

## Kullanım
| Sen dersin | Olan |
|---|---|
| *(hiçbir şey)* | `auto`: zorluğa göre yönlendirme |
| "tek başına yap", "alt ajan kullanma" | `solo`: her şeyi ana oturum yapar (`/crew-chief:crew-mode solo` ayrıca bir hook ile Agent aracını engeller, sen geri alana kadar) |
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
Her şey bu repoda okunabilir shell ve küçük bir JavaScript modu (`hooks/register.js`) olarak duruyor. Ağa hiçbir şey göndermez.
- `session-policy.sh`: oturum açılırken yaklaşık 2 KB'lık politikayı bağlama ekler. Devir dosyası olmayan bir git reposunda yeni oturumda bir kezlik [devir önerisini](#oturum-devri) de ekler; kendisi dosya yazmaz.
- `subagent-row.sh`: alt ajanlar çalışırken listedeki her satıra model, efor ve token bilgisini yazar.
- `register.js` (mod): token saver. Plan limitini ve bağlam boyutunu Claude Code içinden okur, eşikte `ui.ask` ile sorar, açıkken subagent effort'unu düşürür. Saver durumunu sadece bellekte tutar; dili ve advisor teklifine verdiğin cevabı hatırlar. Ayrıca `/advisor`'ı bir kez önerir ([Advisor teklifi](#advisor-teklifi)).
- `mode-guard.sh`: `/crew-chief:crew-mode solo` yazdığında modu o oturum için kaydeder ve solo iken alt ajan açılmasını engeller.
- `plugin-notices.sh`: güncellemeden sonra yeni sürümün ne getirdiğini gösterir; açık bir oturum eski kopyada kaldıysa bir kez uyarır.
- `readonly-guard.sh`: Bash çağrılarında çalışır. Sadece `scanner`, `deep-reader`, `reviewer` ve `ui-smoke` için yazma komutlarını engeller, diğer çağrılara dokunmaz.

Saklananlar kendi makinende `~/.claude/plugins/data/<plugin>/` altında kalır ve plugin kaldırılınca Claude Code bu klasörü siler: devir önerisine verdiğin cevaplar (`handoff-offers.tsv`: her cevap için bir satır, proje yolu ve `installed`/`never`/`later`; her projede son satır geçerli), en son hangi sürümü gördüğün (`last-seen-version`), Claude Code sürümünü hangi plugin sürümü için kontrol ettiği (`claude-version-checked`) ve solo modu ile eski-oturum uyarısı için oturum kimliğiyle adlandırılmış küçük işaret dosyaları (`modes/`, `stale-notified/`; iki hafta sonra silinir). Token saver modu limitini, bağlam boyutunu ve promptlarının ilk satırlarını (yalnızca Türkçe ile İngilizceyi ayırt etmek için) Claude Code içinde okur; hiçbirini kaydetmez, sadece tespit ettiği dili (`tr` ya da `en`) ve advisor teklifine verdiğin cevabı (`answered`, `never` ya da bir bekleme zamanı) plugin'in deposunda tutar. Projene hiçbir şey yazılmaz.

Ayrıntılar ve geliştirme komutları için İngilizce README'ye bak.

## Lisans
MIT
