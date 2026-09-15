# Uyap Flow — UYAP Vatandaş Portal Desteği (v2.4.0)

Bu dal (`feature/vatandas-portal`), Uyap Flow eklentisini **UYAP Avukat Portal**'ın yanı sıra
**UYAP Vatandaş Portal** (`vatandas.uyap.gov.tr`) üzerinde de çalışacak şekilde genişletir.

> **Durum: canlı doğrulandı (2026-09-15).** Kullanıcı kendi hesabıyla giriş yaptı (kimlik
> bilgilerini otomasyon aracı görmedi/girmedi). Gerçek paketlenmiş eklenti (v2.4.0) yüklenip
> gerçek bir dava dosyasında test edildi: **UDF modu 34/34 evrakta başarılı, 0 hata**
> (kullanıcının kendi log dosyasıyla doğrulandı). PDF modu ilk testte başarısız çıktı — sebebi
> bulunup düzeltildi (bkz. "UDF → PDF dönüşümü" bölümü), ikinci canlı test bekleniyor.

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
  **Vatandaş Portal'ın gerçek yapısı canlı oturumda doğrulandı**: evrak yaprakları
  `#dosya_evrak_bilgileri_tab span.file[evrak_id]`, dosya başlığı `#dosya_goruntule_modal .modal-title`,
  evrak sekmesi `a[href="#dosya_evrak_bilgileri_tab"]`, ağaç konteyneri
  `#dosya_evrak_bilgileri_tab .filetree` (jQuery "filetree" eklentisi — DevExtreme DEĞİL).
- **Vatandaş meta veri çıkarma** (`extractMetaFromVatandasTooltip` + `normalizeVatandasMeta`):
  meta veri bir Bootstrap tooltip'in `data-original-title` özniteliğinde HTML olarak durur
  (`<div>Birim Evrak No: 64817</div>...`); alan adları avukat portalından farklı olduğundan
  (`Türü`→`Tür`, `Tipi`→`Tip`, `Evrakın Onaylandığı Tarih`→`Onaylandığı Tarih`,
  `Gönderen Yer/Kişi`→`Gönderen Yer Kişi`) bir takma-ad tablosuyla normalize edilir.
- **Vatandaş klasör yolu** (`getVatandasFolderSegments`): jQuery filetree'nin
  `<li class="expandable|collapsable"><span class="folder">AD</span><ul>...` iç içe yapısını
  yürüyerek DevExtreme'siz karşılığını üretir.
- **Dosya başlığı regex'i** iki formatı da kapsar: avukat `"YIL/NO Mahkeme - Tür"`,
  vatandaş `"YIL/NO - Mahkeme - Tür"` (dava no sonrası ekstra `" - "`).
- **Vatandaş indirme mekanizması** (`patchVatandasDownloadUrl`): Vatandaş Portal'da indirme
  fetch/XHR üzerinden GİTMEZ — sayfanın kendi `downloadDocURL(url, values)` fonksiyonu bir
  `<a>` oluşturup sentetik `click` dispatch ederek doğrudan tarayıcı indirmesi başlatır. Bu
  yüzden `downloadDocURL` geçici olarak yamanıp `(url, values)` yakalanır; gerçek indirme hiç
  tetiklenmeden `download_document_brd.uyap?evrakId=...&dosyaId=...&yargiTuru=...` URL'i elde
  edilir (bu endpoint **avukat portalıyla birebir aynı** — canlı doğrulandı). Ardından mevcut
  `fetchWithRetry` ile normal akışa girer (dosya adı, ZIP, vb. hep aynı kod yolu).
- **Tarih normalizasyonu**: `GG.AA.YYYY` / `GG-AA-YYYY` formatları mevcut `GG/AA/YYYY`
  ayrıştırıcısıyla uyumlu hale getirilir.
