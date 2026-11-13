# Değişiklik günlüğü (Türkçe)

Türkçe notlar 0.3.0'dan başlar; öncesi için [CHANGELOG.md](CHANGELOG.md) (İngilizce). Bildirim Türkçe olduğunda "ne yeni" maddeleri buradan okunur; bu dosyada o sürümün bölümü yoksa İngilizce olanı gösterilir.

## 0.12.2 (2026-11-13)
- **Ajan satırı host'un bildirdiği effort'u gösterir.** Saver açıkken satır, saver'ın isteğe yazdığı effort'u gösteriyordu (Opus ajanları `medium`), ama host ajan tanımındaki kendi effort'unu koruyor (bir `planner` gerçekte `high` çalışırken satır `medium` diyordu; `/tasks` doğruydu). Satır artık host'un verdiği değeri, saver'ın düşürmesinden önceki hâliyle gösterir. Cap'in kendisi değişmedi.

## 0.12.1 (2026-11-10)
- **Ajan prompt'ları Anthropic'in güncel model rehberlerine uyuyor** (çıkarım `docs/model-prompting/` içinde). Yazan ajanlar (`implementer`, `implementer-hard`, `mechanic`): sadece kodu ayrıştıran ya da başlayamayan kontrol sayılmaz; istenen her şey bitene kadar çalış, istenmemiş özellik, test, dosya, doküman yok, kendi geçici dosyalarını sil; genel çözüm yaz, test girdilerine özel durum yazma; bağımsız okumaları toplu yap; paket kurma, eksik bağımlılığı ve projenin kurulum komutunu raporlayıp dur. Salt-okunur ajanlar neden salt-okunur olduklarını söyler; `deep-reader` ve `planner` bugünün tarihine bakar ve değişmiş olabilecek bilgiyi arar; `scanner` verilen her aramayı yapar; `reviewer` sadece bulgu döner, kanıtlayamadığına `plausible` der.
- **Yönlendirme skill'i ve oturum politikası.** Eksik bağımlılık çağıranın kararı (projenin kendi paket yöneticisiyle kur, asla sudo; büyükse ya da depolama, lisans, ücretli servis veya sisteme dokunuyorsa önce kullanıcıya sor); ret aynı seviyede tekrar çalıştırılmaz ve ajanlardan akıl yürütme metni istenmez; Haiku low için kısa brief; "bu kod tabanı senin" cümlesi brief'e varsayılan eklenmez; ana model Fable ise okuma ve aramayı `scanner`/`deep-reader`'a verir.
- **Model referansı**: Anthropic'in maliyet sayfasından çözülen görev başına maliyet (sadece yön), "daha az düşün" prompt'ları Sonnet, Haiku ve Fable'da işe yaramaz, Fable bayat kuralları harfi harfine uygular.
- **Handoff**: yeni kurallar nedeni ve kapsamıyla yazılır; oturum sonu ve compact güncellemesi, bayat görünen bir Constraint'i silmek yerine adını söylemeyi ister. Alt ajanlara **ilerleme hatırlatmaları** üç cevapsızdan sonra durur.
- **Handoff dosyaları güncel kalır.** Bunlara sahip bir projede crew-chief düzenlenen proje dosyalarını sayar (üretilmiş dosyalar, `node_modules`, kilit dosyaları ve başka klasörler sayılmaz) ve `handoff.files` kadarından sonra, ya da `handoff.minutes` boyunca bunun üçte birinden sonra Claude'a hatırlatır; hatırlatma bir Edit/Write sonucuyla (gözetimsiz koşulara da ulaşır) ve bir sonraki prompt'la gelir. Kullanıcı bir kural belirtmiş olabilirse, bir soruyu cevaplarsa, commit atılırsa ya da limit dolmak üzereyse tek seferlik hatırlatmalar. Dosyalara yazılan her şey, bir kabuktan bile olsa, sayacı sıfırlar; hatırlatmalar aralıklıdır ve cevapsız üçüncüden sonra durur. `handoff.mode turn` cevapsız hatırlatmalardan sonra güncelleme isteyen fazladan bir tur ekler. `/crew-config` (`handoff.*`) ya da `CREW_CHIEF_HANDOFF=off|nudge|turn` ile ayarlanır. Dosyaları kendisi yazmaz, soru sormaz.

