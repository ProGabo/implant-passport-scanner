// S5: el renderer único del pasaporte (PortalModel.htmlPasaporte) y los textos del pilar.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/PortalModel.js');

test('textPilar: los cuatro casos acordados', () => {
  assert.equal(P.textPilar({ pilar: 'Sin pilar' }), 'Sin pilar');
  assert.equal(P.textPilar({ pilar: '' }), '', 'vacío = aún no se sabe: no se dice nada');
  assert.equal(P.textPilar({ pilar: '', pilar_pendiente: true }), 'Pendiente de colocar');
  assert.equal(P.textPilar({ pilar: 'A cabeza de implante', pilar_pendiente: true }), 'A cabeza de implante', 'si hay algo escrito, sale lo que hay');
  assert.equal(P.textPilar({ pilar: 'Multi-unit', pilar_angulacion: '30', pilar_altura: '5', pilar_marca: 'Ticare',
    pilar_conexion: 'Externa', pilar_ref: 'HE48865' }), 'Multi-unit · 30º · 5 mm · Ticare · Externa · ref. pilar HE48865');
  assert.equal(P.textPilar({ pilar: 'Multi-unit', pilar_altura: '3' }), 'Multi-unit · 3 mm', 'los detalles vacíos no salen');
});

test('textConexion: conexión y plataforma, sin vacíos', () => {
  assert.equal(P.textConexion({ conexion: 'Interna', plataforma: '4,1' }), 'Interna · plataforma 4,1');
  assert.equal(P.textConexion({ conexion: 'Interna' }), 'Interna');
  assert.equal(P.textConexion({}), '');
});

test('perAlPortal: pilar_pendiente solo del servidor, nunca de la fila', () => {
  const o = { nombre: 'X', posicion: '24', pilar: '', pendent: true, que_falta: 'nota interna', email: 'x@x.cat', cuenta_quartup: '430' };
  const sense = P.perAlPortal(o);
  assert.equal(sense.pilar_pendiente, false);
  assert.equal(sense.pilar_texto, '');
  const amb = P.perAlPortal(o, { pilarPendiente: true });
  assert.equal(amb.pilar_texto, 'Pendiente de colocar');
  ['pendent', 'que_falta', 'email', 'cuenta_quartup'].forEach(k => assert.equal(k in amb, false, k));
});

const PAC = { nombre: 'Àngels <b>Núñez</b>', dni_parcial: '***4567**' };
const IMPS = [
  { posicion: 'Fisura pterigoidea (cuadrante 1)', marca: 'Ticare', modelo: 'Quattro', dimensiones: '4,0 x 18', conexion: 'Interna',
    plataforma: '4,1', cod_implante: 'HE41418', lote: '2299C', fecha_colocacion: '3/10/2026', pilar: 'A cabeza de implante' },
  { posicion: '26', marca: 'Ticare', modelo: 'Inhex', dimensiones: '5,0 x 8', conexion: 'Interna', cod_implante: '<script>x</script>',
    lote: 'L1', fecha_colocacion: '3/10/2026', pilar: '' }
];

test('pasaporte: datos, escapado y sin nada interno', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026');
  assert.match(h, /^<html>/);
  assert.match(h, /Fisura pterigoidea \(cuadrante 1\)/);
  assert.match(h, /Interna<br>plataforma&nbsp;4,1/);
  assert.match(h, /HE41418/);
  assert.match(h, /2299C/);
  assert.match(h, /A cabeza de implante/);
  assert.match(h, /Código de acceso<\/div>\s*<div[^>]*>ABC234/);
  assert.match(h, /\*\*\*4567\*\*/);
  assert.doesNotMatch(h, /<b>Núñez<\/b>|<script>x/, 'todo escapado');
  assert.doesNotMatch(h, /id_quartup|Cuenta|Nº Historial/i);
});

test('pasaporte: Ref/Lote antes que el pilar, que va en su banda debajo del implante', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026');
  assert.ok(h.indexOf('HE41418') < h.indexOf('A cabeza de implante'));
  // Pilar vacío y sin pendiente: no hay banda de pilar para el 26.
  assert.equal((h.match(/Pilar asociado:<\/span>/g) || []).length, 1);
});

test('pasaporte: el PDF y la impresión pintan los fondos (print-color-adjust:exact en la raíz)', () => {
  for (const h of [P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026'),
    P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026', { nomesCos: true })]) {
    // Sin esto, el conversor (un Chrome imprimiendo) pierde los fondos y aclara el blanco.
    assert.match(h, /\.psp \{[^}]*-webkit-print-color-adjust:exact;\s*print-color-adjust:exact;/);
    assert.match(h, /<div class="psp">/);
    assert.match(h, /fonts\.googleapis\.com/, 'las mismas fuentes en la vista previa y en el PDF');
  }
});

test('pasaporte: un diente va en el círculo y la pterigoidea, entera, en la pastilla', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026');
  assert.match(h, /<span class="psp-cercle">26<\/span>/);
  assert.match(h, /<span class="psp-pastilla">Fisura pterigoidea \(cuadrante 1\)<\/span>/);
});

test('nomesCos: solo el contenido, para meterlo en la ventana de la vista previa', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026', { nomesCos: true });
  assert.doesNotMatch(h, /<html>|<body>/);
  assert.match(h, /Registro de Implantes Colocados/);
});

test('el logo puede ir incrustado', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026', { logo: 'data:image/png;base64,AAAA' });
  assert.match(h, /src="data:image\/png;base64,AAAA"/);
});

test('pasaporte: una plataforma larga puede saltar de línea (no invade Ref / Lote)', () => {
  const h = P.htmlPasaporte(PAC, [{ posicion: '36', conexion: 'Cónico Interno', plataforma: 'RP (Regular)' }], 'ABC234', '04/10/2026');
  assert.match(h, /Cónico Interno<br>plataforma&nbsp;RP \(Regular\)/);
});