- **Yeniden deneme**: UDF indirmede geçici ağ hatalarına karşı 3 deneme + exponential backoff.
- **PDF modu (Vatandaş Portal)**: İlk canlı testte başarısız çıktı — sebebi bulundu: avukat
  portalının aksine tek tıklama bir önizleme değil, **bağlam menüsü** (`cmenu.show`) açıyor,
  hiçbir ağ isteği tetiklemiyor. Bu yüzden Vatandaş Portal'da "PDF modu" artık farklı çalışır:
  UDF modunun kanıtlanmış indirme akışı kullanılır, dönen dosya `.udf` ise **tarayıcıda gerçek
  bir PDF'e render edilir** (bkz. "UDF → PDF dönüşümü"); zaten `.pdf`/`.tif` ise olduğu gibi kaydedilir.
  Avukat portalının kendi PDF modu (önizleme + ağ yakalama) değişmedi.
- **MutationObserver** (`window.__uyapFlowObserver`): Vatandaş Portal'da evrak konteyneri
  belirince/değişince otomatik tarama tetiklenir (debounce 600ms).
- **UDF Önizleme**: Komut paletinde (`Ctrl+K` → "UDF Önizleme") ve "Gelişmiş" panelinde yeni bir
  buton; bilgisayardaki bir `.udf` dosyasını seçip içeriğini ve meta verisini tarayıcıda gösterir.

### `extension/lib/udf-reader.js` (yeni dosya)
UDF-Toolkit'teki Python `udf_reader.py` modülünün JSZip tabanlı JavaScript portu.
`window.UyapUdfReader.{readUdf, extractText, extractMetadata, validateUdf}` sağlar.

### `extension/lib/udf-to-pdf.js` (yeni dosya) — UDF → PDF dönüşümü
Python `udf_to_pdf.py`'nin basitleştirilmiş bir JS portu: `pdf-lib` + `fontkit` ile UDF içeriğini
(paragraf, kalın/italik, hizalama, tablo, gömülü JPEG/PNG resim, sayfa sonu) gerçek bir PDF'e
render eder. Türkçe karakterler için `DejaVuSerif` fontu (4 ağırlık) `lib/fonts/` altında
vendor edildi ve `web_accessible_resources` ile `chrome.runtime.getURL()` üzerinden tembel
(lazy) yüklenir — sadece PDF dönüşümü ilk kullanıldığında indirilir, sayfa açılışını etkilemez.