## 0.12.0 (2026-11-10)
- **Ultra tasarruf.** `/saver ultra` alt ajanları Opus ve Fable'dan uzak tutar: `implementer-hard`, `planner` ve `reviewer` Sonnet high ile çalışır, Sonnet ajanları en fazla high, gerisi kendi varsayılanında kalır. Agent çağrısında model ve effort yeniden yazılır. Opus sadece senin evetinle: `xhigh`/`max` istenen bir inceleme ya da Opus adını veren bir çağrı önce sorar, cevap gelmezse hayır sayılır; `/saver ultra opus on|off` oturum boyunca kalıcı evet. Limit sorusunun dördüncü cevabı olarak teklif edilir, kendi kendine açılmaz (`CREW_CHIEF_ULTRA=on` betikli bir session'ı bu kipte başlatır). Ana model hiç değiştirilmez. `claude -p` ile canlıda görüldü: aynı `implementer-hard` çağrısı ultra yokken Opus 5.5, ultra varken Sonnet 5.5 ile çalıştı.
- **`/crew-config`.** Compact boyutları (`compact.arm`, `compact.ask`), sorudan önceki sessizlik süresi, tekrar sorma adımı, crew-chief'in kendi kendine sorup sormayacağı, küçük pencere yüzdeleri, saver eşikleri ve sorusu, soru süresi ve band'in ajan uyarısı ayarlanabilir ve session'lar arasında kalır; ortam değişkenleri yine kazanır. Hatalı değer reddedilir.
- **İki yeni ajan.** Doğrulama komutlu mekanik düzenlemeler için `mechanic` (Haiku/low), `implementer-hard`'dan önce komutla kontrol edilebilir bir bitiş koşulu olan plan için `planner` (Opus/high, salt-okunur). İkisi de politikada, yönlendirme skill'inde ve testlerde; `planner` salt-okuma bekçisinin altında.
- **Yönlendirme ve ajanlar.** Reviewer yakınsar (turlar, sadece yeni diff, hata sınıfı, kendi bulgusuna karşı çıkma); implementer'lar kontrolü ve çıktısını aktarmak ya da `not verified` demek zorunda; yönlendirme skill'ine "bu bir model işi mi", bağımsız context'ler, toplu işten önce pilot, kanıt yoksa bitmedi, yakınsayan yeniden inceleme ve gözetimsiz işler için beş soruluk ön kontrol eklendi. Model referansına deneme sırası (kontrol, effort, model), önce low sonra başarısızları tekrar, doğal kırılma noktasında geçiş ve ucuz bir `Explore` (`/crew-chief:crew-setup --explore` yazar) eklendi.
- **`/crew-tidy`** ayrıca BÜYÜK HARF ve "daha çok düşün" alışkanlıklarını, hep yüklenen dosyalardaki geçici bilgileri ve `@import`'ları raporlar. **`/crew-report`** en pahalı üç alt ajan koşusunu adlandırır.
- **Band**, `agents.warn`'dan fazla alt ajan çalışınca bunu söyler; başka bir çalışan yazarın da adlandırdığı dosyaları adlandıran yazan ajan çağrısına not eklenir (engellenmez).
- **Guard şerit örneği** (`docs/examples/crew-chief-guard-lanes.example.json`): migration'lar, altyapı, ödeme çağrıları ve production `.env` dosyaları warn, confirm ve deny'a ayrılmış. Varsayılan olarak hiçbir şey açık değil.
- Altı eval vakası (brief kapsamı ve kontrolü, gözetimsiz ön kontrol, agent değil betik ve üç ders: üç denemeden sonra yeniden planla, başarısız birim tek başına döner, kanıtsız rapor doğrulanmamıştır); ücretli olduğu için henüz çalıştırılmadı. `evals/compare/compare.py` solo, routed ve ultra için bitmiş görev başına maliyeti karşılaştırır (`--run` olmadan kuru koşu).
- **İlk koşu.** Band, bir ajan tipinin session'daki ilk koşusunu işaretler.

## 0.11.5 (2026-11-06)
- **Guard artık git'i tanıyor.** Yeni `confirm` kuralları (ilk deneme durur, aynı komut tekrarında geçer): `git-push-delete` (`push --delete`, `push origin :ref`, `--mirror`), `git-branch-delete` (`branch -D`), `git-clean` (`clean -f`), `git-discard` (`checkout -- .`, `checkout -f`, `restore`, `stash drop/clear`), `git-rewrite` (`rebase`, `commit --amend`, `filter-branch`, `reflog expire`, `gc --prune`). `+ref` ile force push da yakalanıyor. Yerel işler (`add`, `commit`, `pull`, `merge`, `checkout <branch>`, düz `push`) hiç durdurulmaz; bu yüzden `settings.json`'daki git `ask` listesine artık gerek yok.
- **Guard'dan daha az gürültü.** `key-access` yalnızca gerçekten bir key dosyasını adlandıran kelimelere bakıyor: `-iname "*.pem"` ya da `grep '\.pem|\.key$'` gibi glob/regex artık `git add`/`cat` komutunu durdurmuyor. `.env.example`, `.env.sample`, `.env.template`, `.env.dist` şablon sayılır, secret değil (`env-*` uyarısı yok). Git kuralları heredoc gövdesini ve `-m` mesajını yok sayıyor; mesajında yıkıcı bir git komutu geçen commit durdurulmaz.
- **Compact kapısı iki kez sormuyor.** "Onayından beri dosyalar değişmedi" sorusu artık STATUS.md, tasks.json ve PROGRESS.md'ye bakıyor, onaydan on dakika öncesine kadar yazılmış dosyayı da güncel sayıyor. "Önce Claude güncellesin" seçilip Claude'un turu değiştirecek bir şey bulmadan (dosyaları güncel bulup) bittiyse soru tekrarlanmaz, compact devam eder.
- **Band soruları bırakmıyor.** Band'ın dayandığı yüzey listesi oturum başında bir kez okunuyordu; o okuma boş dönerse (ya da istemci sonradan bağlanırsa) tüm oturum boyunca her plugin sorusu eski diyalogla açılıyordu. Yüzeyler artık satır kontrolünde ve soru sorulmadan önce yeniden okunuyor.

