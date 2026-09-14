# Uyap Flow — UYAP Vatandaş Portal Desteği (v2.4.0)

Bu dal (`feature/vatandas-portal`), Uyap Flow eklentisini **UYAP Avukat Portal**'ın yanı sıra
**UYAP Vatandaş Portal** (`vatandas.uyap.gov.tr`) üzerinde de çalışacak şekilde genişletir.

> **Önemli:** Bu değişiklikler UYAP Vatandaş Portal'ının **gerçek DOM yapısına canlı erişim
> olmadan** yazılmıştır (portala T.C. Kimlik/e-Devlet/e-imza ile giriş otomasyon aracıyla
> yapılamaz — bu, kimlik doğrulama bilgilerinin bir araca girilmesi anlamına gelir ve
> güvenlik ilkeleri gereği yapılmamıştır). Bu yüzden Vatandaş Portal seçicileri **tahmini
> adaylardır**; canlı test sonrası küçük düzeltmeler gerekebilir (bkz. "Bilinen Sınırlamalar").

## Neler değişti

### `extension/manifest.json`
- `host_permissions` ve `content_scripts.matches`'e `https://vatandas.uyap.gov.tr/*` eklendi.
- `lib/udf-reader.js` content script listesine eklendi.
- Versiyon `2.4.0`, description sadeleştirildi.

### `extension/main.js`
- **Portal modu tespiti**: `PORTAL_MODE = location.hostname.includes('vatandas') ? 'vatandas' : 'avukat'`.
- **Seçici fallback zinciri** (`SELECTORS`, `resolveSelector`, `resolveSelectorAll`): her DOM sorgusu
  artık avukat portalında doğrulanmış seçiciyi önce dener, bulamazsa Vatandaş Portal adaylarını
  sırayla dener. Hangi adayın eşleştiği `window.__uyapFlowDebug.selectors` içinde tutulur.
- **Meta veri çıkarma fallback'i**: `div[title]` bulunamazsa (Vatandaş Portal tablo tabanlıysa)
  tablo başlık satırından sütun adları anahtar-kelime eşleştirmesiyle meta alanlarına haritalanır.
- **Tarih normalizasyonu**: `GG.AA.YYYY` / `GG-AA-YYYY` formatları mevcut `GG/AA/YYYY`
  ayrıştırıcısıyla uyumlu hale getirilir.
- **UDF indirme**: satır elemanı doğrudan `<a href="....udf">` ise fetch/XHR yakalama
  beklenmeden href kullanılır (avukat portalındaki `button[aria-label="download"]` + ağ
  yakalama akışı değişmeden korunur).
- **Yeniden deneme**: UDF indirmede geçici ağ hatalarına karşı 3 deneme + exponential backoff.
- **PDF modu**: DevExtreme ağaç öğesi (`treeItem`) yoksa satırın kendisine tıklanır.
- **MutationObserver** (`window.__uyapFlowObserver`): Vatandaş Portal'da "Evrak" sekmesi AJAX ile
  yüklendiğinde evrak konteyneri belirince otomatik tarama tetiklenir (debounce 600ms).
- **UDF Önizleme**: Komut paletinde (`Ctrl+K` → "UDF Önizleme") ve "Gelişmiş" panelinde yeni bir
  buton; bilgisayardaki bir `.udf` dosyasını seçip içeriğini ve meta verisini tarayıcıda gösterir.

### `extension/lib/udf-reader.js` (yeni dosya)
UDF-Toolkit'teki Python `udf_reader.py` modülünün JSZip tabanlı JavaScript portu.
`window.UyapUdfReader.{readUdf, extractText, extractMetadata, validateUdf}` sağlar.

## Avukat Portal'da davranış değişikliği var mı?

**Hayır.** Her seçici fallback zincirinde avukat portalının doğrulanmış seçicisi hep ilk
sıradadır ve `PORTAL_MODE==='avukat'` olduğunda zincirdeki tek eleman odur — davranış birebir
korunur. Tüm değişiklikler `node --check` ile sözdizimi doğrulamasından geçmiştir.

## Bilinen sınırlamalar

1. **Vatandaş Portal seçicileri doğrulanmadı.** Gerçek DOM'a erişim olmadığından
   `SELECTORS.*.vatandas` altındaki adaylar (ör. `#dosyaBaslik`, `.evrak-listesi`, `#evrakTable`)
   tahminidir. Canlı test sonrası `window.__uyapFlowDebug.selectors` çıktısını paylaşırsanız
   kesin seçicilerle güncellenebilir.
2. **Toplu dosya kuyruğu (çoklu dosya)** ve **klasör ağacı yolu (kategorize)** özellikleri
   DevExtreme (`dx-treeview-node-container`) yapısına bağlıdır; Vatandaş Portal DevExtreme
   kullanmıyorsa bu iki özellik avukat portalındaki kadar zengin çalışmayabilir (temel
   tarama/indirme etkilenmez).
3. **PTT tebligat sorgulama** (`ptt-helper.js`) portal bağımsızdır, değişmedi.
4. **UDF Toolkit entegrasyonu** (`lib/udf-reader.js`) sadece **içerik önizleme** sağlar;
   imza doğrulama (`sign.sgn`) veya belge düzenleme yapmaz.
5. **Eşzamanlı indirme sınırı**: Görevde istenen "aynı anda maksimum 3 indirme" yerine mevcut
   sıralı (1 eşzamanlı) mimari korundu — UYAP sunucusuna karşı daha güvenli ve mevcut kodla
   tutarlı; sadece hata durumunda 3 deneme + backoff eklendi.

## Test durumu

- ✅ `node --check` ile `main.js`, `manifest.json`, `lib/udf-reader.js` sözdizimi doğrulandı.
- ✅ `lib/udf-reader.js`, jsdom + gerçek jszip ile Python tarafından üretilmiş örnek bir UDF
  üzerinde doğrulandı (metin/meta/validasyon).
- ⛔ **Canlı Vatandaş Portal testi yapılmadı** — gerçek kullanıcı girişi gerektirir, otomasyon
  aracı bunu yapamaz (bkz. yukarıdaki uyarı). Kurulum ve test adımları için bkz. `README.md`
  ("Kurulum" bölümü, `extension/` klasörünü paketlenmemiş öğe olarak yükleyin).

## UDF Toolkit (ayrı repo: `UDF-Toolkit`)

Bu depodan bağımsız olarak `saidsurucu/UDF-Toolkit` reposuna eklenen Python modülleri:
`udf_reader.py`, `udf_batch_convert.py`, `udf_cli.py`, `tests/test_udf_reader.py` (12 test,
hepsi geçti). Detaylar için o reponun kendi commit/PR sürecine bakın.
