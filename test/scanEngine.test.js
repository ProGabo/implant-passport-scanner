const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ScanEngine = require('../src/ScanEngine.js');
const { loadSamples } = require('./sampleSets.js');

const samples = loadSamples();

if (samples.length === 0) {
  test(
    'parseResponse matches golden fixtures',
    { skip: 'no fixtures yet - run "npm run generate-fixtures" first' },
    () => {}
  );
}

samples.forEach(({ name, fixturePath, goldenPath }) => {
  test(`parseResponse matches golden for ${name}`, () => {
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

test('parseResponse lleva la IA al vocabulario canónico: pterigoidea, "NO", "Multi-unit 3 mm" y +PC', () => {
  const raw = JSON.stringify([
    { referencia: 'A', posicion: 'Fisura pterigoidea (cuadrante 2)', pilar: '+PC', pilar_altura: '4', pilar_ref: 'HE41404' },
    { referencia: 'B', posicion: 'pterigoidea 1r quadrant', pilar: 'NO' },
    { referencia: 'C', posicion: 25, pilar: 'Multi-unit 3 mm' },
    { referencia: 'D', posicion: '35', pilar: 'Multi-unit', pilar_altura: 5, pilar_angulacion: '30', pilar_ref: 'HE 48865' },
    { referencia: 'E', posicion: 'pterigo', pilar: '' },
    { referencia: 'F', posicion: '41', pilar: 'Sin pilar', pilar_altura: '3', pilar_ref: 'X1' }
  ]);
  const r = ScanEngine.parseResponse(raw);
  assert.equal(r[0].posicion, 'Fisura pterigoidea (cuadrante 2)');
  assert.equal(r[0].pilar, 'A cabeza de implante');
  // El PC es provisional: su altura y su REF no se guardan aunque la IA las devuelva.
  assert.deepEqual([r[0].pilar_altura, r[0].pilar_ref], ['', '']);
  assert.equal(r[1].posicion, 'Fisura pterigoidea (cuadrante 1)');
  assert.equal(r[1].pilar, 'Sin pilar');
  assert.equal(r[2].posicion, '25');
  assert.deepEqual([r[2].pilar, r[2].pilar_altura], ['Multi-unit', '3']);
  assert.deepEqual([r[3].pilar, r[3].pilar_altura, r[3].pilar_angulacion, r[3].pilar_ref], ['Multi-unit', '5', '30', 'HE48865']);
  assert.equal(r[4].posicion, 'No especificado');
  assert.equal(r[4].pilar, 'Sin pilar');
  assert.deepEqual([r[5].pilar_altura, r[5].pilar_ref], ['', '']);
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
//  Original constraint was "never spend the OpenRouter credit"; on 2026-07-09 (with
//  Gabriel's approval) it became "spend deliberately and boundedly": every free model
//  failed the golden benchmark (429s, >60s GAS timeouts, misread stickers), so the
//  fallback now uses paid gemini-2.5-flash (~$0.0005-0.003/scan, prepaid, fallback-only).
//  The guard is now an explicit allowlist: any model change must be a conscious edit
//  here AND in ScanEngine.js, re-benchmarked against the goldens.
// ==========================================

test('OPENROUTER_MODEL is pinned to the deliberately-approved fallback model', () => {
  assert.equal(ScanEngine.OPENROUTER_MODEL, 'google/gemini-2.5-flash');
});

test('OPENROUTER_PDF_ENGINE is pinned to native (no per-page OCR surcharge)', () => {
  assert.equal(ScanEngine.OPENROUTER_PDF_ENGINE, 'native');
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

test('scanPassport shows the daily-limit message ONLY when both providers return 429', () => {
  const bothDownHttpFetch = () => ({ status: 429, text: '{"error":"simulated quota exceeded"}' });

  const result = ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: bothDownHttpFetch,
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Límite alcanzado por hoy. Inténtelo de nuevo mañana.');
});

test('scanPassport reports real provider errors instead of blaming the daily limit', () => {
  // Gemini 400 + OpenRouter 401: exactly the combo that used to be mislabeled as quota.
  const mixedFailureHttpFetch = (url) => {
    if (url.indexOf('generativelanguage.googleapis.com') !== -1) {
      return { status: 400, text: '{"error":"bad request"}' };
    }
    return { status: 401, text: '{"error":"unauthorized"}' };
  };

  const result = ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: mixedFailureHttpFetch,
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(result.ok, false);
  assert.equal(result.message.indexOf('Límite alcanzado'), -1);
  assert.ok(result.message.indexOf('Gemini: HTTP 400') !== -1, result.message);
  assert.ok(result.message.indexOf('OpenRouter: HTTP 401') !== -1, result.message);
});

test('scanPassport rethrows GAS authorization errors so Código.js can show re-auth instructions', () => {
  const authThrowingHttpFetch = () => {
    throw new Error('You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request');
  };

  assert.throws(
    () => ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
      httpFetch: authThrowingHttpFetch,
      geminiApiKey: 'fake-gemini-key',
      openRouterApiKey: 'fake-openrouter-key'
    }),
    /script\.external_request/
  );
});

test('isAuthError recognizes permission failures and rejects ordinary errors', () => {
  assert.equal(ScanEngine.isAuthError(new Error('Required permissions: script.external_request')), true);
  assert.equal(ScanEngine.isAuthError(new Error('PERMISSION_DENIED')), true);
  assert.equal(ScanEngine.isAuthError(new Error('Error API: 429')), false);
  assert.equal(ScanEngine.isAuthError(null), false);
});

test('OpenRouter PDF requests always pin the parser engine explicitly (never rely on the default)', () => {
  const capturedBodies = [];
  ScanEngine.scanPassport('ZmFrZQ==', 'application/pdf', {
    httpFetch: geminiDownOpenRouterUpHttpFetch(capturedBodies),
    geminiApiKey: 'fake-gemini-key',
    openRouterApiKey: 'fake-openrouter-key'
  });

  assert.equal(capturedBodies.length, 1);
  const body = JSON.parse(capturedBodies[0]);
  assert.equal(body.model, ScanEngine.OPENROUTER_MODEL);
  assert.equal(body.plugins[0].pdf.engine, ScanEngine.OPENROUTER_PDF_ENGINE);
  // Never rely on OpenRouter's default engine: an omitted plugin silently falls back to
  // the paid-per-page mistral-ocr for models without native PDF support.
  assert.notEqual(body.plugins[0].pdf.engine, undefined);
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