## 0.11.4 (2026-11-01)
- **Routing skill: zincirlemeden önce bağımlılık testi.** Adımlar sıraya dizilmeden önce Claude "ikincisi birincinin çıktısını gerçekten okuyor mu?" diye soruyor; aralarından hiçbir değişken geçmiyorsa paralel çalışıyorlar.
- **Routing skill: batch'i değil birimi geri gönder.** Fail eden parça tek başına, verdict, sebep, kanıt ve scope satırıyla geri gidiyor; geçen parçalar tekrar yapılmıyor. Aynı birim üç düzeltmede de fail ederse sorun brief'te ya da bölmede demektir, Claude tier yükseltmeyi bırakıyor.
- **Handoff: doğrulanmış hata sebebi kurala dönüyor.** STATUS şablonu ve CLAUDE.md rutini Decisions altına kısa bir kural yazılmasını istiyor; sonraki brief'ler bunu taşıyor.

## 0.11.3 (2026-10-30)
- **Paneller güvenilir kapanıyor.** `/crew-panel close` motorun açık gördüğü bütün `crew-` panellerini, mod'un neyi hatırladığına bakmadan (yeniden yüklenmiş olabilir) kapatıyor; `/crew-panel tasks|agents|guard` aynı komut tekrar yazılınca kendi panelini kapatıyor.
- **Ajan paneli biten ajanları adıyla gösteriyor.** Ajanın adı ilk isteği görülünce saklanıyor, böylece çalışan ajanlar listesinden çıktıktan sonra da adıyla görünüyor (eskiden `agent` yazıyordu). Mod yüklenmeden başlayan ajanlar adsız kalıyor.

## 0.11.2 (2026-10-30)
- **Band, yer olduğu sürece çalışan her ajanı çiziyor.** Motor ona terminalin yarısını verse bile dört satırda (bir durum satırı ve üç ajan) duruyordu; artık çerçeve ve soru için yer ayırıp sekiz satıra kadar çiziyor, "+N more agents" yalnızca yer gerçekten bitince çıkıyor.
- **Compact tuşu "şimdi değil"i dinliyor.** "Şimdi değil"den sonra context bir 100k daha büyüyene kadar (akış yeniden sorana kadar), "bir daha sorma"dan sonra kalıcı olarak ekranda durmuyor.
- **Kalıcı "starting" yok.** Modelini mod'un hiç görmediği bir ajan (örneğin plugin oturum ortasında güncellenince, mod yüklenmeden başlamış) 15 saniye sonra "starting" yerine sadece adını gösteriyor.
- **Ajan yüzde bildirmezse çağrı sayısı ve süre.** Ajanın token'ından sonra `34 calls · 4m12s`; yüzde varsa yalnızca süre. Uydurma yüzde yok.
- **İlerleme hatırlatmaları her yerde mod'dan geliyor ve daha sert.** Kural, rapor vermemiş bir ajanın ikinci çağrısında söyleniyor; rapor vermeden geçen her 10 çağrıdan sonra bir sonraki çağrının sonucuyla bir hatırlatma gidiyor ve cevapsız kalan her biri daha sert. Hiçbir çağrı engellenmiyor. `scripts/progress-hook.sh` dosyaları tutuyor ve hiçbir şey yazdırmıyor (hatırlatmasının bir alt ajana ulaştığı hiç görülmedi; mod'unki Windows'ta görüldü).

## 0.11.1 (2026-10-29)
- **crew-ui bandı varsayılan açık ve sessiz.** Söyleyecek bir şey yokken (çalışan alt ajan yok, %70'i geçen limit ya da context yok, guard'ın durdurduğu bir şey yok, vakti gelen compact yok) hiçbir şey çizmez; yani güncelleme sakin bir ekrana bir şey eklemez. Bir kez bildirimle söylenir; `/crew-ui off` kapatır ve kapalı tutar, `CREW_CHIEF_UI=off` da. Açıkken plugin'in kendi soruları dialog yerine band'da sorulur ve küçük dokunuşlar (spinner ve tur satırında model ve efor) görünür; ikisi de `off` ile gider. Bu, güncelleyen herkes için varsayılanı değiştirir.

