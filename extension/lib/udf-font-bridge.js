/* ============================================================================
 *  Uyap Flow — UDF→PDF font köprüsü (ISOLATED world)
 *
 *  main.js ve lib/udf-to-pdf.js "MAIN" dünyada çalışır (sayfanın kendi fetch/XHR/
 *  downloadDocURL fonksiyonlarını yamalamak için gerekli). Ama chrome.runtime
 *  MAIN dünyada TANIMLI DEĞİLDİR — bu yüzden extension içindeki font dosyalarını
 *  doğrudan chrome.runtime.getURL() ile okuyamaz. Bu dosya varsayılan (ISOLATED)
 *  dünyada çalışır, chrome.runtime'a erişebilir; window.postMessage köprüsüyle
 *  MAIN dünyadan gelen font isteklerini karşılar.
 * ============================================================================ */
(function () {
  'use strict';

  const FONT_FILES = {
    regular: 'lib/fonts/DejaVuSerif.ttf',
    bold: 'lib/fonts/DejaVuSerif-Bold.ttf',
    italic: 'lib/fonts/DejaVuSerif-Italic.ttf',
    boldItalic: 'lib/fonts/DejaVuSerif-BoldItalic.ttf',
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'UYAP_FLOW_FONT_REQUEST') return;

    const relPath = FONT_FILES[data.name];
    if (!relPath) {
      window.postMessage({ type: 'UYAP_FLOW_FONT_RESPONSE', requestId: data.requestId, error: 'Bilinmeyen font adı: ' + data.name }, '*');
      return;
    }
    try {
      const resp = await fetch(chrome.runtime.getURL(relPath));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      window.postMessage({ type: 'UYAP_FLOW_FONT_RESPONSE', requestId: data.requestId, bytes: buf }, '*', [buf]);
    } catch (e) {
      window.postMessage({ type: 'UYAP_FLOW_FONT_RESPONSE', requestId: data.requestId, error: String(e?.message || e) }, '*');
    }
  });
})();
