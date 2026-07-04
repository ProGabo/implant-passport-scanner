const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ScanEngine = require('../ScanEngine.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'MANIFEST.json');

const sampleNames = fs.existsSync(MANIFEST_PATH)
  ? Object.keys(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))).sort()
  : [];

if (sampleNames.length === 0) {
  test(
    'parseResponse matches golden fixtures',
    { skip: 'no fixtures yet - run "npm run generate-fixtures" first' },
    () => {}
  );
}

sampleNames.forEach((sampleName) => {
  const fixturePath = path.join(FIXTURES_DIR, `${sampleName}.json`);
  const goldenPath = path.join(GOLDEN_DIR, `${sampleName}.json`);

  test(`parseResponse matches golden for ${sampleName}`, () => {
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const actual = ScanEngine.parseResponse(raw);
    assert.deepStrictEqual(actual, expected);
  });
});

test('parseDataUrl extracts mimeType and base64 payload from a PDF data URL', () => {
  const result = ScanEngine.parseDataUrl('data:application/pdf;base64,JVBERi0xLjQK');
  assert.deepStrictEqual(result, { mimeType: 'application/pdf', base64Data: 'JVBERi0xLjQK' });
});

test('parseDataUrl extracts mimeType and base64 payload from a JPEG data URL', () => {
  const result = ScanEngine.parseDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  assert.deepStrictEqual(result, { mimeType: 'image/jpeg', base64Data: '/9j/4AAQSkZJRg==' });
});

test('parseDataUrl falls back to application/pdf when the string is not a data URL', () => {
  const result = ScanEngine.parseDataUrl('JVBERi0xLjQK');
  assert.deepStrictEqual(result, { mimeType: 'application/pdf', base64Data: 'JVBERi0xLjQK' });
});

test('parseResponse renames referencia to cod_implante and keeps diametro/longitud separate', () => {
  const raw = JSON.stringify([{
    fecha_colocacion: '2024-09-09',
    marca: 'Southern Implants',
    modelo: 'ExHex Zygan',
    conexion: 'Hexágono Externo',
    plataforma: 'RP (Regular)',
    referencia: 'ZYGAN-47.5',
    lote: '085003',
    diametro: 4.3,
    longitud: 47.5,
    posicion: '25',
    pilar: 'Multi-unit 1.5 mm'
  }]);

  const result = ScanEngine.parseResponse(raw);

  assert.equal(result.length, 1);
  assert.equal(result[0].cod_implante, 'ZYGAN-47.5');
  assert.equal(result[0].referencia, undefined);
  assert.equal(result[0].diametro, 4.3);
  assert.equal(result[0].longitud, 47.5);
  assert.equal(result[0].dimensiones, undefined);
});

test('parseResponse skips malformed (null/non-object) entries instead of throwing', () => {
  const raw = JSON.stringify([
    { fecha_colocacion: '2024-01-01', marca: 'Ticare', modelo: 'Inhex', referencia: 'ABC', lote: 'L1', diametro: 4, longitud: 10, posicion: '11', pilar: 'NO' },
    null,
    { fecha_colocacion: '2024-01-01', marca: 'Ticare', modelo: 'Inhex', referencia: 'DEF', lote: 'L2', diametro: 4, longitud: 10, posicion: '21', pilar: 'NO' }
  ]);

  const result = ScanEngine.parseResponse(raw);

  assert.equal(result.length, 2);
  assert.equal(result[0].cod_implante, 'ABC');
  assert.equal(result[1].cod_implante, 'DEF');
});

// ==========================================
//  Money-safety guard tests — no network, fully mocked httpFetch.
//  These encode the hard constraint "never spend the $10 OpenRouter credit" as a
//  permanent regression check, not just a one-time manual verification.
// ==========================================

test('OPENROUTER_MODEL is pinned to a free model', () => {
  assert.match(ScanEngine.OPENROUTER_MODEL, /:free$/);
});

const FAKE_IMPLANT_RAW = JSON.stringify([{
  fecha_colocacion: '2024-09-09',
  marca: 'Southern Implants',
  modelo: 'ExHex Zygan',
  conexion: 'Hexágono Externo',
  plataforma: 'RP (Regular)',
  referencia: 'ZYGAN-47.5',
  lote: '085003',
  diametro: 4.3,
  longitud: 47.5,
  posicion: '25',
  pilar: 'Multi-unit 1.5 mm'
}]);

function geminiDownOpenRouterUpHttpFetch(capturedBodies) {
  return function (url, options) {
    if (url.indexOf('generativelanguage.googleapis.com') !== -1) {
      return { status: 429, text: '{"error":"simulated quota exceeded"}' };
    }
    if (url.indexOf('openrouter.ai') !== -1) {
      if (capturedBodies) capturedBodies.push(options.body);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: FAKE_IMPLANT_RAW } }] }) };
    }
    throw new Error('unexpected URL in test: ' + url);
  };
}

test('scanPassport falls back to OpenRouter when Gemini fails', () => {
  const result = ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: geminiDownOpenRouterUpHttpFetch(),
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.data[0].cod_implante, 'ZYGAN-47.5');
});

test('scanPassport fails gracefully when both providers fail', () => {
  const bothDownHttpFetch = () => ({ status: 429, text: '{"error":"simulated quota exceeded"}' });

  const result = ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: bothDownHttpFetch,
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Límite alcanzado por hoy. Inténtelo de nuevo mañana.');
});

test('OpenRouter PDF requests always pin the free cloudflare-ai engine and never mistral-ocr', () => {
  const capturedBodies = [];
  ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: geminiDownOpenRouterUpHttpFetch(capturedBodies),
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(capturedBodies.length, 1);
  const body = JSON.parse(capturedBodies[0]);
  assert.equal(body.model, ScanEngine.OPENROUTER_MODEL);
  assert.equal(body.plugins[0].pdf.engine, 'cloudflare-ai');
  assert.equal(capturedBodies[0].indexOf('mistral-ocr'), -1);
});

test('OpenRouter image requests skip the file-parser plugin entirely', () => {
  const capturedBodies = [];
  ScanEngine.scanPassport('ZmFrZQ==', 'image/jpeg', {
    httpFetch: geminiDownOpenRouterUpHttpFetch(capturedBodies),
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(capturedBodies.length, 1);
  const body = JSON.parse(capturedBodies[0]);
  assert.equal(body.plugins, undefined);
  assert.equal(body.messages[0].content[1].type, 'image_url');
});
