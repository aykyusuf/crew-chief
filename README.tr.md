# Crew Chief

**Claude Code için zorluğa göre alt ajan yönlendirme.** Crew Chief bir Claude Code plugin'idir. Ana oturumun modelini ve eforunu sen seçersin; sonra Claude her işte neyi kendisi yapacağına, neyi daha ucuz ya da daha güçlü bir alt ajana hangi eforla vereceğine kendisi karar verir. Bir seviye takılırsa bir üstüne çıkar, senin geçersiz kılma komutlarına uyar. Bu çekirdeğin çevresinde korumalar (okuyan ajanlar için salt-okuma koruması, tehlikeli komutlar için komut koruması), token tasarrufu, önemli hiçbir şeyi kaybettirmeyen bir compact akışı, oturum devir dosyaları, tasarım skill'leri zorunlu UI işi, gece modu, kaynaklı araştırma ve güvenlik incelemesi gelir.

[English README](README.md)

```
you ──▶ main session (your model/effort) ──┬─ does interactive, coupled, quick work itself
                                           ├─▶ scanner          haiku  / low     lookups, noisy logs
                                           ├─▶ deep-reader      sonnet / medium  multi-file analysis, web research
                                           ├─▶ mechanic         haiku  / low     rote edits with a verify command
                                           ├─▶ implementer      sonnet / medium  well-specified edits
                                           ├─▶ planner          opus   / medium  read-only plan before a big change
                                           ├─▶ implementer-hard opus   / medium  hard, multi-module work
                                           ├─▶ ui-designer      opus   / high    read-only design spec for big UI work
                                           ├─▶ ui-implementer   sonnet / medium  UI code, design skills preloaded (model/effort per call)
                                           ├─▶ ui-scout         sonnet / medium  design references: live sites + galleries, screenshots
                                           ├─▶ ui-smoke         haiku  / low     quick read-only UI check
                                           ├─▶ ui-tester        sonnet / medium  browser/emulator flows
                                           ├─▶ verifier         sonnet / high    checks done_when or a claim, tries to refute it
                                           ├─▶ critic           opus   / medium  strict rubric grade for visual/quality results
                                           ├─▶ researcher       sonnet / medium  web research, claims with URL + quote
                                           ├─▶ security-reviewer opus  / medium  security review at a trust boundary
                                           └─▶ reviewer         opus   / medium  independent review
```

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

Üçüncü taraf marketplace'ler varsayılan olarak **otomatik güncellenmez**; bir kez aç: `/plugin` → **Marketplaces** → `crew-chief` → **Enable auto-update**. Elle güncellemek için: `claude plugin update crew-chief@crew-chief`. Güncelleme, zaten açık olan oturumu değiştirmez: o oturumda `/reload-plugins` çalıştır. Ayrıntılar ve "ne yeni" bildirimi: [Güncelleme](docs/rehber/updating.md).

## Neden

Hazır haliyle her alt ajan, işin kolay ya da zor olmasına bakmadan kendisine verilen model ve eforla çalışır. Claude Code artık ana oturumun her alt ajan çağrısında `model` ve `effort` vermesine izin veriyor (2.1.292+), ama bunları ne zaman kullanacağına birinin karar vermesi gerekir. Crew Chief bu karar katmanı ve yönlendirdiği seviyelerdir:

- **Her oturumda aktif yönlendirme politikası.** Açılışta, `/clear` sonrasında ve sıkıştırmadan sonra bağlama eklenir.
- **Yükselme merdiveni.** Aynı seviyeyi tekrar denemek yerine `implementer` → `implementer-hard` → ana oturum sırasıyla bir üste çıkar.
- **Salt-okuma bekçisi.** Okuyan ajanların dosya yazmasını, git'e yazmasını ve paket kurmasını engelleyen bir hook. İzinleri kapatsan da çalışır.
- **Doğal dilde geçersiz kılma** ve **tutan solo:** `/crew-chief:crew-mode solo` bir hook ile Agent aracını engeller.

## Kullanım

Yapacağın bir şey yok: oturumu aç, model ve eforu her zamanki gibi seç, çalış. Crew Chief'in politikası Claude'a ne zaman devredeceğini söyler.

