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

['A', 'B', 'C'].forEach(v => {
  test('variante ' + v + ': datos, escapado y sin nada interno', () => {
    const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026', { variant: v });
    assert.match(h, /^<html>/);
    assert.match(h, /Fisura pterigoidea \(cuadrante 1\)/);
    assert.match(h, /Interna · plataforma 4,1/);
    assert.match(h, /HE41418/);
    assert.match(h, /2299C/);
    assert.match(h, /A cabeza de implante/);
    assert.match(h, /Código de acceso:<\/b> ABC234/);
    assert.match(h, /\*\*\*4567\*\*/);
    assert.doesNotMatch(h, /<b>Núñez<\/b>|<script>x/, 'todo escapado');
    assert.doesNotMatch(h, /id_quartup|Cuenta|Nº Historial/i);
  });
});

test('variante A: Ref/Lote antes que el pilar, que va debajo del implante', () => {
  const h = P.htmlPasaporte(PAC, IMPS, 'ABC234', '03/10/2026', { variant: 'A' });
  assert.ok(h.indexOf('HE41418') < h.indexOf('Pilar:</b> A cabeza de implante'));
  // Pilar vacío y sin pendiente: no hay banda de pilar para el 26.
  assert.equal((h.match(/<b>Pilar:<\/b>/g) || []).length, 1);
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