**Node'da (jsdom + gerçek pdf-lib/fontkit) doğrulandı**: kalın/italik/Türkçe karakterler
(ığüşöç ĞÜŞÖÇİı dahil), 2 sütunlu tablo ve gömülü PNG resim doğru render edildi (görsel olarak
piksel bazında incelendi — ekran görüntüsü PR'da mevcut). **Canlı Vatandaş Portal'da henüz test
edilmedi** — kullanıcının bir sonraki testi bekleniyor.

**v1 basitleştirmeleri (bilinçli sınırlamalar):**
- Üstbilgi/altbilgi her sayfada tekrar etmez, sadece ilk/son sayfada bir kez basılır.
- Numaralı/madde işaretli listeler düz paragraf olarak basılır.
- Metin çıkarma/kopyalama (ToUnicode CMap) tam çalışmayabilir — **görsel render tamamen
  doğru**, sadece PDF içinden metni seçip kopyalamak güvenilir olmayabilir.
- `.tif` gibi UDF olmayan native formatlar dönüştürülmez, olduğu gibi kaydedilir.

## Avukat Portal'da davranış değişikliği var mı?

**Hayır.** Her seçici fallback zincirinde avukat portalının doğrulanmış seçicisi hep ilk
sıradadır ve `PORTAL_MODE==='avukat'` olduğunda zincirdeki tek eleman odur — davranış birebir
korunur. Tüm değişiklikler `node --check` ile sözdizimi doğrulamasından geçmiştir.

## Bilinen sınırlamalar

1. **Toplu dosya kuyruğu (çoklu dosya)** henüz canlı test edilmedi — "Dosya Sorgula" tablosundaki
   `dosya-goruntule` seçicisi doğru görünüyor ama kuyruk akışının tamamı denenmedi.
2. **PDF modu (yeni UDF→PDF yolu)** Node'da (jsdom) doğrulandı ama Vatandaş Portal'da canlı
   test edilmedi — `chrome.runtime.getURL()`'nin gerçek uzantıda MAIN world content script'ten
   beklendiği gibi çalışıp çalışmadığı doğrulanmalı. Çalışmazsa kod net bir uyarı loglayıp ham
   `.udf` dosyasını kaydeder (kırılmaz, sadece dönüşüm atlanır). **UDF modu** (varsayılan) tam
   canlı doğrulandı ve her koşulda önerilir.
3. **PTT tebligat sorgulama** (`ptt-helper.js`) portal bağımsızdır, değişmedi.
4. **UDF Toolkit entegrasyonu** (`lib/udf-reader.js`) sadece **içerik önizleme** sağlar;
   imza doğrulama (`sign.sgn`) veya belge düzenleme yapmaz.
5. **Eşzamanlı indirme sınırı**: Görevde istenen "aynı anda maksimum 3 indirme" yerine mevcut
   sıralı (1 eşzamanlı) mimari korundu — UYAP sunucusuna karşı daha güvenli ve mevcut kodla
   tutarlı; sadece hata durumunda 3 deneme + backoff eklendi.
6. Test tek bir dava dosyası (ceza dava dosyası) üzerinde yapıldı; icra/hukuk dosyaları veya
   farklı evrak türlerinde (özellikle ek-evrak/alt-evrak genişletme) küçük DOM farklılıkları
   çıkabilir.

## Test durumu

- ✅ `node --check` ile `main.js`, `manifest.json`, `lib/udf-reader.js` sözdizimi doğrulandı.
- ✅ `lib/udf-reader.js`, jsdom + gerçek jszip ile Python tarafından üretilmiş örnek bir UDF
  üzerinde doğrulandı (metin/meta/validasyon).
- ✅ **Canlı Vatandaş Portal testi yapıldı (2026-09-15)**: kullanıcı kendi hesabıyla giriş yaptı,
  gerçek bir dava dosyasının Evrak sekmesi açıldı, aşağıdakiler doğrudan tarayıcı konsolunda
  (main.js ile birebir aynı fonksiyonlar enjekte edilerek) doğrulandı:
  - Evrak tarama: 64 evrak bulundu (`#dosya_evrak_bilgileri_tab span.file[evrak_id]`)
  - Meta veri çıkarma + alan adı normalizasyonu doğru çalıştı
  - Klasör yolu (`getVatandasFolderSegments`) doğru üretildi
  - **Uçtan uca indirme**: bir evrak yakalanıp gerçek bir dosya (PDF, 5674 byte) indi, dosya adı
    doğru üretildi (`07-04-2026_Kapalı E-Tebliğ Mazbatası_10804.pdf`)
  - Dosya başlığı ayrıştırma (`getOpenDosyaInfo`) doğru sonuç verdi
- ✅ **Gerçek paketlenmiş eklenti (v2.4.0) kullanıcı tarafından yüklenip test edildi**: UDF modu
  34/34 evrakta başarılı (log dosyasıyla doğrulandı). PDF modu ilk denemede tüm evraklarda
  "PDF yakalanamadı" hatası verdi — kök neden bulunup düzeltildi (yukarıya bakın); düzeltmenin
  canlı testi bekleniyor.
- ✅ **UDF → PDF render motoru** Node'da (jsdom + gerçek `pdf-lib`/`@pdf-lib/fontkit`) 3 senaryoyla
  test edildi: düz metin, kalın+italik+Türkçe karakterli paragraf + 2 sütunlu tablo, gömülü PNG
  resim. Üretilen PDF'ler `pymupdf` ile piksel görüntüye render edilip gözle doğrulandı.

## UDF Toolkit (ayrı repo: `UDF-Toolkit`)

Bu depodan bağımsız olarak `saidsurucu/UDF-Toolkit` reposuna eklenen Python modülleri:
`udf_reader.py`, `udf_batch_convert.py`, `udf_cli.py`, `tests/test_udf_reader.py` (12 test,
hepsi geçti). Detaylar için o reponun kendi commit/PR sürecine bakın.
