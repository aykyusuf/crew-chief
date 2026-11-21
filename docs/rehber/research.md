# Araştırma: `/crew-chief:crew-research`

Kaynaklı, alıntısı kontrol edilmiş iddialarla araştırma koşuları ve `/crew-chief:crew-lint`.

[← README](../../README.tr.md) · [English](../guide/research.md)

Güncel kaynak gerektiren bir soru araştırma koşusuna gider. Claude önce modu sorar:
- **ekonomik:** 1-3 `researcher` ajanı (Sonnet, web erişimli) artı tek doğrulama (alıntı kontrolü ve bir `verifier`), en fazla 4 ajan.
- **tam:** plugin'in iki workflow'u: `research-sweep` (paralel en fazla 8 araştırmacı grubu), sonra `research-verify` (her 8 iddiaya bir `verifier`, her 2 gruba bir karşı kanıt ajanı, bir raporcu). Öncesinde `scripts/research-cost.mjs` ajan sayısını ve token aralığını gösterir, önce tek gruplu bir deneme önerir. Workflow kapalıysa (ya da gece, Workflow aracı reddedildiği için) aynı adımlar normal ajanlarla çalışır ve Claude bunu söyler.

Her iddia bir URL, erişim tarihi ve birebir alıntı taşır. `scripts/source-check.mjs` her kaynak sayfayı açıp alıntının orada olup olmadığına bakar (`found`, `not_found`, `dead_link`, `unverified`; okuyamadığı sayfa asla çürütme sayılmaz). Alıntı kontrolü ile doğrulayıcı çelişirse iddia bir kez Opus medium'da yeniden kontrol edilir; yine çelişirse doğrulanamadı diye raporlanır. Çekilen sayfalar veridir, asla talimat değildir.

`/crew-chief:crew-lint` iki aracı daha elle çalıştırır: `scripts/stale-scan.mjs` `CLAUDE.md`, memory ve ajan dosyalarında eskimiş talimatları bulur ("her zaman delege et", token bütçesi sayıları, mutlak "asla" satırları) ve düzeltme önerir; `scripts/brief-check.mjs` bir araştırma ya da ajan brief'inde eksik olanları listeler (durma kuralı, doğrulama, çıktı yolu, kapsam sınırı). İkisi de senin onayın olmadan dosya değiştirmez. Henüz canlı görülmedi.