## 0.11.0 (2026-10-29)
- **crew-ui**, `/crew-ui on` diyene kadar kapalı: prompt'un üstünde (terminal ve Desktop uygulaması) çalışan her alt ajan için bir satır (model, beş noktalı efor ölçer, ilerleme çubuğu, token, adım), küçük grafikle context, 5 saat ve 7 gün limitleri, guard, saver ve bir compact tuşu olan band. Varsayılan sessiz (yalnızca bakmaya değer bir şey varken görünür; terminalde kendi `statusLine`'ın varsa context ve limitleri göstermez), her şey için `/crew-ui full`, `/crew-ui style boxed|plain|color|pills` (varsayılan `boxed`), örnek içerik için `/crew-ui demo on`. `settings.json`'a hiç yazmaz.
- **Sorular band'da.** Band açıkken plugin'in kendi soruları (compact, compact kapısı, limit ve saver, advisor teklifi, limit sıfırlanması, `/crew-tidy archive`) dialog yerine lila bir şeritte düğmeler olarak sorulur, rakam tuşuyla cevaplanır. Süre sınırı, güvenli varsayılan ve dialog'a dönüş (VS Code, kapalı band, dörtten fazla cevap) aynı; Claude'un kendi soruları hiç değişmez.
- **Küçük dokunuşlar** (`/crew-ui extras off` kaldırır): spinner ve tur satırının yanında model ve efor, footer'ın mod etiketlerinde bir crew-chief notu, prompt ipucunun sonunda bir limit notu; `/crew-ui words on` (varsayılan kapalı) spinner'a modele göre sakin bir kelime verir.
- **Beş seviyeli efor ölçer.** `low` `●○○○○`, `medium` `●●○○○`, `high` `●●●○○`, `xhigh` `●●●●○`, `max` `●●●●●` (renk çizilen yerde gökkuşağı). `max` daha önce `xhigh` gibi çiziliyordu.
- **Paneller**: `/crew-panel tasks` (tasks.json), `/crew-panel agents` (bu oturumdaki alt ajanların zaman çizelgesi), `/crew-panel guard` (guard'ın durdurduğu, reddettiği ya da uyardığı şeyler). Komut bir alt ajan çalışırken de çalışır (`immediate`).
- Terminalde canlı görüldü: band, sessiz ve tam modlar, `boxed` tarzı, tur satırındaki dokunuş ve efor ölçer. Şimdilik yalnızca testlerle kapsanıyor: band'daki sorular, paneller, spinner kelimeleri, `color` ve `pills` tarzları.

## 0.10.3 (2026-10-28)
- `jq` kurulu bir Windows artık prompt'un üstünde fazladan `⚠crew-chief: ...` satırı almıyor: altındaki panel satırı (model, efor, token, süre, yüzde) orada da çalışıyor, o satır tekrar oluyordu. Windows'ta yalnızca `jq` yoksa çizilir, diğer terminallerdeki gibi (`CREW_CHIEF_ROW_MOD=on` yine zorlar). `jq` 1.8.2'li Windows'ta görüldü: panel satırı ve `~NN%` ikisi de çalışıyor.

## 0.10.2 (2026-10-28)
- İlerleme hatırlatması artık etkisiz çağrının ayrı bir tool değil, bir Bash komutu olduğunu söylüyor. Windows'taki bir alt ajan "bu no-op'u çalıştır"ı sahip olmadığı bir tool sanıp raporu atlamıştı, bu yüzden yüzde görünmedi.
- `jq` yoksa prompt'un altındaki ajan paneli her alt ajanın modelini ve eforunu gösteremez (o satır `jq` isteyen bir shell script'i). crew-chief artık bunu bir kez, bir toast ile söylüyor (soru değil): Windows'ta `winget install jqlang.jq`, diğerlerinde `brew install jq`. Yüzey yokken (`-p`, SDK) ya da `CREW_CHIEF_ROW=off` iken gösterilmez. Panel satırının `jq`'suz bir sürümü planlı, yazılmadı.

## 0.10.1 (2026-10-28)
- Windows'ta ve `jq` olmayan her yerde ilerleme: mod her alt ajanın tool çağrılarını ve `crew-progress` raporlarını kendisi (bellekte) sayar; durum satırı model ve eforun yanında `~40%` gösterir, 10 çağrılık hatırlatma `jq` olmadan da alt ajana ulaşır. `jq` çalışan yerde hatırlatmayı yine shell hook yapar, kimse iki kez hatırlatılmaz.
- "Şimdi değil" dedikten sonra compact: `crew_compact_checkpoint` artık `user_requested: true` alıyor. Compact'i kendi sözlerinle istediğinde, az önce reddetmiş (ya da "bir daha sorma" demiş) olsan bile çalışır; "henüz gerekmez" cevabı vermez. "Gerekmez" cevabı bunu söylüyor, Claude'a da seni `/compact`'a yönlendirmemesi söyleniyor.
- Varsayılan guard ayarı artık her host'a ilk ssh'ı durdurmaz: `ssh.mode` `warn` (loopback dışı bir host'a ilk bağlantıda sana ve Claude'a not). İlk denemeyi durdurmak için `"gate"` yazıp üretim host'larını listele. Yazılmış ayar dosyalarına dokunulmaz.
- Guard'ın uyarısı, sardığı tool sonucunu yeniden kurmak yerine tüm alanlarını korur (iki guard aynı `rm -rf`'yi sararken görülen "result does not match its output shape" hatasına karşı bir önlem; nedeninin bu olduğu doğrulanmadı).

