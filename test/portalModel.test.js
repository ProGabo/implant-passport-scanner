const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PortalModel.js');

// --- Codi d'accés ---

test('generarCodi: 6 caracteres sin O, 0, I, 1 ni L, y nunca solo cifras', () => {
  let n = 0;
  const seq = [0, 0, 0, 0, 0, 0]; // fuerza primero 'AAAAAA'
  const aleatori = () => (n < seq.length ? seq[n++] : Math.random());
  const usats = ['AAAAAA'];
  const codi = PM.generarCodi(usats, aleatori);
  assert.match(codi, /^[A-Z2-9]{6}$/);
  assert.notEqual(codi, 'AAAAAA');
  for (let i = 0; i < 500; i++) {
    const c = PM.generarCodi([]);
    assert.doesNotMatch(c, /[O0I1L]/);
    assert.doesNotMatch(c, /^\d+$/);
    assert.doesNotMatch(c, /^\d+E\d+$/);
  }
});

/** Aleatorio que primero "saca" las letras de `forçat` y después es aleatorio de verdad. */
function aleatoriQueDona(forçat) {
  let i = 0;
  return () => {
    if (i < forçat.length) return (PM.ALFABET_CODI.indexOf(forçat[i++]) + 0.5) / PM.ALFABET_CODI.length;
    return Math.random();
  };
}

test('generarCodi no repite un código existente aunque solo coincida al normalizarlo', () => {
  // Existe 'ABCZ2L' (antiguo, con L). 'ABCZ21' no se puede generar (sin 1), pero sí
  // 'ABCZ2..' parecidos: se fuerza 'ABCZ22' contra un existente 'abcz22' en minúsculas.
  assert.notEqual(PM.generarCodi(['abcz22'], aleatoriQueDona('ABCZ22')), 'ABCZ22');
  // Y contra un existente que solo coincide al normalizar (O=0 no aplica al alfabeto
  // nuevo; se prueba con separadores).
  assert.notEqual(PM.generarCodi(['AB-CZ 22'], aleatoriQueDona('ABCZ22')), 'ABCZ22');
});

test('codiCanonic: mayúsculas, sin separadores, O=0, I=L=1, ceros que Sheets se comió', () => {
  assert.equal(PM.codiCanonic(' abc-0 12 '), PM.codiCanonic('ABCO12'));
  assert.equal(PM.codiCanonic('X1L9'), PM.codiCanonic('XIl9'));
  assert.equal(PM.codiCanonic(12345), PM.codiCanonic('012345'));
  assert.equal(PM.codiCanonic('DEMO2026'), PM.codiCanonic('demo2026'));
  assert.equal(PM.codiCanonic(''), '');
});

test('resoldreCodi: exacto primero, después tolerante y único; ambiguo si choca', () => {
  const codis = ['ABC012', 'XYZ789', 12345, 'DEMO2026', 'KKO222', 'KK0222'];
  assert.deepEqual(PM.resoldreCodi('abc012', codis), { codi: 'ABC012', ambigu: false });
  assert.deepEqual(PM.resoldreCodi('ABCO12', codis), { codi: 'ABC012', ambigu: false });
  assert.deepEqual(PM.resoldreCodi('012345', codis), { codi: '12345', ambigu: false });
  assert.deepEqual(PM.resoldreCodi('DEMO2026', codis), { codi: 'DEMO2026', ambigu: false });
  // Exacto gana aunque haya otro igual al normalizar.
  assert.deepEqual(PM.resoldreCodi('KKO222', codis), { codi: 'KKO222', ambigu: false });
  assert.deepEqual(PM.resoldreCodi('kk0222 ', codis), { codi: 'KK0222', ambigu: false });
  assert.deepEqual(PM.resoldreCodi('KKQ222', codis), { codi: null, ambigu: false });
  // Separadores: siguen contando como exacto.
  assert.deepEqual(PM.resoldreCodi('KK-O-222', ['KK0222', 'KKO222']).codi, 'KKO222');
  // Ni exacto ni único al normalizar: ambiguo, no se elige ninguno.
  assert.deepEqual(PM.resoldreCodi('KK0Z2I', ['KKOZ2L', 'KK0Z21']), { codi: null, ambigu: true });
  assert.deepEqual(PM.resoldreCodi('', codis), { codi: null, ambigu: false });
});

test('analitzarCodis lista longitudes raras, números y choques al normalizar', () => {
  const r = PM.analitzarCodis(['ABC012', 'ABCO12', 'ABC012', 12345, 1.2e+30, 'ABCD', 'DEMO2026', ''], ['DEMO2026']);
  assert.deepEqual(r.numerics, ['12345', '1.2e+30']);
  assert.deepEqual(r.llargadaRara, ['ABCD']);
  assert.deepEqual(r.xocs, [['ABC012', 'ABCO12']]);
});

// --- Lo que ve el paciente ---

test('emmascararDni: DNI ***4567**, NIE ****4567*, otra cosa null', () => {
  assert.equal(PM.emmascararDni('12345678Z'), '***4567**');
  assert.equal(PM.emmascararDni('12.345.678-z'), '***4567**');
  assert.equal(PM.emmascararDni('X1234567L'), '****4567*');
  assert.equal(PM.emmascararDni(''), null);
  assert.equal(PM.emmascararDni('ABC'), null);
});

