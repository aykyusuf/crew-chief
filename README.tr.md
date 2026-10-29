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
- **Aynı bilgi Desktop, VS Code ve Windows'ta da.** Panel satırı bir shell script'i olduğu için yalnızca `jq` olan bir terminalde çizilir. Mod ayrıca prompt'un üstünde tek bir durum satırı tutar: çalışan her alt ajanın modeli, eforu ve token'ı, ör. `scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k`. Efor, [saver](#token-tasarrufu-saver)'ın sınırı uygulandıktan sonraki değerdir; token, ajanın son isteğinin girdi + önbellek + çıktı toplamıdır (context boyutu), birikmiş toplam değil. Hiç alt ajan çalışmıyorsa satır silinir. 190 karakteri aşarsa önce token, sonra efor, sonra sondaki ajanlar düşer (`+2 more`). Claude Code satırın önüne kendi işaretini ve plugin adını koyar; o kısım değiştirilemez. Geçen süre yalnızca shell panel satırında kalır. `~40%` ilerleme ikisinde de var: mod her alt ajanın çağrılarını kendisi sayar (bellekte; `jq`, bash ya da node gerekmez), yani Windows'ta satır `reviewer opus-5.5·high ~40% 48.5k` gibi görünür. Yüzde rapor tazeyken (25 çağrıdan ve 10 dakikadan yeni) gösterilir. `jq` yoksa prompt'un altındaki panel satırı model ve eforu gösteremez; crew-chief bunu bir kez, kurulum komutuyla (`winget install jqlang.jq`, Windows'ta) bir toast olarak söyler. `jq` yoksa mod, `scripts/progress-hook.sh`'ın başka yerlerde gönderdiği 10 çağrılık hatırlatmayı da kendisi gönderir; ajan aynı hatırlatmayı iki kez almaz. Ne zaman görünür (`CREW_CHIEF_ROW_MOD`, varsayılan `auto`): oturum terminal dışında bir yerde de çiziliyorsa (Desktop uygulaması, VS Code eklentisi, mobil) ve terminalde yalnızca panel satırı çizilemiyorsa (`jq` yok; oturum başına bir kez `jq --version` ile bakılır. Windows da farklı değil: `jq` kuruluysa prompt'un altındaki panel satırı orada da model ve eforu gösterir, üstteki satır çıkmaz). `on` her zaman, `off` hiçbir zaman; `claude -p` ve SDK'da hiç (çizilecek yer yok). Nerede denendi: terminalde canlı bir oturumda çizildi. VS Code: belgelenmiş (eklenti 2.1.299 ve sonrası bir modun durum satırını prompt kutusunun üstünde gösterir, 200 karakterde keser), burada çalıştırılmadı. Desktop uygulaması: beklenen ama doğrulanmadı (modları çiziyor, durum satırı belgelenmemiş). Windows: tasarım gereği (varsayılan olarak `jq` yok), bir Windows terminalinde çalıştırılmadı.
- **Oturum devri, proje başına bir kez önerilir.** Üç küçük dosya (durum, iş listesi, ilerleme günlüğü) sayesinde yeni oturum, öncekinin bıraktığı yerden devam eder. Ayrıntı: [Oturum devri](#oturum-devri).
- **Önemli hiçbir şeyi kaybettirmeyen compact, yalnızca senin onayınla.** Faz sınırında Claude önerir, sen cevaplarsın, önce devir dosyaları güncellenir, sonra konuşma ayrıntılı bir talimatla compact edilir; sabitlediğin kurallar ve açık görevler dosyalardan geri basılır. Ayrıntı: [Compact akışı](#compact-akışı).
- **Limit sıfırlanması ve `continue`.** Dolmaya yakın bir limit sıfırlanınca toast; bir limit Claude'u gerçekten durdurunca, sıfırlanma anında "continue" gönderilsin mi diye sorar. Ayrıntı: [Limit sıfırlanması](#limit-sıfırlanması).
- **`/crew-tidy` ve `/crew-report`.** Context'indeki şişkin, bayat ya da tekrarlı olanları gösterir (onaylayacağın arşiv taşıması dışında hiçbir şey değişmez); model ve ana/alt ajan bazında token ve maliyet. Ayrıntı: [Context denetimi ve rapor](#context-denetimi-ve-rapor).
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
- **Session başına bir kez toast:** session 8 saatlik olunca. (150k token'daki eski toast kalktı: yerini daha iyi bir anda gelen gerçek bir öneri, [compact akışı](#compact-akışı) aldı.)

**Dil.** Sorular, toast'lar, `/saver` ve güncelleme bildirimleri yazdığın dile göre Türkçe ya da İngilizce olur. Öncelik: `CREW_CHIEF_LANG=tr|en`, sonra Claude Code `language` ayarı (`turkish` ya da `english`), sonra son promptların dili (Türkçe harfler ve yaygın Türkçe sözcükler; son beş promptun çoğunluğu, yani tek bir İngilizce cümle bir şey değiştirmez; slash komutları ve kod sayılmaz), sonra en son tespit edilen dil (yeni session'ın ilk sorusu bile o dilde gelir), sonra `LANG` locale, sonra İngilizce. Session'lar arasında plugin'in deposunda tutulanlar: bu `tr`/`en` kelimesi ve [advisor teklifine](#advisor-teklifi) verdiğin cevap. "Ne yeni" notları sürüm `CHANGELOG.tr.md`'de varsa oradan, yoksa `CHANGELOG.md`'den okunur.

Ortam değişkenleri: `CREW_CHIEF_ADVISOR_OFFER=off` (advisor teklifi yok), `CREW_CHIEF_LANG=tr|en` (dili zorla), `CREW_CHIEF_SAVER=off` (saver sorusu ve toast yok; advisor teklifinin kendi anahtarı var), `CREW_CHIEF_SAVER_FIVE_HOUR=60,85` ve `CREW_CHIEF_SAVER_SEVEN_DAY=50,90` (kendi eşiklerin), `CREW_CHIEF_ROW_MOD=auto|on|off` (alt ajan durum satırı; `auto` Desktop, VS Code ve panel satırının çizilemediği terminallerde gösterir), `CREW_CHIEF_GUARD=auto|on|off` ([komut koruması](#komut-koruması-isteğe-bağlı); `auto` `~/.claude/crew-chief-guard.json` dosyasına bakar, `on` dosyasız hazır kuralları açar, `off` hiç), `CREW_CHIEF_ASK_TIMEOUT_MIN=10` (cevapsız bir sorunun güvenli cevabını alması için dakika; varsayılan 20, en çok 30; `off` ya da `0`: sorular seni bekler).

**Sorular sonsuza kadar beklemez.** Modun sorduğu her soru (saver, advisor teklifi, compact, compact kapısı, limit sıfırlanması, `/crew-tidy archive`) 20 dakika cevapsız kalırsa güvenli seçeneğiyle cevaplanmış sayılır: saver ve compact için *Şimdi değil*, limit sıfırlanması için *Hayır*, advisor teklifi için *Bir hafta sonra hatırlat*, compact kapısı ve arşiv için *Vazgeç*. Asla evet değil, asla *Bir daha sorma* değil. Bir toast bunu söyler (`Soru 20 dk cevapsız kaldı, "Şimdi değil" seçilmiş sayıldı.`). Mod her durumda yoluna devam eder; yapabildiği yerde diyaloğu da kapatır (kendi `AskUserQuestion` çağrısını kendisi cevaplar), ama turn aralarında açılan bir soru ekranda kalabilir, o zaman ona geç tıklamak bir şey değiştirmez. Claude'un kendi sorduğu `AskUserQuestion`'a hiç dokunulmaz.

**Gereksinim:** Claude Code 2.1.287+ (eskisi modu hiç yüklemez; kurulumdan sonraki ilk mesajda uyarır) ve limit verisi için Pro/Max plan. Sorular interaktif session ister; `claude -p` hiç sormaz. Soru istemeyen sert bir tavan için ayarlarına `"maxEffortLevel": "medium"` yaz.

## Compact akışı

Uzun bir konuşma her istekte daha pahalıya gelir ve daha kötü cevap verir. `/compact` yardımcı olur ama konuşmayı bir özetle değiştirir; ayrıntılar, özellikle başta söylediğin kurallar, özetten düşebilir. Bu akış compact'i iyi bir anda, güvencelerle aldığın bir karara çevirir.

1. **Hazırlık.** **250k token'ı** geçince (küçük pencerede pencerenin %60'ı) bir sonraki prompt'una bir kez geçen bir not eklenir: Claude'a bir sonraki doğal faz sınırında (iş bitti, testler yeşil; işin ortasında asla) `crew_compact_checkpoint` aracını çağırması söylenir. Fazın bittiğine Claude karar verir.
2. **Sorma.** Araç yalnızca not alır ve hemen döner, yani Claude'un turn'ü seni hiç beklemez. O turn bir cevapla bittikten ve session **10 saniye** sessiz kaldıktan sonra (yeni prompt yok, model isteği yok, çalışan alt ajan yok) sorulursun; bu saniyelerde bir şey başladıysa bir sonraki böyle turn sonunda sorulursun. Claude aracı hiç çağırmazsa bağlam **400k**'yı geçince (küçük pencerede %85) aynısı olur. *Şimdi değil* 100k token sonra tekrar sorar; *Bu session'da bir daha sorma* bitirir; 20 dakika cevapsız kalmak *Şimdi değil* sayılır (`CREW_CHIEF_ASK_TIMEOUT_MIN`, bkz. [Token tasarrufu](#token-tasarrufu-saver)). Evet demeden hiçbir şey compact edilmez.
   **Yalnızca gerçek bir molada.** Bir alt ajan çalışırken (`$.agent.list()`: pending ya da running; başlattığı bir sunucuyu, bir plan onayını ya da başka bir ajanı bekleyen `waiting` alt ajan gösterilir ama beklenmez) hiçbir şey önerilmez ve onaylanmış compact başlamaz: alt ajan her zaman biter ve sonuç getirir, yarıda kesilmemeli. Soru bir sonraki bitmiş turn'e kalır. Yalnızca cevapla biten turn sayılır (iptal, hata ya da ret sayılmaz). Arka planda açık bırakılan dev server ya da watcher için asla beklenmez: hiç bitmez ve compact ona dokunmaz; bunun yerine soruda gösterilir (`Şu an: çalışan alt ajan: 0, arka plan süreci: 2 (npm run dev, uvicorn app:app), commit'lenmemiş dosya: 3`) ve özetleyiciye görev kimliğini ve komutunu korumasını söyler, çünkü compact'ten sonra Claude'un başlattığı arka plan görevlerinin tutamaçlarını hatırlamadığı biliniyor ([anthropics/claude-code#29193](https://github.com/anthropics/claude-code/issues/29193)). Arka plan süreçleri Stop olayının görev listesinden gelir; mod bunu yalnızca ayar-hook olaylarının ulaştığı yerde alır, diğer sayılar buna bağlı değildir.
3. **Güncelleme.** Evet dersen Claude projede var olan devir dosyalarını günceller: `STATUS.md` (senin kuralların kelimesi kelimesine yazıldığı **Kısıtlar** dahil), `tasks.json`, `PROGRESS.md`. Compact, `STATUS.md` değişene kadar bekler. Değişmediyse sorulursun: *Yine de compact et*, *Önce Claude güncellesin* ya da *Vazgeç*. Devir dosyası olmayan projede Claude önce bunları kurmayı teklif eder (`crew-handoff` skill'i önizleme gösterir ve kendi onayını ister; Kısıtlar bölümüne konuşmada verdiğin kurallar yazılır), çünkü dosyalar olmadan compact'ten sonra kurallarını geri basacak bir şey yoktur; reddedersen dosyasız compact edilir ve seni yalnızca talimat, kayıtlı özet ve transcript yolu korur.
4. **Compact.** Turn aralarında, özetleyiciye ayrıntılı bir talimatla: varsayılan başlıkların hepsi (istek ve amaç, kısıtlar kelimesi kelimesine, kararlar ve nedenleri, dosyalar, hatalar, doğrulama durumu, tüm talimatlar, bekleyen iş) ve başarısız, zaman aşımına uğrayan ya da öldürülen bir sürecin çıktısının asla "tamamlandı" değil `UNCONFIRMED` yazılması kuralı. Aynı talimat elle yazdığın `/compact`'a ve otomatik compact'e, senin kendi sözlerinden sonra eklenir.
5. **Sonra.** Ham özet plugin'in veri klasörüne kaydedilir (`compact-summaries/`, son 5, yalnızca sen okuyabilirsin). Özet, model değil düz metin eşleştirmesiyle sabitlediğin kısıtlar ve açık görevler için kontrol edilir; toast kaç tanesinin eksik olduğunu söyler. `scripts/compact-restore.sh` (SessionStart, `compact`) sonra Kısıtlar'ı, Şu an'ı, Sıradaki'ni, Kararlar'ı, son başarısız denemeleri ve açık görevleri **özetten değil dosyalardan** basar; tam transcript'in yolunu da verir. Claude Code compact öncesi satırları o transcript'te tutar, yani eksik bir ayrıntı aranabilir; bir compact satır kaybettirirse sonrakiler önce transcript'in kopyasını alır (son 3, yalnızca sen okuyabilirsin).

`/crew-compact` öneriyi elle başlatır. Ortam değişkenleri: `CREW_CHIEF_COMPACT=off` akışın tamamını kapatır; `CREW_CHIEF_COMPACT_FOCUS=off` yalnızca talimatın eklenmesini durdurur; `CREW_CHIEF_COMPACT_ARM=300k` ve `CREW_CHIEF_COMPACT_ASK=500k` iki boyutu ayarlar; `CREW_CHIEF_RESTORE=off` geri basma bloğunu durdurur.

**Neden bu sayılar, ne doğrulandı.** Anthropic önerilen bir compact noktası vermiyor (yalnızca varsayılan: 1M modelde yaklaşık 967k). Kaynaklar kalite düşüşünü 300-400k token'da, "göreve çok bağlı" diyerek, veriyor; bu yüzden boyutlar mutlak token ve senin değiştirebileceğin değerler. Claude Code 2.1.300'de etkileşimli session'da doğrulandı: `session.compact` hook'unun talimatı dikkate alınıyor ve varsayılan özet prompt'una *ekleniyor* (belgelenmiş API'de *yerine geçiyor*; bu yüzden talimat iki durumda da tek başına yeterli yazıldı); klasik PreCompact, PostCompact ve SessionStart (`compact`) hook'ları bir plugin'in başlattığı compact için de tetikleniyor; SessionStart çıktısı modele ulaşıyor; transcript compact öncesi satırlarını koruyor. Bir plugin `claude -p`'de ya da bir komuttan compact başlatamaz; turn bittikten sonra bir zamanlayıcıdan çalışır, turn hâlâ sürüyorsa birkaç kez yeniden dener. `STATUS.md`'de sabitlenen kısıtlar her compact'ten sonra yeniden basılır, çünkü araştırmalar sadece konuşmada duran kuralların en çok eridiğini gösteriyor.

## Limit sıfırlanması

- %90 ve üstü dolmuş, 12 saat içinde sıfırlanacak her pencere için bir zamanlayıcı: session boşta bile kalsa sıfırlanma anında toast (Claude Code yalnızca bir cevaptan sonra ölçüm yapar).
- Bir limit Claude'u gerçekten durdurunca (`StopFailure` olayı, hata `rate_limit`; %100 çizgisi değil, çünkü kullanım kredisiyle %100'ün ötesinde çalışmaya devam edersin) sıfırlanma anında "continue" gönderilsin mi diye sorulur. Yalnızca evet dersen, yalnızca 6 saat içindeki sıfırlanma için; bu arada bir şey yazdıysan hiçbir şey gönderilmez. Mesaj crew-chief'ten geldiğini söyler, senin kendi sözün gibi gönderilmez. `CREW_CHIEF_RESET=off` ikisini de kapatır.

## Context denetimi ve rapor

`/crew-tidy`, Claude Code'un gerçekten yüklediği şeye bakar (`/context`'in gösterdiği liste) ve hiçbir şeyi değiştirmeden raporlar: Anthropic'in sınırlarını aşan talimat ve hafıza dosyaları (CLAUDE.md yaklaşık 200 satırın altı; MEMORY.md yalnızca ilk 200 satırı ya da 25 KB'ı yükler, kalanı sessizce düşer), bir dosyada geçen ama artık olmayan yollar, olmayan dosyalara işaret eden `MEMORY.md` girdileri, dosyalar arası tekrarlayan satırlar, 6 KB'ı aşan `STATUS.md` (her başlangıçta okunur), 60 günden eski `PROGRESS.md` girdileri, token maliyetine göre MCP sunucuları, context'in en büyük parçaları. `~/.claude` altındaki dosyalar yalnızca raporlanır. `/crew-tidy archive`, 60 günden eski `PROGRESS.md` girdilerini sorduktan sonra `PROGRESS-archive.md`'ye taşır: arşiv yazılıp geri okunmadan kaynak yeniden yazılmaz, tarihi belirsiz girdi yerinde kalır, hiçbir şey silinmez.

`/crew-report`, ana/alt ajan ve model bazında token (kesin) ve maliyet (yaklaşık) gösterir; çıktının ne kadarının alt ajanlardan, Sonnet ya da Haiku'dan geldiğini de. Claude Code tek bir session toplamı verir, bu yüzden her isteğe önceki istek bittiğinden beri toplamın artışı yazılır. Boşta kalma sırasında prompt cache büyük ihtimalle soğuduysa sonraki prompt'unda bir toast da uyarır (cache ömrü kullanım sayılarından öğrenilir; bir kez süre dolması görülmeden hiçbir şey uyarılmaz; `CREW_CHIEF_CACHE_HINT=off`).

## Komut koruması

**İlk etkileşimli oturumdan sonra varsayılan kurallarla açıktır.** crew-chief etkileşimli bir oturumda (`-p`, SDK ya da bulut değil) ilk kez başladığında ve `~/.claude/crew-chief-guard.json` yoksa, bir kez varsayılan bir ayar yazar ve koruma o oturumdan itibaren açıktır: yerleşik kurallar ve localhost, 127.0.0.1, `::1` ile `*.local` dışındaki her host'u üretim sayan bir ssh kapısı. Bir toast bunu söyler. Dosyayı silersen crew-chief yeniden oluşturmaz; `CREW_CHIEF_GUARD_AUTOSETUP=off` ya da `CREW_CHIEF_GUARD=off` ilk yazımı engeller. Modun küçük bir parçası (`hooks/src/guard.js`, kurallar `hooks/guard-logic.mjs` içinde); ana oturumda ve alt ajanlarda her Bash, Read, Write ve Edit çağrısına çalışmadan önce bakar.

**Açıkken ne yapar.** Üç seviye:

| Seviye | Ne olur | Bu seviyedeki hazır kurallar |
|---|---|---|
| `deny` | Hiç çalışmaz. Claude nedeni, sen bir toast görürsün | `/`, `~`, `$HOME` ya da çıplak `*` üzerinde `rm -rf`; korumanın kendi ayar dosyasına yazmak (`guard-config`, kapatılamaz) |
| `confirm` | **İlk deneme** durdurulur. Claude kısa bir kontrol listesi alır ve sana sorup beklemeden kendisi karar verir: tam olarak ne ve nerede çalışıyor, ne kaybolabilir, doğrulanmış yedek ya da geri dönüş yolu var mı, hedef gerçekten doğru mu, GÜVENLİ mi RİSKLİ mi. GÜVENLİYSE **aynı komutu aynen** tekrar çalıştırır ve `confirmTtlMinutes` (varsayılan 360) içinde sessizce geçer (toast yok, not yok). Değişen komut yeni komuttur. Alt ajan emin değilse çağırana rapor verir; salt-okunur ajan düz ret alır | riskli `rm -rf`, `DROP`/`TRUNCATE`, `WHERE`'siz `DELETE`/`UPDATE`, `git push --force`, `git reset --hard`, özel anahtar dosyaları (okuma, yazma, kopyalama), deploy komutları, servis durdurma/yeniden başlatma/kapatma, `ssh` üzerinden veritabanı istemcisi |
| `warn` | Çalışır, ardından sana bir bildirim, Claude'a bir satır | proje içindeki `rm -rf`; `.env` okuma, düzenleme, `cat` ya da `git add` |

Kendi kuralların da aynı üç seviyeyi kullanır.

**Claude ayarında olmayanı işi durdurmadan işaretler.** Koruma açıkken oturumun ilk prompt'u Claude'a tek bir not taşır: korumanın kapsamadığı bir üretim sunucusu, kritik yol, gizli bilgi ya da tehlikeli komut görürse `crew_guard_suggest` aracını çağırsın (`kind`: host, path, command, secret, other; `value`; `reason`). Araç hemen döner, hiçbir diyalog açmaz; not oturum boyunca bellekte kalır (en çok 50, tekrarlar atılır, gizli bilginin yalnızca adı tutulur, uzun token'lar gizlenir). İlki bir toast gösterir. `/crew-guard` (ya da `/crew-guard status`) korumanın açık olup olmadığını ve nedenini, seviyelere göre kural sayılarını, ssh modunu, sunucu sayısını, yapılan ilk temasları ve öneri sayısını gösterir; `/crew-guard suggestions` her öneri için yapıştırmaya hazır bir JSON parçasıyla listeler. Yalnızca yazdırır, dosya yazmaz.

**Ayar dosyası senindir.** `crew-chief-guard.json` dosyasına Write/Edit ya da onu yazan bir Bash komutu (`>`, `>>`, `tee`, `sed -i`, `mv`, üstüne `cp`, `rm`, `python -c`/`node -e` ...) her zaman reddedilir: "the guard configuration can only be changed by the user; propose the change with crew_guard_suggest". Okumak serbesttir. Bu da bir hız kesicidir: bir script dosyası ya da değişkenlerle kurulan bir yol yine geçer. Kural kimlikleri: `rm-rf`, `sql-destructive`, `git-force-push`, `git-reset-hard`, `key-write`, `key-read`, `key-access`, `env-write`, `env-read`, `env-stage`, `env-access`, `ssh-db`, `sql-no-where`, `prod-deploy`, `service-control`.

**Açmak ve kapatmak.** İlk etkileşimli oturum dosyayı senin için yazar (yukarıya bak); `/crew-guard off` ve `/crew-guard on` onu açıp kapatır; `"enabled"` değerini değiştirir, diğer her şeyi korur ve yalnızca sen yazdığında çalışır (Claude, bir plugin ya da SDK çalıştıramaz). Kendininkini yazmak istersen `~/.claude/crew-chief-guard.json` dosyasını `"enabled": true` ile oluştur ([`docs/examples/crew-chief-guard.example.json`](docs/examples/crew-chief-guard.example.json) ile başla) ya da dosyasız, yalnızca hazır kurallar için `CREW_CHIEF_GUARD=on` ver. `CREW_CHIEF_GUARD=off` her zaman kazanır; varsayılan `auto` dosyaya bakar. Dosya oturum başında bir kez okunur (`/clear` ve `/resume` yeniden okur). Geçerli JSON olmayan dosya korumayı o oturum için kapatır ve bunu tek bir toast ile söyler. Hatalı bir kural atlanır (nedeni debug log'a yazılır), diğerleri çalışır. Dosyanın biçimi ve bir örnek İngilizce README'de; alanlar: `rules` (en çok 100 kural; `level` `deny`/`warn`, `tools`, `target` `command`/`file_path`, en çok 300 karakterlik `pattern` ve isteğe bağlı `unless`, `flags` yalnızca `imsu`), `disable` (kapatılacak hazır kural kimlikleri), `ssh` (`mode` `off`/`warn`/`gate`, `prodHosts`, `safeRemote`, `ttlMinutes`).

**ssh kapısı** (`ssh.mode: "gate"`). `prodHosts` listesindeki bir sunucuya giden `ssh`, `scp`, `sftp` ve `rsync` çağrıları için (`*` tek joker; büyük/küçük harf fark etmez; `kullanıcı@sunucu` yalnızca o kullanıcıyı tutar; `-J`/ProxyJump sunucusu da sayılır):
1. **İlk temas.** Bir oturumda, her ajan için, üretim sunucusuna dokunan ilk çağrı bir kez durdurulur. Claude'dan sunucuda gerçekte ne çalışacağını, veri kaybettirip kaybettirmeyeceğini, servis durdurup durdurmayacağını, ayar değiştirip değiştirmeyeceğini ya da gizli bilgi açığa çıkarıp çıkarmayacağını yazması, güvenliyse aynı komutu aynen tekrar çalıştırması istenir.
2. **Salt-okunur komutlar** bundan sonra geçer: `ls`, `cat`, `head`, `tail`, `grep`, `find` (`-delete`/`-exec` olmadan), `df`, `du`, `free`, `uptime`, `ps`, `journalctl` (`--vacuum`/`--rotate` olmadan), `systemctl status`, `docker ps`/`logs`, `git status`/`log`/`diff`, `hostname`, `whoami`, `date`, `stat`, `wc`, pipe ile birlikte de, artı senin `safeRemote` kalıpların. `.env`, anahtar dosyası ya da `/etc/shadow` okumak burada salt-okunur sayılmaz.
3. **Diğer her şey komut başına bir kez durdurulur**; aynı komut `ssh.ttlMinutes` (varsayılan `confirmTtlMinutes`, 360) içinde tekrar gelirse geçer. `scp`/`sftp`/`rsync` dosya kopyası, komutsuz `ssh` (etkileşimli oturum) ve çözülemeyen her şey (heredoc, değişken, komut ikamesi, `xargs ssh`, `-F` ayar dosyası, `ProxyCommand`) riskli sayılır.
4. **Salt-okunur ajanlar** (`scanner`, `deep-reader`, `reviewer`, `ui-smoke`) salt-okunur olmayan her şey için tekrar hakkı olmayan düz bir ret alır.
5. `warn` modu hiçbir çağrıyı durdurmaz, aynı hatırlatmayı çağrıdan sonra ekler. Durum oturum boyunca bellekte tutulur, hiçbir yere yazılmaz.

**Dürüst sınırlar.** Bu bir hız kesici, güvenlik sınırı değil. Komut metnini okur. Sunucuya kopyalanıp çalıştırılan bir script, bir değişken, listede yazıldığı gibi geçmeyen bir ssh config takma adı, başka bir araç (MCP sunucusu, Python paramiko), hook'suz bir mod ya da aracı hiç çağırmamaya karar veren bir model onu aşar; sunucunun geri yazdığı metne gizlenmiş talimatlara karşı da korumaz. Kurallar kelimeye bakar: engellenen bir komuttan yalnızca bahseden bir commit mesajı ya da heredoc da durdurulur; böyle bir kuralı `disable` kapatır. Sunucuyu koruyan şey sunucudadır: `authorized_keys` içinde zorunlu komut (`command="...",restrict`, `SSH_ORIGINAL_COMMAND` bir izin listesine karşı kontrol edilerek), ajan için kısıtlı bir hesap, salt-okunur bir veritabanı kullanıcısı ve en az bir kez geri yüklemeyi denediğin yedekler.

**Salt-okunur korumadan farkı.** `scripts/readonly-guard.sh` her zaman açıktır ve yalnızca crew-chief'in salt-okunur ajanları içindir: denedikleri her yazmayı engeller. Komut koruması isteğe bağlıdır, her ajan ve ana oturum içindir ve yalnızca tehlikeli komutlar ile üretim sunucularıyla ilgilenir. Salt-okunur ajanlar kendi korumalarını korur; ssh kapısı onlar için yalnızca uzak komut kontrolünü ekler.

**Kişisel bir koruma modundan geçiş.** Böyle kuralları olan kendi modun varsa (bir "prod-guard"), kişisel kurallarını `rules` içine taşı (örnek dosya böyle bir modu birebir kurar: şube veritabanları, lisans anahtarları ve "asla branch açma" kuralı), bu korumayı aç, sonra kendi modunu kaldır ya da kapat. İkisi birden açıkken her uyarı ve engel iki kez görünür.

## Mod makinende ne yapar

İncelemeciler ve sen için. Aşağıdakilerin hepsi senin makinende Claude Code'un içinde olur; modun ağ erişimi yoktur ve hiçbir yere bir şey göndermez.

- **Dosya okur:** projenin `STATUS.md`, `tasks.json`, `PROGRESS.md` dosyaları; Claude Code'un yüklediği talimat ve hafıza dosyaları (yalnızca `/crew-tidy` için); compact kapısı için dosya zamanları. Özeti sabitlediğin kurallara ve açık görevlere karşı kontrol etmek, bağlamı denetlemek ve `STATUS.md` güncellenene kadar beklemek için.
- **Ayar okur:** yalnızca `language` ve `advisorModel` anahtarları. API anahtarı, token ya da herhangi bir kimlik bilgisini asla okumaz.
- **Ortam okur:** `HOME` (`HOME` yoksa `USERPROFILE`), `TMPDIR`, `LANG`, `OS` (Windows mu: `OS=Windows_NT`, alt ajan durum satırı için), `CREW_CHIEF_*` anahtarları ve birkaç `CLAUDE_CODE_USE_*` bayrağı.
- **Program çalıştırır:** `wc -l <transcript>` (compact öncesi ve sonrası satır sayısı), `git status --porcelain` (commit'lenmemiş dosya sayısı, compact sorusunda gösterilir), `chmod 600 <dosya>` (kendi yedeklerini özel yapar), `rm -f <eski yedek>` (yalnızca kendi yedeklerinden en yeni 5 ya da 3'ün ötesindekileri), `mkdir -p`, `cp -p <transcript> <yedek>` (yalnızca bir compact transcript satırı kaybettirdiyse), `jq --version` (oturum başına bir kez, yalnızca düz terminalde: shell panel satırı çizilebiliyor mu diye). Argümanlar modun hesapladığı yollardır, konuşmadan gelen metin değildir.
- **Slash komutu çalıştırır:** yalnızca `/advisor`, [advisor teklifine](#advisor-teklifi) evet dedikten sonra bir kez.
- **Prompt gönderir:** crew-chief'ten geldiği belli olan iki sabit metin (asla senin kendi sözün gibi değil): onayladığın compact sonrası "devir dosyalarını güncelle" ve onayladığın limit sıfırlanmasında "kaldığın yerden devam et". Dosya içeriği ya da konuşma metni taşımazlar.
- **Dosya yazar:** kendi veri klasörüne (`compact-summaries/`); ve yalnızca `/crew-tidy archive`'ı onayladığında `PROGRESS.md` (kısaltılmış) ile `PROGRESS-archive.md` (eski girdiler). Talimat dosyalarını, ayarlarını ya da build dosyalarını asla yazmaz.
- **Araç kaydeder:** `crew_compact_checkpoint`; yalnızca bir fazın bittiğini not eder ve Claude'a devam etmesini söyler; sana turn bittikten sonra sorulur.
- **Kendi sorularını cevaplar** (`AskUserQuestion` üzerinde bir `tool.call` hook'u): yalnızca modun kendi açtığı diyaloglar; `CREW_CHIEF_ASK_TIMEOUT_MIN` dakika (varsayılan 20) cevap gelmezse sorunun güvenli seçeneğiyle cevaplar (asla evet, asla *Bir daha sorma*). Claude'un kendi `AskUserQuestion` çağrılarına dokunmaz. Başında kimse olmayan bir session bir eklenti sorusunda takılı kalmasın diye.
- **Tek bir durum satırı çizer** (`$.ui.status`), oturumun yüzeylerini (`$.session.surfaces`) ve ajan listesini (`$.agent.list`) okur: çalışan her alt ajanın adı, modeli, eforu ve token'ı; hiçbiri çalışmıyorsa satır silinir. Alt ajanların modeli ve eforu Desktop, VS Code ve Windows'ta da görünsün diye. Hiçbir şey saklanmaz, gönderilmez.
- **Komut koruması** (isteğe bağlı, bir `tool.call` hook'u): `CREW_CHIEF_GUARD=off` değilse, korumayı açıp açmadığını anlamak için her oturum başında bir kez `~/.claude/crew-chief-guard.json` dosyasını okur (`HOME`, Windows'ta `USERPROFILE`). Yalnızca açıksa: her Bash komutunun ve dosya yolunun metnini okur; bir araç çağrısını reddedebilir (Claude'a neden, sana komutun en çok 80 karakterini gösteren bir toast) ya da sonrasına uyarı ekler; ajan listesini yalnızca bir ajanın salt-okunur olup olmadığını anlamak için okur. Ağ yok, hiçbir şey saklanmaz ya da yazılmaz; ssh kapısının hafızası oturumla biter.
- **Compact hook'u:** compact'e özetleyici talimatı ekler (`session.compact`) ve compact'i yalnızca senin evetinden sonra başlatır.

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

## crew-ui: band, sorular ve paneller

**Sen isteyene kadar kapalı.** `/crew-ui on` prompt'un üstünde bir band çizer (terminal ve Desktop uygulaması; VS Code kendi durum satırında kalır). `settings.json`'a hiç yazmaz. Mod'un küçük bir parçası (`hooks/src/crew-ui.js`, düzeni `hooks/ui-logic.mjs`).

- **Ne gösterir.** Çalışan her alt ajan için bir satır (`deep-reader  sonnet-5.5 ●●○○○ medium ▓▓░░░░ 40%  12k  reading auth`) ve context (son turların küçük grafiğiyle), 5 saat ve 7 gün limitleri, guard, saver ve compact tuşunun olduğu bir durum satırı. Efor ölçerin her seviye (`low`'dan `max`'a) için bir noktası var, yani beş nokta; renk çizilen yerde `max` gökkuşağı olur.
- **Varsayılan sessiz.** Band yalnızca bakmaya değer olanı gösterir: çalışan bir alt ajan, %70'i geçen limit ya da context, guard'ın durdurduğu bir şey, vakti gelen compact. Söyleyecek bir şey yoksa çizilmez. `/crew-ui full` her şeyi hep gösterir. Terminalde kendi `statusLine`'ın varsa sessiz band context ve limitleri göstermez (o satırda var); Desktop'ta böyle bir satır olmadığı için onlar da gösterilir.
- **Görünüm.** `/crew-ui style boxed|plain|color|pills` (varsayılan `boxed`: yuvarlak çerçeve); `/crew-ui demo on` meşgul bir oturum beklemeden tarzı görmek için örnek içerik çizer.
- **Soruların düğme olarak gelir.** Band açıkken plugin'in kendi soruları (compact, compact kapısı, limit ve saver, advisor teklifi, limit sıfırlanması, `/crew-tidy archive`) dialog yerine band'da sorulur: `1 Evet  2 Şimdi değil ...` yazan lila bir şerit. Prompt boşken rakama bas (ya da `ctrl+x tab`, sonra tuş). Hiçbir şey bloklanmaz; cevaplanmazsa her zamanki 20 dakikadan sonra güvenli cevapla sona erer. VS Code, kapalı band ya da dörtten fazla cevap eski dialog'u kullanır. Claude'un kendi soruları (AskUserQuestion) hiç değişmez.
- **Küçük dokunuşlar** (`/crew-ui extras off` ile kalkar): spinner kelimesinden sonra ve tur satırından önce model ve efor (`opus ●●○○○ · Baked for 3s`), saver açıkken ya da guard bir şey durdurduğunda footer'ın mod etiketlerinde bir not, prompt ipucunun sonunda bir limit notu. `/crew-ui words on` spinner kelimesini de modele göre sakin bir kelimeyle değiştirir (`Pondering`, `Working`, `Skimming`); varsayılan kapalı.
- **Paneller.** `/crew-panel tasks` projenin `tasks.json`'unu listeler, `/crew-panel agents` bu oturumdaki alt ajanların zaman çizelgesini çizer (ne zaman başladı, bitti, model, efor, token), `/crew-panel guard` komut korumasının durdurduğu, reddettiği ya da uyardığı şeyleri listeler. İstendiğinde açılır, iki saniyede bir yenilenir, `ctrl+x x` ya da `/crew-panel close` ile kapanır ve bir alt ajan çalışırken de çalışır.
- **Nerede görüldü.** Band, sessiz ve tam modlar, `boxed` tarzı, tur satırındaki dokunuş ve efor ölçer terminalde canlı görüldü. Band'daki sorular, paneller, spinner kelimeleri, `color` ve `pills` şimdilik yalnızca testlerle kapsanıyor.
- **Ortam.** `CREW_CHIEF_UI=on|off` kayıtlı seçimi geçersiz kılar.

## Ne çalıştırır
Her şey bu repoda okunabilir shell ve küçük bir JavaScript modu (`hooks/register.js`) olarak duruyor. Ağa hiçbir şey göndermez.
- `session-policy.sh`: oturum açılırken yaklaşık 2 KB'lık politikayı bağlama ekler. Devir dosyası olmayan bir git reposunda yeni oturumda bir kezlik [devir önerisini](#oturum-devri) de ekler; kendisi dosya yazmaz.
- `subagent-row.sh`: alt ajanlar çalışırken listedeki her satıra model, efor, token ve geçen süreyi yazar; rapor tazeyken (25 tool çağrısından ve 10 dakikadan eskiyse değil) yaklaşık yüzde, o an yaptığı iş ve gecikme nedenini de ekler; eskiyse yüzdeyi gizler ve `80 calls · report 41m ago` yazar: `implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite`.
- `skill-hint.sh`: UserPromptSubmit'te prompt'u `data/skill-catalog.json` ile eşleştirir (iş türü başına Türkçe ve İngilizce anahtar kelimeler); o iş için tercih edilen bir skill kuruluysa tek satır ekler: "önce X skill'ini yükle". Tavsiyedir, zorlama değil. Prompt başına en fazla iki hint, her iş türü session'da bir kez, slash komutlarında hiç. Kendi iş türlerini `~/.claude/crew-chief-skills.json` ile ekleyebilirsin (katalogdaki `categories` ile aynı şekil; aynı `id` yenisini koyar, `"disabled": true` kaldırır). `CREW_CHIEF_SKILL_HINTS=off` kapatır.
- `skill-offer.sh`: git projesinde session başlangıcında stack'e bakar (`pubspec.yaml`, `package.json`, `*.xcodeproj`, `supabase/config.toml`...). O stack için tercih edilen skill'lerden hiçbiri kurulu değilse Claude bir kez sorar: katalogdaki elle doğrulanmış skill'lerin adı, kaynağı, ne yaptığı, tam kurulum komutu ve risk notu. Sen evet demeden hiçbir şey kurulmaz, projeye dokunulmaz. "Şimdi değil" bir hafta bekletir, "Hiçbir zaman" proje ve iş türü başına hatırlanır. Liste katalogdaki `verified` tarihinde doğrulandı; 90 günden eskiyse Claude bunu söyleyip web'den kontrol önerir. Çalışma anında talimat çeken ya da script çalıştıran skill'ler bilerek teklif listesinde yok. Katalogda bir stack olmayan tek bir iş türü daha var: proje haritası ([structure-map](https://github.com/aykyusuf/structure-map)). Kurulu değilse, git tarafından izlenen en az 60 dosyası olan her kod projesinde teklif edilir (katalogdaki `minFiles`). `CREW_CHIEF_SKILL_OFFER=off` kapatır.
- Uzun raporlar dosyaya: `deep-reader` ve `reviewer` `Write` tool'una sahip ama guard yalnızca `${TMPDIR:-/tmp}/crew-chief-reports/` altına yazdırır. ~40 satırı aşan rapor oraya yazılır, ajan en fazla 15 satır özet ve yolu döner; kısa raporlar eskisi gibi metin olarak gelir. Başka yol, `Edit`, göreli yol, `..` ve klasörden çıkan symlink engellenir.
- Ajanlar skill yükleyebilir: `deep-reader`, `implementer`, `implementer-hard`, `reviewer`, `ui-tester` `Skill` tool'una sahip (`scanner` ve `ui-smoke` değil). Skill listeni görmezler, bu yüzden policy ana session'a brief'te skill adını yazmasını söyler. Skill ağırlıklı işte `general-purpose` kullanılabilir ama `model` açıkça verilmeli; yoksa ana modeli devralır.
- `progress-hook.sh`: PostToolUse'ta (yalnızca alt ajan çağrıları) her ajan için `${TMPDIR:-/tmp}/crew-chief-progress/` altında küçük bir dosya tutar. Her alt ajan, `SubagentStart` hook'unun (`subagent-start.sh`) eklediği kuralla başlar: yaklaşık her 10 tool çağrısında `: 'crew-progress 40 | ne yapıyorum | neden yavaş'` diye etkisiz bir Bash çağrısıyla rapor verir (`deep-reader`, `implementer`, `implementer-hard`, `reviewer`, `ui-tester`). Yüzde ajanın kendi tahminidir (satırda `~` ile), ölçüm değildir; çağrı turn limitine sayılır. Ajan unutursa bu hook, rapor vermeden geçen her 10 çağrıdan sonra ajanın bağlamına bir hatırlatma ekler (hatırlatmanın alt ajana ulaştığı dokümanın doğal okumasıdır, canlıda doğrulanmadı). Rapor yoksa ya da eskiyse satırda eski etiket kalır; tek bir tool çağrısı 45 sn'yi geçerse `⚠ Bash took 61s` otomatik eklenir. `jq` gerekir; 12 saatten eski dosyalar silinir.
- `install-row.sh`: Claude Code plugin'in `subagentStatusLine` ayarını panele uygulamadığı için, ilk session'da bu satırı senin `~/.claude/settings.json` dosyana bir kez ekler (kendi ayarını ezmez, silersen geri eklemez, yedek alır). Kapatmak için `CREW_CHIEF_ROW=off`.
- `register.js` (mod): token saver. Plan limitini ve bağlam boyutunu Claude Code içinden okur, eşikte `ui.ask` ile sorar, açıkken subagent effort'unu düşürür. Saver durumunu sadece bellekte tutar; dili ve advisor teklifine verdiğin cevabı hatırlar. Ayrıca `/advisor`'ı bir kez önerir ([Advisor teklifi](#advisor-teklifi)).
- `hooks/src/*.js` (modun parçaları, `hooks/register.js` içinde birleştirilir): [compact akışı](#compact-akışı), [limit sıfırlanması](#limit-sıfırlanması), [`/crew-tidy` ve `/crew-report`](#context-denetimi-ve-rapor), alt ajan durum satırı (`agent-row.js`). Plugin'leri inceleyen dizin mod dosyasını tek başına okuduğu için `$` kullanan her şey `tools/build_mod.py` ile tek okunabilir `hooks/register.js` dosyasında birleştirilir (`hooks/src/` düzenlenir, sonra script çalıştırılır; CI güncel olup olmadığını kontrol eder). `$` görmeyen saf yardımcılar ayrı kalır.
- `compact-restore.sh`: SessionStart (compact) hook'u. Compact'ten sonra projenin devir dosyalarından kullanıcının sabitlediği Kısıtlar'ı, Şu an'ı, Sıradaki'ni, Kararlar'ı, son başarısız denemeleri ve açık görevleri (en fazla yaklaşık 8000 karakter) ve transcript yolunu basar. Sadece okur; `CREW_CHIEF_RESTORE=off` kapatır.
- `mode-guard.sh`: `/crew-chief:crew-mode solo` yazdığında modu o oturum için kaydeder ve solo iken alt ajan açılmasını engeller.
- `plugin-notices.sh`: güncellemeden sonra yeni sürümün ne getirdiğini gösterir; açık bir oturum eski kopyada kaldıysa bir kez uyarır.
- `readonly-guard.sh`: Bash çağrılarında çalışır. Sadece `scanner`, `deep-reader`, `reviewer` ve `ui-smoke` için yazma komutlarını engeller, diğer çağrılara dokunmaz.

Saklananlar kendi makinende `~/.claude/plugins/data/<plugin>/` altında kalır ve plugin kaldırılınca Claude Code bu klasörü siler: devir önerisine verdiğin cevaplar (`handoff-offers.tsv`: her cevap için bir satır, proje yolu ve `installed`/`never`/`later`; her projede son satır geçerli), en son hangi sürümü gördüğün (`last-seen-version`), Claude Code sürümünü hangi plugin sürümü için kontrol ettiği (`claude-version-checked`) ve solo modu ile eski-oturum uyarısı için oturum kimliğiyle adlandırılmış küçük işaret dosyaları (`modes/`, `stale-notified/`; iki hafta sonra silinir). Token saver modu limitini, bağlam boyutunu ve promptlarının ilk satırlarını (yalnızca Türkçe ile İngilizceyi ayırt etmek için) Claude Code içinde okur; hiçbirini kaydetmez, sadece tespit ettiği dili (`tr` ya da `en`) ve advisor teklifine verdiğin cevabı (`answered`, `never` ya da bir bekleme zamanı) plugin'in deposunda tutar. Projene hiçbir şey yazılmaz.

Ayrıntılar ve geliştirme komutları için İngilizce README'ye bak.

## Lisans
MIT