## 0.10.0 (2026-10-28)
- Komut koruması kendini kuruyor: `~/.claude/crew-chief-guard.json` yoksa ilk etkileşimli oturum varsayılan ayarı yazar (yerleşik kurallar; loopback dışındaki her host üretim sayılan ssh kapısı), korumayı o oturumda açar ve bir kez bildirim gösterir. Dosya bir kez yazılır; silersen yeniden oluşturulmaz. `CREW_CHIEF_GUARD_AUTOSETUP=off` ya da `CREW_CHIEF_GUARD=off` bunu engeller; `-p`/SDK oturumları hiçbir şey yazmaz. Bu, güncelleyen herkes için varsayılanı değiştirir.
- `/crew-guard on` ve `/crew-guard off` ayardaki `enabled` değerini değiştirir (diğer anahtarlar korunur, geçersiz JSON'a dokunulmaz, hemen geçerli olur); yalnızca sen yazdığında çalışır, Claude, plugin ya da SDK çalıştıramaz.
- ssh kapısı: `*` host deseni artık localhost, 127.x, `::1` ve `*.local` ile eşleşmiyor; ssh'ı yalnızca anan komutları (`ssh -V`, `which ssh`, commit mesajları, `GIT_SSH_COMMAND`) artık durdurmuyor.
- Devir ve skill önerileri artık ilk yanıtı bekletmiyor: Claude önce isteğinizi yapar, cevabının sonuna tek kısa satır ekler (diyalog yok). Gece boyu, arka planda veya döngüde çalışan işlerde ve etkileşimsiz çalıştırmalarda öneri hiç yapılmaz. Gösterildiği anda "sonra" olarak kaydedilir; görmezden gelinen öneri bir hafta susar.
- Devir dosyası olmayan projede sıkıştırma artık kurulum için soru sormuyor: devam eder ve son satırında `/crew-chief:crew-handoff` komutunu bir kez anar.
- `crew-routing` skill'i: `implementer-hard` bir ürün kararında durursa Claude ona bağlı olmayan kısmı bitirir ve soruyu tüm işi durdurmak yerine son cevabına yazar.

## 0.9.0 (2026-10-27)
- Komut koruması, isteğe bağlı ve varsayılan olarak kapalı: `/`, `~` ya da `*` üzerinde `rm -rf`, `DROP`/`TRUNCATE`, `git push --force`, `git reset --hard` ve özel anahtar dosyalarını engeller; diğer `rm -rf`, `.env` erişimi, `WHERE`'siz `DELETE`/`UPDATE`, deploy, servis durdurma/yeniden başlatma ve ssh üzerinden veritabanı istemcileri için uyarır. Kendi engel/uyarı kuralların ve kapattığın hazır kurallar `~/.claude/crew-chief-guard.json` dosyasına yazılır; `docs/examples/crew-chief-guard.example.json` kişisel bir prod-guard modunu birebir kurar. `CREW_CHIEF_GUARD=auto|on|off`.
- Üç seviye: deny (hiç çalışmaz), confirm (ilk deneme 5 satırlık bir kontrol listesiyle durdurulur ve Claude kendisi cevaplar: ne nerede çalışıyor, ne kaybolabilir, yedek ya da geri dönüş, doğru hedef, GÜVENLİ ya da RİSKLİ; aynı komut sonra `confirmTtlMinutes` içinde (varsayılan 360) sessizce geçer; değişen komut yenidir) ve warn. Varsayılan olarak yalnızca felaket boyutundaki `rm -rf` ve korumanın kendi ayarı deny'dir; riskli silmeler, yıkıcı SQL, force push, hard reset, özel anahtarlar, deploy, servis durdurma ve ssh üzerinden veritabanı istemcileri confirm'dür.
- `crew_guard_suggest`: Claude ayarında olmayan bir sunucuyu, yolu, gizli bilgiyi (yalnızca adı) ya da komutu işaretler; araç hemen döner, hiçbir şey sormaz. `/crew-guard status|suggestions` durumu ve yapıştırmaya hazır JSON'u yazdırır, dosya yazmaz.
- Claude `~/.claude/crew-chief-guard.json` dosyasını yazamaz; okumak serbest. Bu da bir hız kesici.
- ssh "ilk temas" kapısı (`ssh.mode: "gate"`): bir oturumda listedeki üretim sunucusuna giden ilk çağrı, orada gerçekte ne çalışacağının incelenmesi istenerek bir kez durdurulur; ardından salt-okunur uzak komutlar (`ls`, `tail`, `grep`, `systemctl status`, `docker logs`...) geçer, diğer her şey komut başına bir kez durdurulur ve onay süresi içinde (varsayılan 360 dakika) aynen tekrarlanırsa geçer. `ssh`, `scp`, `sftp` ve `rsync` küçük, tırnak bilen bir ayrıştırıcıyla okunur; okuyamadığı her şey riskli sayılır. Salt-okunur ajanlar düz ret alır. Bir hız kesici, güvenlik sınırı değil: README sunucuyu gerçekten koruyan sunucu tarafı önlemleri listeler.
- Durum: birim testleri (kurallar, prod-guard eşliği, ayar kontrolleri, 60 ssh ayrıştırma örneği, kapı) ve mod test düzeneği testleriyle kaplı; gerçek bir sunucuya karşı, gerçek bir oturumda alt ajanlarla ya da Windows'ta henüz canlı çalıştırılmadı.
- Ajan paneli satırı ve ilerleme raporları: raporlanan `~N%` ve adım yalnızca rapor tazeyken (25 araç çağrısından ve 10 dakikadan eskiyse değil) gösterilir; sonrasında eski yüzde yerine `80 calls · report 41m ago` çıkar (bir ajan 44 dakika boyunca `~2%` göstermişti). Raporlar artık yalnızca ajan talimatına bırakılmıyor, hook'larla zorlanıyor: her alt ajan rapor kuralıyla başlar (yeni `SubagentStart` hook'u, `scripts/subagent-start.sh`), rapor vermeden geçen her 10 araç çağrısında PostToolUse hook'u ajanın bağlamına bir hatırlatma ekler. Hatırlatmanın bir alt ajana ulaştığı dokümanın doğal okuması, canlıda doğrulanmadı.

