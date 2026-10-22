'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const JSZip = require('../extension/lib/jszip.min.js');
const source = fs.readFileSync(path.join(__dirname, '../extension/main.js'), 'utf8');
const start = source.indexOf('  async function packageAsZip(');
const end = source.indexOf('  async function mergePdfs(', start);
assert(start >= 0 && end > start);
let output;
const context = vm.createContext({ JSZip, crypto: webcrypto, log() {}, setProgress() {},
  getOpenDosyaInfo: () => ({ yil: '2026', no: '1', esas: '2026-1', mahkeme: 'Sentetik İcra Dairesi', dosyaTuru: 'İcra Dosyası' }),
  saveBlobAs: blob => { output = blob; } });
vm.runInContext(source.slice(start, end) + '\nglobalThis.packageAsZip = packageAsZip;', context);
(async () => {
  await context.packageAsZip([
    { filename: 'dosya/evrak.pdf', blob: new Blob(['synthetic 1']) },
    { filename: 'dosya/evrak.pdf', blob: new Blob(['synthetic 2']) },
    { filename: 'dosya/evrak_1.pdf', blob: new Blob(['synthetic 3']) },
  ], 'test.zip');
  const zip = await JSZip.loadAsync(await output.arrayBuffer());
  const manifest = JSON.parse(await zip.file('mind-palace-manifest.json').async('string'));
  assert.equal(manifest.case.kind, 'icra'); assert.equal(manifest.case.number, '2026/1');
  assert.equal(manifest.documents.length, 3);
  assert.equal(new Set(manifest.documents.map(d => d.path)).size, 3);
  for (const doc of manifest.documents) {
    const bytes = await zip.file(doc.path).async('nodebuffer');
    assert.equal(doc.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(doc.size, bytes.length);
  }
  console.log('PASS: actual UYAP ZIP function, Turkish case type, filename collisions and SHA-256 manifest.');
})().catch(error => { console.error(error); process.exitCode = 1; });
