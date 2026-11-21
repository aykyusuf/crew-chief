# Yönlendirme ve ajanlar

Crew Chief'in bir işi kimin yapacağına (ana oturum ya da seviyeli bir alt ajan) nasıl karar verdiği, hangi ajanların olduğu ve bunu nasıl geçersiz kılacağın.

[← README](../../README.tr.md) · [English](../guide/routing.md)

**Claude Code için zorluğa göre alt ajan yönlendirme.** Ana oturumun modelini ve eforunu sen seçersin. Sonra Claude her işte neyi kendisi yapacağına, neyi daha ucuz ya da daha güçlü bir alt ajana hangi eforla vereceğine kendisi karar verir. Bir seviye takılırsa bir üstüne çıkar, senin geçersiz kılma komutlarına uyar.

## Ajanlar

- `scanner` (Haiku/low): arama ve uzun log süzme.
- `deep-reader` (Sonnet/medium): birden çok dosyayı birlikte inceleme.
- `mechanic` (Haiku/low): adlandırılmış dosyalarda, doğrulama komutu olan mekanik düzenleme (yeniden adlandırma, aynı satırı çok dosyaya ekleme).
- `implementer` (Sonnet/medium): kapsamı net kod değişikliği.
- `planner` (Opus/medium): salt-okunur plan; büyük bir değişiklikten önce dosyalar, sıra, riskler ve komutla kontrol edilebilir bir bitiş koşulu.
- `implementer-hard` (Opus/medium): zor ve çok modüllü iş.
- `ui-designer` (Opus/high): büyük UI işi (3+ ekran, yeni site, yeniden tasarım) için salt-okunur tasarım spec'i; `.crew-chief/design/<slug>.md` dosyasına yazar, kod yazmaz. Ayrıntı: [UI işi](ui.md).
- `ui-implementer` (Sonnet/medium varsayılan; model ve effort her çağrıda verilir): arayüz kodu; tasarım skill'leri hazır yüklü gelir, projenin UI profiline uyar. Ayrıntı: [UI işi](ui.md).
- `ui-scout` (Sonnet/medium): tasarım referansı bulur; alan notları çıkarır, 3-4 canlı site ve açık galeri bulur, bakar, ekran görüntülerini ve `REFS.md`'yi yalnızca `.crew-chief/refs/` altına yazar; kod yazmaz. Ayrıntı: [UI işi](ui.md).
- `ui-smoke` (Haiku/low): sayfa/ekran açık mı, metin var mı, hata var mı; sadece okur.
- `ui-tester` (Sonnet/medium): tarayıcı, emülatör ve simülatörde çok adımlı test; ekran görüntüleri ana sohbeti şişirmez.
- `verifier` (Sonnet/high): `done_when` koşulunu ya da bir iddiayı kontrol eder ve çürütmeye çalışır.
- `critic` (Opus/medium): görsel ve kalite sonuçları için sıkı bir rubrikle not verir.
- `reviewer` (Opus/medium): bağımsız inceleme.
- `researcher` (Sonnet/medium, web erişimli) ve `security-reviewer` (Opus/medium): bkz. [Araştırma: `/crew-chief:crew-research`](research.md) ve [Güvenlik incelemesi](security.md#güvenlik-incelemesi).

## Ne getirir

- **Her oturumda aktif yönlendirme politikası.** Açılışta, `/clear` sonrasında ve sıkıştırmadan sonra bağlama eklenir.
- **Yükselme merdiveni.** Aynı seviyeyi tekrar denemek yerine `implementer` → `implementer-hard` → ana oturum sırasıyla bir üste çıkar.
- **Salt-okuma bekçisi.** Okuyan ajanların dosya yazmasını, git'e yazmasını ve paket kurmasını engelleyen bir hook. İzinleri kapatsan da çalışır.
- **Doğal dilde geçersiz kılma.** "tek başına yap", "ajanları kullan", "bunu Sonnet medium'a ver" ya da `/crew-chief:crew-mode solo`.
- **Kim hangi modelde, görürsün.** Prompt'un altındaki ajan listesinde her alt ajanın modeli ve eforu yazar: `ui-tester  sonnet-5.5 · medium · 41.2k  Checking the login flow` (`jq` gerekir). Ayrıntı: [Panel satırı ve durum satırı](panel.md#panel-satırı-ve-ilerleme).
- **`/crew-chief:crew-brief`.** Yönetici sensin: Claude seni dinler ve tek bir onaylı brief yazar. Ayrıntı: [Brief](brief.md).
- **Oturum devri, proje başına bir kez önerilir.** Üç küçük dosya (durum, iş listesi, ilerleme günlüğü) sayesinde yeni oturum, öncekinin bıraktığı yerden devam eder. Ayrıntı: [Oturum devri](handoff.md).
- **Önemli hiçbir şeyi kaybettirmeyen compact, yalnızca senin onayınla.** Faz sınırında Claude önerir, sen cevaplarsın, önce devir dosyaları güncellenir, sonra konuşma ayrıntılı bir talimatla compact edilir; sabitlediğin kurallar ve açık görevler dosyalardan geri basılır. Ayrıntı: [Compact akışı](compact.md).
- **Limit sıfırlanması ve `continue`.** Dolmaya yakın bir limit sıfırlanınca toast; bir limit Claude'u gerçekten durdurunca, sıfırlanma anında "continue" gönderilsin mi diye sorar. Ayrıntı: [Limit sıfırlanması](limits-and-audit.md#limit-sıfırlanması).
- **`/crew-tidy` ve `/crew-report`.** Context'indeki şişkin, bayat ya da tekrarlı olanları gösterir (onaylayacağın arşiv taşıması dışında hiçbir şey değişmez); model ve ana/alt ajan bazında token ve maliyet. Ayrıntı: [Context denetimi ve rapor](limits-and-audit.md#context-denetimi-ve-rapor).
- **UI işinde tasarım skill'leri zorunlu.** Arayüz kuran ya da yeniden biçimlendiren iş `ui-implementer`'a gider; o, tasarım skill'lerini yüklü alır, projenin UI profiline uyar ve Claude'un varsayılan görünümünü basmaz. Ayrıntı: [UI işi](ui.md).
- **Mekanizma rehberi.** Fork, Monitor, `/loop`, `/goal`, workflow, agent team ve routine'den hangisinin ne zaman kullanılacağını anlatır.
- **Solo seçeneği tutar.** `/crew-chief:crew-mode solo` yalnızca prompt'ta istenmez, Agent aracını engelleyen bir hook ile zorlanır.

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

## Yönlendirme nasıl karar verir

İşi yalnızca kendi içinde kapalıysa **ve** paralel çalışabiliyorsa, ana bağlamı dolduracaksa ya da daha ucuz bir seviye aynı kalitede yapabiliyorsa devret. Yoksa ana oturum yapar. Çoklu ajan kurulumları tek bir oturumun birkaç katı token harcar ve kodlama işinin çoğu sıkı bağlıdır; bu yüzden varsayılan işi kendin yapmaya yatar. Zorluk tahmin edilmez, görünenden okunur (kapsam, kontrol var mı, belirsizlik, kök neden biliniyor mu, etki alanı). Bir alt ajan başarısız olursa önce teşhis edilir, sonra yükseltilir: dikkatsizlik effort'u, yetersizlik modeli yükseltir. Yükseltme kanıta da bağlıdır (kontrol çalışmadı, brief dışında dosya değişti, `maxTurns` doldu); iş yarıda zorlaşırsa yönlendirilebilir, durdurulabilir ya da daha güçlü bir modelle sürdürülebilir. İsteğe bağlı [advisor](../../skills/crew-routing/references/model-and-effort.md) (`/advisor`, deneysel) daha ucuz bir ajanın daha güçlü bir modele kendisi danışmasını sağlar.

Tam politika [skills/crew-routing/SKILL.md](../../skills/crew-routing/SKILL.md) içinde; [mekanizmalar](../../skills/crew-routing/references/mechanisms.md) ve [model ve effort](../../skills/crew-routing/references/model-and-effort.md) başvuruları resmi Claude Code belgelerinden özetlendi (İngilizce).