## 0.8.0 (2026-10-27)
- Alt ajanların modeli, eforu ve token'ı artık Desktop uygulamasına, VS Code'a ve Windows terminallerine de ulaşıyor: mod, prompt'un üstünde tek bir durum satırı tutar (`scanner haiku-5.5·low 12.4k | implementer opus-5.5·medium 48.1k`), alt ajan bitince satır silinir. Efor, saver'ın sınırı uygulandıktan sonraki değerdir; token, ajanın son isteğinin context boyutudur. Geçen süre ve `~40%` ilerleme yalnızca shell panel satırında kalır.
- `CREW_CHIEF_ROW_MOD=auto|on|off`: `auto` (varsayılan) satırı terminal dışında bir yüzey varsa ya da terminalde panel satırı çizilemiyorsa (Windows, ya da `jq` yok; oturum başına bir kez `jq --version` çalıştırılır) gösterir; `on` her zaman, `off` hiçbir zaman. Düz terminalde `jq` varsa değişen bir şey yok.
- Durum: terminalde canlı denendi; VS Code için belgelenmiş (eklenti 2.1.299+), burada çalıştırılmadı; Desktop uygulamasında beklenen ama doğrulanmadı; Windows tasarım gereği (`jq` yok) ama bir Windows terminalinde çalıştırılmadı.

