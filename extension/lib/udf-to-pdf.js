/* ============================================================================
 *  Uyap Flow — UDF → PDF (tarayıcı içi, pdf-lib + fontkit)
 *  Vatandaş Portal'da "tek tık → önizleme → ağ isteği" mekanizması olmadığından
 *  (bkz. main.js), UDF modu ile inen ham .udf dosyalarını gerçek bir PDF'e
 *  render eder. UYAP-Toolkit'in Python udf_to_pdf.py mantığının basitleştirilmiş,
 *  "okunabilir" bir JS portudur — pikselde birebir UYAP çıktısı hedeflenmez.
 *
 *  Bilinen basitleştirmeler (v1):
 *  - Üstbilgi/altbilgi sadece ilk/son sayfada bir kez basılır (her sayfada
 *    tekrar etmez).
 *  - Numaralı/madde işaretli listeler düz paragraf olarak basılır (numara/madde
 *    işareti eklenmez).
 *  - Tablo hücre arka plan rengi ve gelişmiş kenarlık stilleri (borderSpec bitwise)
 *    uygulanmaz; sade tek-piksel kenarlık çizilir.
 * ============================================================================ */
(function (global) {
  'use strict';

  /**
   * main.js/udf-to-pdf.js MAIN dünyada çalışır; chrome.runtime orada tanımlı
   * DEĞİLDİR (Chrome kısıtlaması — MAIN world sayfanın kendi JS ortamıdır).
   * Font dosyalarını okuyabilmek için lib/udf-font-bridge.js (ISOLATED world,
   * chrome.runtime'a erişebilir) ile window.postMessage üzerinden konuşulur.
   */
  function requestFontBytes(name) {
    return new Promise((resolve, reject) => {
      const requestId = 'uyapFlowFont_' + Math.random().toString(36).slice(2);
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Font köprüsü zaman aşımına uğradı (lib/udf-font-bridge.js yüklenmemiş olabilir).'));
      }, 8000);
      function onMessage(event) {
        if (event.source !== global.window) return;
        const data = event.data;
        if (!data || data.type !== 'UYAP_FLOW_FONT_RESPONSE' || data.requestId !== requestId) return;
        cleanup();
        if (data.error) reject(new Error(data.error));
        else resolve(new Uint8Array(data.bytes));
      }
      function cleanup() {
        clearTimeout(timeoutId);
        global.window.removeEventListener('message', onMessage);
      }
      global.window.addEventListener('message', onMessage);
      global.window.postMessage({ type: 'UYAP_FLOW_FONT_REQUEST', requestId, name }, '*');
    });
  }

  function argbToRgb01(colorValue) {
    if (colorValue == null) return null;
    let n = parseInt(colorValue, 10);
    if (Number.isNaN(n)) return null;
    if (n < 0) n = 0xFFFFFFFF + n + 1;
    const r = (n >> 16) & 0xFF, g = (n >> 8) & 0xFF, b = n & 0xFF;
    return { r: r / 255, g: g / 255, b: b / 255 };
  }

  function sliceText(contentText, elAttrs) {
    const start = parseInt(elAttrs.getAttribute('startOffset') || '0', 10);
    const length = parseInt(elAttrs.getAttribute('length') || '0', 10);
    return contentText.slice(start, start + length);
  }

  /** Bir paragrafı stil-korumalı "run" listesine çevirir: { text, bold, italic, size, color, isImage, imageData, isTab }. */
  function paragraphRuns(paragraphEl, contentText) {
    const runs = [];
    for (const child of Array.from(paragraphEl.children)) {
      const tag = child.tagName;
      if (tag === 'content' || tag === 'field') {
        runs.push({
          text: sliceText(contentText, child),
          bold: child.getAttribute('bold') === 'true',
          italic: child.getAttribute('italic') === 'true',
          size: parseFloat(child.getAttribute('size') || '11') || 11,
          color: argbToRgb01(child.getAttribute('foreground')),
        });
      } else if (tag === 'space') {
        runs.push({ text: ' ', size: 11 });
      } else if (tag === 'tab') {
        runs.push({ text: '\t', size: 11 });
      } else if (tag === 'image') {
        runs.push({
          isImage: true,
          imageData: child.getAttribute('imageData'),
          width: parseFloat(child.getAttribute('width') || '100'),
          height: parseFloat(child.getAttribute('height') || '100'),
        });
      }
    }
    return runs;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Font rengiyle çizim yapan, otomatik satır kaydırmalı, sayfa taşmasında yeni sayfa açan basit bir yerleştirici. */
  function createLayoutEngine(pdfDoc, fonts, pageFormat) {
    const PT = (v, def) => (v != null && !Number.isNaN(parseFloat(v)) ? parseFloat(v) : def);
    const landscape = pageFormat?.getAttribute('paperOrientation') === '0';
    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const margin = {
      left: PT(pageFormat?.getAttribute('leftMargin'), 42.52),
      right: PT(pageFormat?.getAttribute('rightMargin'), 28.35),
      top: PT(pageFormat?.getAttribute('topMargin'), 14.17),
      bottom: PT(pageFormat?.getAttribute('bottomMargin'), 14.17),
    };
    const contentWidth = pageW - margin.left - margin.right;

    let page = pdfDoc.addPage([pageW, pageH]);
    let y = pageH - margin.top;

    function newPage() {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin.top;
    }

    function ensureSpace(neededHeight) {
      if (y - neededHeight < margin.bottom) newPage();
    }

    function pickFont(run) {
      if (run.bold && run.italic) return fonts.boldItalic || fonts.regular;
      if (run.bold) return fonts.bold || fonts.regular;
      if (run.italic) return fonts.italic || fonts.regular;
      return fonts.regular;
    }

    /** Run dizisini kelime bazlı satırlara böler (basit greedy wrap). */
    function wrapRuns(runs, maxWidth) {
      const lines = [[]];
      let lineWidth = 0;
      for (const run of runs) {
        if (run.isImage) {
          if (lineWidth > 0) { lines.push([]); lineWidth = 0; }
          lines.push([run]);
          lines.push([]);
          lineWidth = 0;
          continue;
        }
        const font = pickFont(run);
        const words = run.text.split(/(\s+)/).filter((w) => w !== '');
        for (const word of words) {
          const w = font.widthOfTextAtSize(word, run.size || 11);
          if (lineWidth + w > maxWidth && lineWidth > 0 && word.trim() !== '') {
            lines.push([]);
            lineWidth = 0;
          }
          lines[lines.length - 1].push({ ...run, text: word });
          lineWidth += w;
        }
      }
      return lines.filter((l) => l.length > 0 || true);
    }

    function drawLine(lineRuns, x, lineY, align, maxWidth) {
      if (lineRuns.length === 1 && lineRuns[0].isImage) {
        const img = lineRuns[0]._embeddedImage;
        if (img) {
          ensureSpace(lineRuns[0].height);
          page.drawImage(img, { x, y: y - lineRuns[0].height, width: lineRuns[0].width, height: lineRuns[0].height });
          y -= lineRuns[0].height + 4;
        }
        return;
      }
      let totalWidth = 0;
      for (const r of lineRuns) totalWidth += pickFont(r).widthOfTextAtSize(r.text, r.size || 11);
      let startX = x;
      let extraGap = 0;
      if (align === '1') startX = x + Math.max(0, (maxWidth - totalWidth) / 2);
      else if (align === '2') startX = x + Math.max(0, maxWidth - totalWidth);
      else if (align === '3' && lineRuns.length > 1) {
        const gaps = lineRuns.filter((r) => /^\s+$/.test(r.text)).length;
        if (gaps > 0) extraGap = Math.max(0, (maxWidth - totalWidth) / gaps);
      }
      let cx = startX;
      const maxSize = Math.max(...lineRuns.map((r) => r.size || 11));
      ensureSpace(maxSize * 1.3);
      for (const r of lineRuns) {
        const font = pickFont(r);
        const size = r.size || 11;
        const color = r.color ? global.PDFLib.rgb(r.color.r, r.color.g, r.color.b) : global.PDFLib.rgb(0, 0, 0);
        page.drawText(r.text, { x: cx, y: y - size, size, font, color });
        cx += font.widthOfTextAtSize(r.text, size);
        if (/^\s+$/.test(r.text)) cx += extraGap;
      }
    }

    function drawParagraph(runs, opts) {
      opts = opts || {};
      const align = opts.align || '0';
      const leftIndent = opts.leftIndent || 0;
      const x = margin.left + leftIndent;
      const maxWidth = contentWidth - leftIndent;
      const lineSpacing = opts.lineSpacing || 1.25;

      if (!runs.length) { y -= 11 * lineSpacing; return; }

      const lines = wrapRuns(runs, maxWidth);
      for (const line of lines) {
        if (!line.length) { y -= 11 * lineSpacing; continue; }
        const maxSize = Math.max(...line.map((r) => r.size || 11));
        drawLine(line, x, y, align, maxWidth);
        if (!(line.length === 1 && line[0].isImage)) y -= maxSize * lineSpacing;
      }
    }

    async function embedImagesInRuns(runs) {
      for (const run of runs) {
        if (!run.isImage || !run.imageData) continue;
        try {
          const bytes = base64ToBytes(run.imageData);
          try { run._embeddedImage = await pdfDoc.embedJpg(bytes); }
          catch (_) { run._embeddedImage = await pdfDoc.embedPng(bytes); }
        } catch (_) { run._embeddedImage = null; }
      }
    }

    return { pdfDoc, get page() { return page; }, get y() { return y; }, set y(v) { y = v; }, margin, contentWidth, pageW, pageH, ensureSpace, newPage, drawParagraph, embedImagesInRuns, wrapRuns, drawLine, pickFont };
  }

  async function renderTable(engine, tableEl, contentText) {
    const columnCount = parseInt(tableEl.getAttribute('columnCount') || '1', 10);
    const spansRaw = (tableEl.getAttribute('columnSpans') || '').split(',').map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
    let colWidths = spansRaw.length === columnCount ? spansRaw : null;
    if (!colWidths) {
      const w = engine.contentWidth / columnCount;
      colWidths = new Array(columnCount).fill(w);
    } else {
      const totalRaw = colWidths.reduce((a, b) => a + b, 0);
      const scale = engine.contentWidth / totalRaw;
      colWidths = colWidths.map((w) => w * scale);
    }

    const rows = Array.from(tableEl.querySelectorAll(':scope > row'));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll(':scope > cell'));
      const cellLines = [];
      let maxLines = 1;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const w = colWidths[Math.min(i, colWidths.length - 1)] - 8;
        const paras = Array.from(cell.querySelectorAll(':scope > paragraph'));
        const allRuns = [];
        paras.forEach((p, idx) => {
          if (idx > 0) allRuns.push({ text: '\n', size: 10 });
          allRuns.push(...paragraphRuns(p, contentText));
        });
        await engine.embedImagesInRuns(allRuns);
        const lines = engine.wrapRuns(allRuns.filter((r) => r.text !== '\n'), Math.max(w, 20));
        cellLines.push(lines);
        maxLines = Math.max(maxLines, lines.length);
      }
      const rowHeight = maxLines * 13 + 6;
      engine.ensureSpace(rowHeight);
      const rowTop = engine.y;
      let cx = engine.margin.left;
      for (let i = 0; i < cells.length; i++) {
        const w = colWidths[Math.min(i, colWidths.length - 1)];
        engine.page.drawRectangle({
          x: cx, y: rowTop - rowHeight, width: w, height: rowHeight,
          borderColor: global.PDFLib.rgb(0.6, 0.6, 0.6), borderWidth: 0.6,
        });
        let ly = rowTop - 11;
        for (const line of cellLines[i]) {
          if (!line.length) { ly -= 13; continue; }
          engine.drawLine(line, cx + 4, ly, '0', w - 8);
          ly -= 13;
        }
        cx += w;
      }
      engine.y = rowTop - rowHeight;
    }
  }

  /** Fontları önbelleğe alır (ilk kullanımda indirir) — sayfa yükünü artırmamak için tembel. */
  let fontBytesCache = null;
  async function loadFontBytes() {
    if (fontBytesCache) return fontBytesCache;
    const [regular, bold, italic, boldItalic] = await Promise.all([
      requestFontBytes('regular'), requestFontBytes('bold'),
      requestFontBytes('italic'), requestFontBytes('boldItalic'),
    ]);
    fontBytesCache = { regular, bold, italic, boldItalic };
    return fontBytesCache;
  }

  /**
   * Bir UDF ArrayBuffer'ını gerçek bir PDF Blob'a render eder.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<Blob>}
   */
  async function convertUdfToPdf(arrayBuffer) {
    if (typeof global.UyapUdfReader === 'undefined') throw new Error('lib/udf-reader.js yüklenmemiş.');
    if (typeof global.PDFLib === 'undefined') throw new Error('lib/pdf-lib.min.js yüklenmemiş.');
    if (typeof global.fontkit === 'undefined') throw new Error('lib/fontkit.min.js yüklenmemiş.');

    const { root, contentText } = await global.UyapUdfReader.readUdf(arrayBuffer);
    const pageFormatEl = root.querySelector(':scope > properties > pageFormat');

    const pdfDoc = await global.PDFLib.PDFDocument.create();
    pdfDoc.registerFontkit(global.fontkit);

    const fontBytes = await loadFontBytes();
    const fonts = {
      regular: await pdfDoc.embedFont(fontBytes.regular, { subset: true }),
      bold: await pdfDoc.embedFont(fontBytes.bold, { subset: true }),
      italic: await pdfDoc.embedFont(fontBytes.italic, { subset: true }),
      boldItalic: await pdfDoc.embedFont(fontBytes.boldItalic, { subset: true }),
    };

    const engine = createLayoutEngine(pdfDoc, fonts, pageFormatEl);
    const elementsEl = root.querySelector(':scope > elements');
    if (!elementsEl) {
      pdfDoc.setTitle('Uyap Flow — Boş Belge');
      return new Blob([await pdfDoc.save()], { type: 'application/pdf' });
    }

    const headerEl = elementsEl.querySelector(':scope > header');
    if (headerEl) {
      for (const p of Array.from(headerEl.querySelectorAll(':scope > paragraph'))) {
        const runs = paragraphRuns(p, contentText);
        await engine.embedImagesInRuns(runs);
        engine.drawParagraph(runs, { align: p.getAttribute('Alignment') });
      }
      engine.y -= 6;
    }

    for (const elem of Array.from(elementsEl.children)) {
      if (elem.tagName === 'header' || elem.tagName === 'footer') continue;
      if (elem.tagName === 'paragraph') {
        const runs = paragraphRuns(elem, contentText);
        await engine.embedImagesInRuns(runs);
        engine.drawParagraph(runs, {
          align: elem.getAttribute('Alignment'),
          leftIndent: parseFloat(elem.getAttribute('LeftIndent') || '0') || 0,
          lineSpacing: 1 + (parseFloat(elem.getAttribute('LineSpacing') || '0') || 0) * 0.15 + 1.1,
        });
      } else if (elem.tagName === 'table') {
        await renderTable(engine, elem, contentText);
        engine.y -= 8;
      } else if (elem.tagName === 'page-break') {
        engine.newPage();
      }
    }

    const footerEl = elementsEl.querySelector(':scope > footer');
    if (footerEl) {
      engine.y -= 10;
      for (const p of Array.from(footerEl.querySelectorAll(':scope > paragraph'))) {
        const runs = paragraphRuns(p, contentText);
        await engine.embedImagesInRuns(runs);
        engine.drawParagraph(runs, { align: p.getAttribute('Alignment') });
      }
    }

    pdfDoc.setProducer('Uyap Flow (UDF -> PDF, tarayici ici donusum)');
    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  global.UyapUdfToPdf = { convert: convertUdfToPdf };
})(typeof window !== 'undefined' ? window : this);
