/* ============================================================================
 *  Uyap Flow — UDF Reader (tarayıcı içi, JSZip tabanlı)
 *  UYAP-Toolkit'in Python udf_reader.py modülünün JS portu.
 *  UDF = ZIP arşivi; içinde en az content.xml bulunur (format_id="1.8").
 *  İmza doğrulama (sign.sgn, PKCS#7) burada YAPILMAZ — sadece içerik okunur.
 * ============================================================================ */
(function (global) {
  'use strict';

  function stripCdataMarkers(text) {
    if (typeof text !== 'string') return '';
    if (text.startsWith('<![CDATA[') && text.endsWith(']]>')) {
      return text.slice(9, -3);
    }
    return text;
  }

  function sliceText(contentText, elAttrs) {
    const start = parseInt(elAttrs.getAttribute('startOffset') || '0', 10);
    const length = parseInt(elAttrs.getAttribute('length') || '0', 10);
    return contentText.slice(start, start + length);
  }

  function paragraphText(paragraphEl, contentText) {
    let out = '';
    for (const child of Array.from(paragraphEl.children)) {
      const tag = child.tagName;
      if (tag === 'content' || tag === 'field') out += sliceText(contentText, child);
      else if (tag === 'space') out += ' ';
      else if (tag === 'image') out += '[RESIM]';
      else if (tag === 'tab') out += '\t';
    }
    return out;
  }

  function tableRows(tableEl, contentText) {
    const rows = [];
    for (const row of Array.from(tableEl.querySelectorAll(':scope > row'))) {
      const cells = [];
      for (const cell of Array.from(row.querySelectorAll(':scope > cell'))) {
        const paras = Array.from(cell.querySelectorAll(':scope > paragraph'))
          .map((p) => paragraphText(p, contentText));
        cells.push(paras.filter(Boolean).join(' '));
      }
      rows.push(cells);
    }
    return rows;
  }

  /**
   * Bir UDF dosyasını (ArrayBuffer) parse eder.
   * Döndürür: { root: XMLDocument, contentText: string, zipNames: string[] }
   */
  async function readUdf(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip yüklenmemiş. manifest.json content_scripts sırasını kontrol edin.');
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (e) {
      throw new Error('Geçerli bir ZIP/UDF dosyası değil: ' + (e?.message || e));
    }
    const zipNames = Object.keys(zip.files);
    if (!zip.file('content.xml')) {
      throw new Error("'content.xml' bulunamadı — bu bir UDF dosyası değil.");
    }
    const xmlText = await zip.file('content.xml').async('string');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('content.xml XML olarak parse edilemedi: ' + parserError.textContent.slice(0, 200));
    }
    const contentEl = doc.querySelector('template > content');
    const contentText = contentEl ? stripCdataMarkers(contentEl.textContent) : '';
    return { root: doc.documentElement, contentText, zipNames, zip };
  }

  /** UDF'den düz metin çıkarır (header → gövde → footer). */
  async function extractText(arrayBuffer) {
    const { root, contentText } = await readUdf(arrayBuffer);
    const elementsEl = root.querySelector(':scope > elements');
    if (!elementsEl) return '';

    const lines = [];
    const headerEl = elementsEl.querySelector(':scope > header');
    if (headerEl) {
      Array.from(headerEl.querySelectorAll(':scope > paragraph'))
        .forEach((p) => lines.push(paragraphText(p, contentText)));
    }

    for (const elem of Array.from(elementsEl.children)) {
      if (elem.tagName === 'paragraph') {
        lines.push(paragraphText(elem, contentText));
      } else if (elem.tagName === 'table') {
        tableRows(elem, contentText).forEach((row) => lines.push(row.join(' | ')));
      } else if (elem.tagName === 'page-break') {
        lines.push('\f');
      }
    }

    const footerEl = elementsEl.querySelector(':scope > footer');
    if (footerEl) {
      Array.from(footerEl.querySelectorAll(':scope > paragraph'))
        .forEach((p) => lines.push(paragraphText(p, contentText)));
    }

    return lines.join('\n');
  }

  /** Sayfa özellikleri, stiller ve (varsa) documentproperties.xml / sign.sgn hakkında bilgi. */
  async function extractMetadata(arrayBuffer) {
    const { root, zipNames, zip } = await readUdf(arrayBuffer);
    const meta = {
      formatId: root.getAttribute('format_id'),
      zipEntries: zipNames,
      pageFormat: {},
      styles: {},
      documentProperties: null,
      signature: null,
    };

    const pageFormatEl = root.querySelector(':scope > properties > pageFormat');
    if (pageFormatEl) {
      for (const attr of Array.from(pageFormatEl.attributes)) meta.pageFormat[attr.name] = attr.value;
    }

    root.querySelectorAll(':scope > styles > style').forEach((styleEl) => {
      const name = styleEl.getAttribute('name') || '';
      const attrs = {};
      Array.from(styleEl.attributes).forEach((a) => { attrs[a.name] = a.value; });
      meta.styles[name] = attrs;
    });

    if (zip.file('documentproperties.xml')) {
      try {
        const propsXml = await zip.file('documentproperties.xml').async('string');
        const propsDoc = new DOMParser().parseFromString(propsXml, 'application/xml');
        const props = {};
        Array.from(propsDoc.documentElement.children).forEach((child) => {
          props[child.tagName] = (child.textContent || '').trim();
        });
        meta.documentProperties = props;
      } catch (_) {
        meta.documentProperties = { _parseError: true };
      }
    }

    if (zip.file('sign.sgn')) {
      const signFile = zip.file('sign.sgn');
      const bytes = await signFile.async('uint8array');
      meta.signature = {
        present: true,
        byteLength: bytes.length,
        note: 'PKCS#7 imzası burada doğrulanmadı; sadece varlığı bildirilir.',
      };
    }

    return meta;
  }

  /** UDF geçerliliğini kontrol eder. */
  async function validateUdf(arrayBuffer) {
    const issues = [];
    let parsed;
    try {
      parsed = await readUdf(arrayBuffer);
    } catch (e) {
      return { ok: false, issues: [e.message] };
    }
    const { root } = parsed;
    if (root.tagName !== 'template') issues.push(`Kök eleman 'template' değil: '${root.tagName}'`);
    if (!root.getAttribute('format_id')) issues.push('format_id özniteliği eksik');
    if (!root.querySelector(':scope > content')) issues.push("'content' bölümü eksik");
    if (!root.querySelector(':scope > elements')) issues.push("'elements' bölümü eksik");
    return { ok: issues.length === 0, issues };
  }

  global.UyapUdfReader = { readUdf, extractText, extractMetadata, validateUdf };
})(typeof window !== 'undefined' ? window : this);