## 0.7.1 (2026-10-27)
- Tek seferlik skill teklifi artık proje haritasını da ([structure-map](https://github.com/aykyusuf/structure-map)) öneriyor: kurulu değilse ve git'te en az 60 dosyası olan her kod projesinde (`data/skill-catalog.json`'da yeni `minFiles` alanı). Kurallar aynı: bir kez sorulur, evet demeden bir şey kurulmaz, "Şimdi değil" bir hafta bekletir, "Hiç" hatırlanır.

## 0.7.0 (2026-10-27)
- Hiçbir eklenti sorusu artık sonsuza kadar beklemez: 20 dakika cevapsız kalan saver, advisor, compact, limit sıfırlanması ya da `/crew-tidy archive` sorusu güvenli cevabıyla cevaplanmış sayılır (*Şimdi değil*, *Bir hafta sonra hatırlat*, *Hayır*, *Vazgeç*; asla evet, asla *Bir daha sorma* değil) ve bir toast bunu söyler. Dakikayı `CREW_CHIEF_ASK_TIMEOUT_MIN` belirler (en çok 30; `off` eski beklemeyi korur). Mod yapabildiği yerde diyaloğu da kapatır; turn aralarında açılan bir soru ekranda kalabilir, o zaman ona geç tıklamak bir şey değiştirmez.
- Compact sorusu artık Claude'un turn'ünü açık tutmaz: `crew_compact_checkpoint` aracı yalnızca not alır ve hemen döner; sana turn bir cevapla bittikten ve session 10 saniye sessiz kaldıktan sonra (yeni prompt yok, model isteği yok, çalışan alt ajan yok) sorulur, yoksa bir sonraki böyle turn sonunda. Gece çalışmaya bırakılan uzun bir iş artık bu soruda durmaz.
- Claude'un kendi `AskUserQuestion` sorularına hiç dokunulmaz.

## 0.6.6 (2026-10-25)
- Saver'ın alt ajan effort'unu düşürmemesi düzeltildi: `turn.step` rewrite'ı (`high -> medium`) log'a yazılıyordu ama `/tasks` Opus ajanları hâlâ `high` gösteriyordu, çünkü ajanın kendi tanımındaki effort ondan güçlü (Claude Code 2.1.310'da görüldü). Saver açıkken `implementer-hard`, `reviewer` ya da Opus/Fable modeliyle çağrılan herhangi bir ajan için `Agent` çağrısı artık kendisi `effort: medium` taşıyor, yalnızca aşağı yönde (`low`/`medium` kalır, Sonnet ve Haiku ajanlarına dokunulmaz). `turn.step` tavanı ikinci hat olarak duruyor. Rewrite başarısız olursa çağrı olduğu gibi geçer.

## 0.6.5 (2026-10-25)
- Saver için tanılama: her alt ajan isteği debug log'a bir satır yazıyor (`saver: step agent=... model=... effort=... saver=...`, `claude --debug-file <yol>` ile görünür). Saver açıkken bir alt ajanın neden hâlâ `high` koşabildiğini bulmak için. Davranış değişmedi.

## 0.6.4 (2026-10-24)
- `/saver` birçok session'da "registered /saver but no command.run hook answered" hatası veriyordu; `/clear`, `/resume` ya da plugin yenilemesinden sonra mod komutu kendisine ait saymayıp susuyordu. Artık reddetmeden önce komut listesine bakıyor.

## 0.6.3 (2026-10-16)
- Compact önerileri artık gerçek bir molayı bekler: bir alt ajan çalışırken hiçbir şey önerilmez ve onaylanmış compact başlamaz; yalnızca cevapla biten turn faz sınırı sayılır (iptal, hata, ret sayılmaz). Arka planda açık bırakılan dev server ya da watcher beklenmez (başlattığı sunucuyu bekleyen `waiting` alt ajan da): soru onu gösterir ve özetleyiciye görev kimliğini ve komutunu koruması söylenir, çünkü compact'ten sonra Claude arka plan görevlerinin tutamaçlarını unutuyor (anthropics/claude-code#29193).
- Compact sorusu artık ne olduğunu söyler (`Şu an: çalışan alt ajan: 0, arka plan süreci: 2 (npm run dev, ...), commit'lenmemiş dosya: 3`). Alt ajanlar çalışırken `/crew-compact` bitince tekrar sormanı söyler.

## 0.6.2 (2026-10-15)
- Mod yine tek dosya: plugin'leri inceleyen dizin `$` ve `on`'u yalnızca aynı dosyada tanımlı bir fonksiyona geçirildiğinde kabul ediyor; bu yüzden `$` kullanan parçalar artık `hooks/src/` altında ve `tools/build_mod.py` bunları okunabilir `hooks/register.js` dosyasında birleştiriyor (CI güncel olduğunu ve `$`'ın başka dosyadaki bir fonksiyona geçirilmediğini kontrol eder). Davranış değişmedi.
- README'ye "Mod makinende ne yapar" bölümü eklendi: ne okuyor, çalıştırıyor, gönderiyor ve yazıyor, neden.

## 0.6.1 (2026-10-15)
- Devir dosyası olmayan projede compact akışı: evet dedikten sonra Claude önce bunları kurmayı teklif eder (`crew-handoff` skill'i, kendi önizleme ve onayıyla) ve konuşmada verdiğin kuralları Kısıtlar altına yazar; böylece compact'ten sonra geri basılabilirler. Reddedersen eskisi gibi dosyasız compact edilir.

## 0.6.0 (2026-10-15)
- Compact akışı: 250k token'ı geçince Claude'a doğal bir faz sınırında compact önermesi söylenir; araç sana sorar (400k'dan sonra turn aralarında yedek bir soru). Evet dersen Claude STATUS.md, tasks.json ve PROGRESS.md'yi günceller, compact STATUS.md değişene kadar bekler, sonra turn aralarında özetleyiciye ayrıntılı bir talimatla çalışır. Evet demeden hiçbir şey compact edilmez. `/crew-compact` elle başlatır; `CREW_CHIEF_COMPACT=off` kapatır.
- Önemli hiçbir şey kaybolmaz: talimat varsayılan başlıkların hepsini sayar, kurallarını kelimesi kelimesine kopyalar, başarısız ya da öldürülen süreçlerin çıktısını `UNCONFIRMED` işaretler; `/compact`'e ve otomatik compact'e de eklenir. Her compact'ten sonra yeni bir SessionStart hook'u (`scripts/compact-restore.sh`) sabitlediğin Kısıtlar'ı, Şu an'ı, Sıradaki'ni, Kararlar'ı, son başarısız denemeleri ve açık görevleri devir dosyalarından transcript yoluyla birlikte geri basar; ham özet kaydedilir ve sabitlediğin satırlara karşı kontrol edilir.
- Devir dosyalarına Kısıtlar bölümü eklendi (kuralların, kelimesi kelimesine). 150k token toast'ının yerini compact akışı aldı.
- Limit sıfırlanması: dolmaya yakın bir pencere sıfırlanınca toast; bir limit Claude'u gerçekten durdurunca sıfırlanma anında "continue" gönderme teklifi. `CREW_CHIEF_RESET=off`.
- `/crew-tidy`: Claude Code'un yüklediklerinin salt-okunur denetimi (şişkin CLAUDE.md ve MEMORY.md, bayat yollar, tekrarlar, büyük STATUS.md, MCP maliyeti); `/crew-tidy archive` 60 günden eski PROGRESS.md girdilerini sorduktan sonra arşive taşır. `/crew-report`: model ve rol bazında token ve maliyet, ayrıca öğrenilen bir prompt-cache-soğuma ipucu.
- Claude Code 2.1.300'de canlı doğrulandı: session.compact talimatı varsayılan prompt'a ekleniyor; klasik compact hook'ları plugin'in başlattığı compact için de tetikleniyor; SessionStart çıktısı modele ulaşıyor; transcript compact öncesi satırlarını koruyor. Plugin `claude -p`'de compact edemez. Claude Code 2.1.287+ ister (shell hook kendi başına çalışır).

## 0.5.0 (2026-10-13)
- Alt ajanlarda skill: `deep-reader`, `implementer`, `implementer-hard`, `reviewer` ve `ui-tester` artık skill yükleyebilir (`Skill` tool). Alt ajanlar skill listeni görmez; bu yüzden policy ana session'a brief'te skill adını yazmasını, `general-purpose` kullanırsa `model`'i açıkça vermesini söyler (yoksa ana modeli devralır).
- Raporlar dosyada: `deep-reader` ve `reviewer` `Write` alır ama read-only guard yalnızca `${TMPDIR:-/tmp}/crew-chief-reports/` altına yazdırır. ~40 satırı aşan rapor oraya yazılır, en fazla 15 satır özet ve yol döner; ana context küçük kalır. Geri kalan her şey hâlâ engelli: başka yollar, `Edit`, göreli yol, `..`, klasörden çıkan symlink (guard artık Write/Edit/NotebookEdit çağrılarını da kapsıyor).
- Skill hatırlatması: yeni UserPromptSubmit hook'u `scripts/skill-hint.sh` prompt'u `data/skill-catalog.json` ile eşleştirir (Türkçe ve İngilizce anahtar kelimeler); tercih edilen skill kuruluysa tek satır ekler: "önce X skill'ini yükle". Prompt başına en fazla iki, her iş türü session'da bir kez. Kendi iş türlerin: `~/.claude/crew-chief-skills.json`. `CREW_CHIEF_SKILL_HINTS=off` kapatır.
- Skill teklifi: yeni SessionStart hook'u `scripts/skill-offer.sh` stack'i tanır (Flutter, React/Next.js, SwiftUI, web UI, Supabase); tercih edilen skill kurulu değilse Claude bir kez, isteğe bağlı olarak, elle doğrulanmış skill'leri teklif eder (2026-10-13'te kontrol edildi: Flutter ekibinin `dart-flutter`'ı, Vercel `vercel-react-best-practices`, `swiftui-pro`, Anthropic `frontend-design`, Supabase `postgres-best-practices`). Kaynağı, tam komutu ve riskleri gösterir; evet demeden hiçbir şey kurmaz; çalışma anında talimat çeken ya da script çalıştıran skill'ler dışarıda. `CREW_CHIEF_SKILL_OFFER=off` kapatır.
- Rapor klasörü sana ait olmalı; `TMPDIR` sonundaki slash'a dikkat edilir. `/crew-setup`'ı yeniden çalıştırmak, `.claude/settings.json`'daki eski yalnızca-Bash guard kaydını genişletir; böylece projedeki `deep-reader` ve `reviewer` korunmuş kalır. Kapattığın plugin'lerin skill'leri kurulu sayılmaz. Yeni hook'lar `jq` gerektirir; yoksa hiçbir şey yapmazlar.

## 0.4.0 (2026-10-12)
- Panel satırı çalışan alt ajanlar için geçen süreyi (`· 4m12s`) gösterir; ajan rapor verdiyse yaklaşık yüzdeyi, o an yaptığı işi ve neden yavaş olduğunu da ekler: `implementer-hard  opus-5.5 · high · 232k · 4m12s · ~40%  Reading the auth module ⚠ slow test suite`.
- Yeni PostToolUse hook'u `scripts/progress-hook.sh` her alt ajan için `${TMPDIR:-/tmp}/crew-chief-progress/` altında küçük bir ilerleme dosyası tutar (12 saat sonra silinir). `deep-reader`, `implementer`, `implementer-hard`, `reviewer` ve `ui-tester` yaklaşık her 10 tool çağrısında `: 'crew-progress 40 | adım | gecikme'` diye tek satırlık rapor verir (turn limitine sayılan, etkisiz bir Bash çağrısı). Yüzde ajanın kendi tahminidir. 45 sn ve üstü süren tool çağrısı gecikme notunu kendisi ekler. `jq` gerekir.
- Read-only guard, read-only ajanların ilerleme raporuna izin verir.
- Claude Code 2.1.296'da doğrulandı: panel satırındaki task `id`, hook'taki `agent_id` ile aynı; satır birkaç saniyede bir yenileniyor.

## 0.3.3 (2026-10-11)
- Panel satırı düzeltildi: Claude Code, plugin `settings.json`'ındaki `subagentStatusLine`'ı okuyor ama panele uygulamıyor (aynı komut kullanıcının `settings.json`'ından çalışıyor). Kurulum ya da güncellemeden sonraki ilk session'da `scripts/install-row.sh` satır script'ini `~/.claude/` altına kopyalar ve anahtarı senin `settings.json` dosyana ekler. Kendi `subagentStatusLine`'ına dokunmaz, bir kez kurar (sildiğin anahtarı geri eklemez), yedek alır, `jq` gerekir. `CREW_CHIEF_ROW=off` kapatır.

## 0.3.2 (2026-10-11)
- `deep-reader` artık web'de arama yapıp sayfa çekebiliyor (WebSearch, WebFetch); tek ajan kodu güncel vendor dokümanları, paket sayfaları ya da tasarım rehberleriyle birlikte okuyabilir. Hâlâ read-only: raporu metin olarak döndürür, dosyaya çağıran yazar.
- Turn limitleri: `implementer-hard` 80 -> 120, `reviewer` 60 -> 80. Ajanlar kalan turn'ü göremedikleri için kendi tool çağrılarını sayar, limitin yaklaşık %70'inde yeni iş açmayıp raporlar. Reviewer bulguları biriktirir ve ulaşamadığı yeri `not reviewed` diye işaretler; artık raporsuz durmaz.
- Implementer'lar arka plandaki test koşusunu beklemek yerine build/test'i ön planda, sınırlı çıktıyla çalıştırır; `implementer-hard`, brief ilerleme dosyası belirtirse oraya checkpoint yazar.
- Reviewer: Important yalnızca doğruluk hataları ve karşılanmayan gereksinimler için; sağlam bir değişiklik şişirilmiş bulgular yerine `No blocking issues` alır.
- Routing: paralel implementer'lara ayrık dosyalar verilir (worktree yalnızca son çare); büyük çok-dosyalı iş 2-3 bağımsız parçaya bölünür; duran (partial) ajan baştan başlatılmaz, SendMessage ile devam ettirilir.

## 0.3.1 (2026-10-09)
- Advisor teklifi: `/advisor` kapalıysa tasarruf modu, ilk biten turdan sonra faydasını bir kez anlatır ve "evet" denirse `/advisor`'ı senin yerine çalıştırır. `CREW_CHIEF_ADVISOR_OFFER=off` kapatır.
- "Bir hafta sonra hatırlat" ve "hiç" cevaplarını hatırlar; advisor'ı olmayan bulut yollarında sormaz; ana model Opus/Fable ise "ikinci görüş" der.
- Reddedilen `/advisor` (politika, Fable kullanım kredisi) tekrarlanmaz; toast nedenini görmek için `/advisor` çalıştırmanı söyler.

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
