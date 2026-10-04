// S7 + P10d - Varios documentos del mismo paciente en UNA petición (una sola de la cuota
// gratuita) y las indicaciones de seguimiento que lee el escáner.
const test = require('node:test');
const assert = require('node:assert/strict');
const ScanEngine = require('../src/ScanEngine.js');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');

const IMPLANT = { fecha_colocacion: '2019-10-15', marca: 'Noricum', modelo: 'Externa', referencia: 'IP3ER400100', lote: 'M18082', diametro: 4, longitud: 10, posicion: '11', pilar: 'Sin pilar' };
const RAW_NOU = JSON.stringify({
  implantes: [IMPLANT, Object.assign({}, IMPLANT, { posicion: '21' })],
  seguiment: [{ text: 'Control + S.P: 15 dies' }, '2ªC: 4 meses', { text: '2ªC: 4 meses' }, { text: '  ' }]
});

test('parseResponseFull: objeto {implantes, seguiment}, array antiguo e implante suelto', () => {
  const nou = ScanEngine.parseResponseFull(RAW_NOU);
  assert.equal(nou.implantes.length, 2);
  assert.equal(nou.implantes[1].posicion, '21');
  assert.equal(nou.implantes[0].cod_implante, 'IP3ER400100');
  assert.deepEqual(nou.seguiment, [{ text: 'Control + S.P: 15 dies' }, { text: '2ªC: 4 meses' }]);
  assert.deepEqual(ScanEngine.parseResponse(RAW_NOU), nou.implantes);

  const antic = ScanEngine.parseResponseFull(JSON.stringify([IMPLANT]));
  assert.equal(antic.implantes.length, 1);
  assert.deepEqual(antic.seguiment, []);
  assert.equal(ScanEngine.parseResponseFull(JSON.stringify(IMPLANT)).implantes[0].lote, 'M18082');
  assert.deepEqual(ScanEngine.parseResponseFull('```json\n{"implantes":[],"seguiment":[]}\n```'), { implantes: [], seguiment: [] });
});

test('buildPrompt: con varios documentos pide unirlos sin repetir pegatinas; siempre pide el seguimiento', () => {
  const uno = ScanEngine.buildPrompt();
  const tres = ScanEngine.buildPrompt(3);
  assert.equal(uno.indexOf('VARIOS DOCUMENTOS'), -1);
  assert.match(tres, /Recibes 3 documentos/);
  assert.match(tres, /UNA sola vez/);
  [uno, tres].forEach(p => {
    assert.match(p, /SEGUIMIENTO/);
    assert.match(p, /"seguiment"/);
    assert.match(p, /NO un cuadrante/);
    assert.match(p, /\{"implantes":\[/);
  });
});

function geminiCaptura(cos, resposta) {
  return (url, options) => {
    cos.push({ url, body: options.body });
    if (url.indexOf('/models?') !== -1) return { status: 200, text: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) };
    return { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: resposta || RAW_NOU }] } }] }) };
  };
}

const DOCS = [
  { base64Data: 'UERGMQ==', mimeType: 'application/pdf' },
  { base64Data: 'SU1HMg==', mimeType: 'image/jpeg' }
];

