# Brief: `/crew-chief:crew-brief`

Yönetici sensin: Claude seni dinler ve bir proje ya da özellik için tek bir onaylı brief yazar.

[← README](../../README.tr.md) · [English](../guide/brief.md)

`/crew-chief:crew-brief` seni yönetici yapar. Yönetici sensin. Claude seni birkaç gruplu soruyla (önerilen seçenek önce) dinler ve tek bir brief yazar: amaç ve neden, kapsam dışı, yapım sırası, kısıtların kelimesi kelimesine, kontrol edilebilir başarı ölçütleri, kalite çıtası ve karar yetkileri (ajanlar neyi tek başına karar verir, neyi bekletir, sensiz neyi asla yapmaz). Proje briefi `BRIEF.md`, özellik briefi `docs/briefs/<slug>.md`. Tek onaydan sonra kısıtların `STATUS.md`'ye gider, her başarı ölçütü bir `tasks.json` görevi olur ve her alt ajan brief'i karar yetkilerini taşır. Yalnızca ana oturumda çalışır; diğer brainstorming skill'lerinden bağımsızdır (biri ya da öteki). Yeni proje ya da özellik isteyen prompt'ta kapanışta tek satırlık teklif gelir: proje başına bir kez, brief varsa hiç.