| Sen dersin | Olan |
|---|---|
| *(hiçbir şey)* | `auto`: zorluğa göre yönlendirme |
| "tek başına yap", "alt ajan kullanma" | `solo`: her şeyi ana oturum yapar |
| "ajanları kullan", "dağıt" | `delegate`: bağımsız parçalar paralel olarak seviyelere gider |
| "testleri Haiku'ya ver", "bunu Sonnet medium yapsın" | Alt ajan tam o model ve eforla açılır |
| `@agent-crew-chief:implementer-hard ...` | O ajan kesin çağrılır |

## Özellikler

Her satır kendi rehber sayfasına bağlanır.

| Özellik | Ne yapar | Komut | Rehber |
|---|---|---|---|
| Yönlendirme ve ajanlar | Claude işi zorluğa göre seviyeli alt ajanlara devreder, takılan seviyeyi yükseltir, geçersiz kılmalara uyar ("tek başına yap", "ajanları kullan") | `/crew-chief:crew-mode auto\|solo\|delegate\|status` | [Yönlendirme ve ajanlar](docs/rehber/routing.md) |
| Brief | Yönetici sensin: Claude seni dinler ve tek bir onaylı brief yazar (amaç, kısıtlar, başarı ölçütleri, karar yetkileri) | `/crew-chief:crew-brief` | [Brief](docs/rehber/brief.md) |
| Token tasarrufu | 5 saatlik limitin %70/80/90'ında (haftalıkta %50/75/85/90) alt ajan effort'unu sınırlayıp sınırlamayacağını sorar; ultra tasarruf daha sıkıdır | `/saver on\|off\|status\|ultra` | [Token tasarrufu](docs/rehber/token-saver.md) |
| Ayarlar | crew-chief'in kullandığı tüm sayılar, ortam değişkeni gerektirmeden senin elinde | `/crew-config` | [Ayarlar](docs/rehber/settings.md) |
| Compact akışı | Claude faz sınırında compact önerir; önce devir dosyaları güncellenir, sonra sabitlediğin kurallar geri basılır | `/crew-compact` | [Compact akışı](docs/rehber/compact.md) |
| Limit sıfırlanması, denetim, rapor | Bir limit sıfırlanınca toast ve "continue" teklifi; context'te neyin şişkin ya da bayat olduğu; model bazında token ve maliyet | `/crew-tidy`, `/crew-report` | [Limit sıfırlanması ve denetim](docs/rehber/limits-and-audit.md) |
| Komut koruması | Tehlikeli komutlardan ve üretim sunucularıyla ilk temastan önce durdurur ya da uyarır (hız kesici, güvenlik sınırı değil) | `/crew-guard` | [Komut koruması](docs/rehber/guard.md) |
| Oturum devri | Yeni oturum öncekinin bıraktığı yerden devam etsin diye üç küçük dosya (`STATUS.md`, `tasks.json`, `PROGRESS.md`) | `/crew-chief:crew-handoff` | [Oturum devri](docs/rehber/handoff.md) |
| UI işi | Arayüz işi tasarım skill'leri, UI profili, referanslar, kapılar ve görsel öz-kontrolle `ui-implementer`'a gider; varsayılan görünüm yasak | | [UI işi](docs/rehber/ui.md) |
| Gece modu | Claude, sen uyurken belirlediğin saate kadar sert sınırlar içinde (push yok, deploy yok) çalışır ve sabaha bir rapor bırakır | `/crew-chief:crew-night` | [Gece modu](docs/rehber/night.md) |
| Araştırma | Erişim tarihi ve birebir alıntı taşıyan, alıntısı kaynak sayfada kontrol edilen iddialar | `/crew-chief:crew-research`, `/crew-chief:crew-lint` | [Araştırma](docs/rehber/research.md) |
| Güvenlik incelemesi | Salt-okunur `security-reviewer`, risk haritası, commit kapısı ve commit öncesi doğrulama kapısı | `/crew-chief:security` | [Güvenlik incelemesi](docs/rehber/security.md) |
| Raporlar ve skill'ler | Uzun raporlar dosyaya gider; ajanlar skill yükler; işe uyan bir skill için hatırlatma ve bir kezlik teklif | | [Raporlar ve skill'ler](docs/rehber/skills-and-reports.md) |
| Panel satırı ve durum satırı | Her alt ajanın modeli, eforu, token'ı, süresi ve ilerlemesi prompt'un altında ve bir durum satırında | | [Panel satırı ve durum satırı](docs/rehber/panel.md) |
| crew-ui band ve paneller | Prompt'un üstünde sessiz bir band, düğme olarak sorular, ajan panelleri ve bitiş bildirimleri | `/crew-ui`, `/crew-agents`, `/crew-panel` | [crew-ui](docs/rehber/crew-ui.md) |
| Performans modu | Band'ın hareketli resimlerini ve bir temanın animasyonunu durdurur | `/crew-perf` | [Performans modu](docs/rehber/performance.md) |
| Advisor teklifi | Deneysel `/advisor`'ı açmak için bir kezlik teklif | `/advisor` | [Advisor teklifi](docs/rehber/advisor.md) |
| Model değişimi | Oturumun modelini değiştirmek gerçek bir bedel getirecekse önce sorar | | [Model değişimi](docs/rehber/model-switches.md) |
| Hook'lar ve script'ler | Plugin'in getirdiği her hook ve script: ne zaman çalışır, ne yapar | | [Ne çalıştırır](docs/rehber/hooks.md) |