test('scanDocuments: una sola petición a Gemini con todos los documentos (y un solo listado de modelos)', () => {
  const crides = [];
  const r = ScanEngine.scanDocuments(DOCS, { httpFetch: geminiCaptura(crides), geminiApiKey: 'k' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.nDocs, 2);
  assert.equal(r.count, 2);
  assert.deepEqual(r.seguiment.map(s => s.text), ['Control + S.P: 15 dies', '2ªC: 4 meses']);
  assert.equal(crides.length, 2, 'listado de modelos + UNA generateContent');
  const parts = JSON.parse(crides[1].body).contents[0].parts;
  assert.match(parts[0].text, /Recibes 2 documentos/);
  assert.deepEqual(parts.slice(1).map(p => p.text || p.inline_data.mime_type),
    ['Documento 1 de 2:', 'application/pdf', 'Documento 2 de 2:', 'image/jpeg']);
  assert.equal(parts[4].inline_data.data, 'SU1HMg==');
});

test('scanPassport (un documento) sigue igual: sin etiquetas "Documento k de N"', () => {
  const crides = [];
  const r = ScanEngine.scanPassport('UERGMQ==', 'application/pdf', { httpFetch: geminiCaptura(crides), geminiApiKey: 'k' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.map(i => i.posicion), ['11', '21']);
  const parts = JSON.parse(crides[1].body).contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[1].inline_data.data, 'UERGMQ==');
});

test('scanDocuments: el fallback de pago recibe los N documentos con nombres distintos y el motor PDF fijado', () => {
  const cossos = [];
  const httpFetch = (url, options) => {
    if (url.indexOf('generativelanguage') !== -1) return { status: 503, text: '{}' };
    cossos.push(JSON.parse(options.body));
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: RAW_NOU } }] }) };
  };
  const pdfs = [DOCS[0], { base64Data: 'UERGMg==', mimeType: 'application/pdf' }];
  const r = ScanEngine.scanDocuments(pdfs, { httpFetch, geminiApiKey: 'k', openRouterApiKey: 'o' });
  assert.equal(r.provider, 'openrouter');
  const body = cossos[0];
  assert.equal(body.model, ScanEngine.OPENROUTER_MODEL);
  assert.equal(body.plugins[0].pdf.engine, ScanEngine.OPENROUTER_PDF_ENGINE);
  assert.deepEqual(body.messages[0].content.filter(c => c.type === 'file').map(c => c.file.filename), ['scan-1.pdf', 'scan-2.pdf']);

  // Solo imágenes: sin plugin de PDF.
  cossos.length = 0;
  ScanEngine.scanDocuments([DOCS[1], DOCS[1]], { httpFetch, geminiApiKey: 'k', openRouterApiKey: 'o' });
  assert.equal(cossos[0].plugins, undefined);
  assert.equal(cossos[0].messages[0].content.filter(c => c.type === 'image_url').length, 2);
});

test('scanDocuments: sin cuota en los dos -> limit (el sidebar no reintenta uno a uno)', () => {
  const r = ScanEngine.scanDocuments(DOCS, { httpFetch: () => ({ status: 429, text: '{}' }), geminiApiKey: 'k', openRouterApiKey: 'o' });
  assert.equal(r.ok, false);
  assert.equal(r.limit, true);
  const e = ScanEngine.scanDocuments(DOCS, { httpFetch: () => ({ status: 400, text: '{}' }), geminiApiKey: 'k', openRouterApiKey: 'o' });
  assert.equal(e.ok, false);
  assert.equal(e.limit, undefined);
});

function libro() {
  return new FakeSpreadsheet([new FakeSheet('Pacientes', [['Codi d\'accés']])]);
}

test('processImplantFiles: lee los data URL y hace una sola lectura; demasiados documentos -> error', () => {
  const { ctx } = cargarCodigo(libro(), { props: { GEMINI_API_KEY: 'k', OPENROUTER_API_KEY: 'o' } });
  const crides = [];
  const fetch = geminiCaptura(crides);
  ctx.UrlFetchApp = { fetch: (url, p) => { const r = fetch(url, { body: p.payload }); return { getResponseCode: () => r.status, getContentText: () => r.text }; } };
  const r = ctx.processImplantFiles(['data:application/pdf;base64,UERGMQ==', 'data:image/jpeg;base64,SU1HMg==']);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.nDocs, 2);
  assert.equal(r.seguiment.length, 2);
  assert.equal(crides.filter(c => c.url.indexOf('generateContent') !== -1).length, 1);

  assert.match(ctx.processImplantFiles([]).message, /cap document/);
  assert.match(ctx.processImplantFiles(new Array(7).fill('data:image/png;base64,AA==')).message, /màxim 6/);
});

test('processImplantFiles es solo para el personal (ADR 0003)', () => {
  const { ctx } = cargarCodigo(libro(), { usuari: '' });
  assert.throws(() => ctx.processImplantFiles(['data:image/png;base64,AA==']), /full de càlcul de la clínica/);
});