test('perAlPortal: lista blanca, nunca email ni Cuenta, DNI enmascarado solo si hay', () => {
  const fila = {
    codi_acces: 'ABC234', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat',
    sense_email: false, dni: '12345678Z', sense_dni: false, posicion: 11, fecha_colocacion: '15/01/2026',
    marca: 'Straumann', modelo: 'BLT', dimensiones: '4.1 x 10', plataforma: 'RC', conexion: 'CrossFit',
    pilar: 'No', cod_implante: '021.5310', lote: 'AB123', columna_futura: 'x'
  };
  const out = PM.perAlPortal(fila);
  assert.equal(out.nombre, 'Pere Vila');
  assert.equal(out.dni_parcial, '***4567**');
  assert.equal(out.posicion, '11');
  assert.equal(out.lote, 'AB123');
  ['email', 'cuenta_quartup', 'dni', 'sense_email', 'sense_dni', 'codi_acces', 'columna_futura'].forEach(k =>
    assert.equal(k in out, false, k + ' no debe salir'));

  const sinDni = PM.perAlPortal(Object.assign({}, fila, { dni: '', sense_dni: true }));
  assert.equal('dni_parcial' in sinDni, false);
  const marcado = PM.perAlPortal(Object.assign({}, fila, { sense_dni: true }));
  assert.equal('dni_parcial' in marcado, false);
});

test('perAlPortal formatea las fechas de Sheets', () => {
  const out = PM.perAlPortal({ nombre: 'A', fecha_colocacion: new Date(2026, 0, 15) });
  assert.equal(out.fecha_colocacion, '15/1/2026');
});

// --- Límite de intentos ---

function fakeCache() {
  const m = new Map();
  return {
    m,
    get: k => (m.has(k) ? m.get(k) : null),
    put: (k, v) => { m.set(k, String(v)); },
    remove: k => { m.delete(k); }
  };
}

test('límite: 20 fallos en la misma ventana pausan el portal y avisan una sola vez', () => {
  const cache = fakeCache();
  const ara = 1_000_000_000_000;
  let r;
  for (let i = 0; i < 19; i++) {
    r = PM.registrarIntentFallit(cache, ara + i);
    assert.equal(r.pausat, false);
  }
  assert.equal(PM.estaPausat(cache), false);
  r = PM.registrarIntentFallit(cache, ara + 19);
  assert.equal(r.pausat, true);
  assert.equal(r.nouAvis, true);
  assert.equal(PM.estaPausat(cache), true);
  r = PM.registrarIntentFallit(cache, ara + 20);
  assert.equal(r.nouAvis, false, 'el aviso no se repite');
});

test('límite: fallos en ventanas distintas no se suman', () => {
  const cache = fakeCache();
  const ara = 1_000_000_200_000;
  for (let i = 0; i < 15; i++) PM.registrarIntentFallit(cache, ara);
  const r = PM.registrarIntentFallit(cache, ara + PM.LIMIT.finestraSegons * 1000);
  assert.equal(r.pausat, false);
});

// --- Avís a la secretària y PDF ---

test('missatgePacient y enllacWhatsApp llevan el código y el portal', () => {
  const m = PM.missatgePacient({ nombre: 'Maria Roca', codi: 'ABC234' });
  assert.match(m, /Maria Roca/);
  assert.match(m, /ABC234/);
  assert.match(m, /clinicapiestellercom\.netlify\.app/);
  const wa = PM.enllacWhatsApp(m);
  assert.match(wa, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(wa.split('text=')[1]), m);
});

test('avisSecretaria: quién es (con DNI completo), mensaje y botón de WhatsApp, escapado', () => {
  const a = PM.avisSecretaria({ nombre: 'Maria <b>Roca</b>', cuenta_quartup: '43000222', dni: '12345678Z', codi: 'ABC234' });
  assert.match(a.assumpte, /Maria/);
  assert.match(a.html, /43000222/);
  assert.match(a.html, /12345678Z/);
  assert.match(a.html, /wa\.me/);
  assert.doesNotMatch(a.html, /<b>Roca<\/b>/);
  assert.match(a.text, /ABC234/);
});

test('htmlPasaporte: sin Cuenta ni email, con DNI parcial y Código de acceso, escapado', () => {
  const pacient = PM.perAlPortal({ nombre: 'Pere <i>Vila</i>', dni: '12345678Z', cuenta_quartup: '43000001', email: 'p@x.cat' });
  const implants = [PM.perAlPortal({ posicion: 21, marca: 'Nobel', modelo: 'Active', cod_implante: 'NB-1', lote: '<L9>' })];
  const html = PM.htmlPasaporte(pacient, implants, 'ABC234', '03/10/2026');
  assert.match(html, /Código de acceso/);
  assert.match(html, /ABC234/);
  assert.match(html, /\*\*\*4567\*\*/);
  assert.match(html, /&lt;L9&gt;/);
  assert.doesNotMatch(html, /43000001|p@x\.cat|id_quartup|Historial/);
  assert.doesNotMatch(html, /<i>Vila<\/i>/);
});
