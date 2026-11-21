# Advisor teklifi

Claude'un daha güçlü bir modele danışmasını sağlayan deneysel `/advisor` için bir kezlik teklif.

[← README](../../README.tr.md) · [English](../guide/advisor.md)

`/advisor` (deneysel, sadece Anthropic API) Claude'un zor anlarda (yaklaşım seçmeden önce, takılınca, bitirmeden önce) daha güçlü bir modele danışmasını sağlar. Alt ajanlar da miras alır: Sonnet `implementer` durup `implementer-hard` olarak yeniden koşmak yerine Opus'a danışabilir. Anthropic'in kendi ölçümünde Sonnet ve Opus ikilisi görevleri yaklaşık %12 daha ucuza ve biraz daha iyi bitirdi; her danışma advisor modelinin fiyatından faturalanır.

Advisor kapalıysa mod bunu **bir kez** önerir: session'ın ilk biten turundan sonra (açılışta ve saver sorusunun üstüne asla):
- **Ana model Sonnet/Haiku:** "zor anlarda Opus'a danışır". **Ana model Opus/Fable:** metin "ikinci bir Opus (Fable) planı gözden geçirir" olur, ek maliyetli bağımsız bir kontrol.
- **Cevaplar:** *Aç* `/advisor opus` (Fable için `/advisor fable`) komutunu senin yerine çalıştırır; bu, komutu kendin yazmış gibi `advisorModel`'i kullanıcı ayarına kaydeder ve bir toast ile söyler. Ayar görünmezse (bir politika, Fable kullanım kredisinin açık olmaması) toast nedenini görmek için `/advisor` çalıştırmanı söyler ve teklif tekrarlanmaz. *Bir hafta sonra hatırlat* ve *Bir daha sorma* plugin'in deposunda hatırlanır. Diyaloğu kapatırsan hiçbir şey hatırlanmaz.
- **Hiç sorulmaz:** `advisorModel` zaten ayarlıysa, Bedrock/Vertex/Foundry gibi bulut yollarında, `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` varsa, `/advisor` komutu yoksa, ana model bilinmiyorsa, `claude -p`'de ya da bir kez "Aç" dedikten sonra (sonradan `/advisor off` dersen geri gelmez).
- `CREW_CHIEF_ADVISOR_OFFER=off` teklifi tamamen kapatır.