Bazı davranışlar yalnızca birim testleriyle kapsanıyor, canlıda henüz görülmedi; her rehber sayfası hangisi olduğunu söyler. Bir seviyenin modelini ya da eforunu değiştirmek için projende aynı adla `.claude/agents/<ad>.md` dosyası aç: proje ajanı plugin ajanının önüne geçer ve güncellemeler onu ezmez.

## Gizlilik

Crew Chief veri toplamaz ve göndermez: hook'ları yerelde çalışır, metin ya da çıkış kodu basar; mod da ağa erişmez. Telemetri yok. İki istisna var, ikisi de yalnızca kullandığında: pakete dahil theSVG skill'i ajanın ikonları cdn.jsdelivr.net'ten çekmesini sağlar; bir araştırma koşusu (`/crew-chief:crew-research`, `/crew-chief:crew-lint`) alıntıları kontrol etmek için araştırmacıların gösterdiği sayfaları açar (`scripts/source-check.mjs`: yalnız okuma, proje verisi göndermez, özel ve loopback adresleri reddeder, sayfa metnini yazdırmaz). Saklananlar kendi makinende `~/.claude/plugins/data/<plugin>/` altında kalır (tekliflere verdiğin cevaplar, küçük işaretler, compact özetleri) ve plugin'i kaldırınca Claude Code bu klasörü siler; ilerleme dosyaları ve uzun raporlar geçici klasöründe durur. Plugin projene yalnızca sen evet dediğinde yazar; kendi deposu dışında yalnızca `~/.claude/settings.json` (panel satırı, bir kez) ve `~/.claude/crew-chief-guard.json` (varsayılan koruma ayarı, bir kez) dosyalarına yazar. Tam liste: [Gizlilik](docs/rehber/privacy.md). Hata bildirimleri [GitHub issues](https://github.com/aykyusuf/crew-chief/issues) üzerinden.

## Geliştirme

```bash
claude --plugin-dir .                      # bu checkout'u tek oturum için yükle
node --test tests/*.test.mjs               # mantık testleri (düz Node)
for t in tests/test_*.py; do python3 $t; done   # hook ve script testleri
claude plugin test                         # modun hook'ları, stub'larla (oturum yok, ağ yok)
python3 tools/build_mod.py                 # hooks/register.js'i hooks/src/'den yeniden üret (--check ile doğrula)
python3 tools/build_assets.py              # skills/crew-setup/assets'i yeniden üret (--check ile doğrula)
claude plugin validate . --strict          # marketplace manifest'i
```

Tüm test komutları, davranış eval'leri ve görev başına maliyet karşılaştırması: [Geliştirme](docs/rehber/develop.md) (komutlar Türkçe, eval ayrıntıları İngilizce sayfada).

## Lisans

MIT

Eklentinin kendi kodu MIT. `skills/` altında, her biri kendi lisansıyla, üçüncü taraf agent skill'lerinin (UI, hareket, güvenlik) sabit sürümlü kopyalarını içerir: bkz. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
