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
