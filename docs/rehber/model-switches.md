# Model değişimi

Oturumun modelini değiştirmek ne zaman önce sorar ve yeni modele ne söylenir.

[← README](../../README.tr.md) · [English](../guide/model-switches.md)

Oturumun modelini değiştirmek (`/model`, seçici) yalnızca gerçek bir bedeli varsa önce sorar: Fable'dan çıkış (diğer modeller Fable'ın düşünmesini okuyamaz, işin arkasındaki akıl yürütme kaybolur) ya da yeni modelde yeniden yazılması yaklaşık 1 USD ya da daha fazla tutacak sıcak bir prompt cache (soru token'ları ve fiyatı söyler, önce handoff dosyalarını güncellemeyi ya da `/compact`'i önerir). Geçişten sonra yeni model tek bir not alır: Fable'dan çıkışta planı yeniden kurması, daha pahalı modelde bağlamı yalın tutması. `CREW_CHIEF_MODEL_SWITCH=off` kapatır. Compaction'lar crew-chief'in brief'ini zaten mod üzerinden alıyor, ayrı bir PreCompact hook'u yok.
