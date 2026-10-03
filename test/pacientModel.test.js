const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');

// Cabeceras de la hoja real antes de S2 (castellano, identificador en `id_quartup`).
const ANTIGUES = ['Código', 'id_quartup', 'Nombre', 'Email', 'Posición', 'Fecha', 'Marca', 'Modelo',
  'Dimensiones', 'Plataforma', 'Conexión', 'Pilar', 'Código de implante', 'Lote'];

function filaAntiga(codi, ident, nom, email, posicio) {
  return [codi, ident, nom, email, posicio, new Date('2026-01-15'), 'Straumann', 'BLT',
    '4.1 x 10 mm', 'RC', 'CrossFit', 'No', '021.5310', 'AB123'];
}

// --- Registro de columnas ---

test('indexarCapcaleres reconoce las cabeceras antiguas por alias', () => {
  const { idx, desconegudes } = PM.indexarCapcaleres(ANTIGUES);
  assert.equal(idx.codi_acces, 0);
  assert.equal(idx.cuenta_quartup, 1);
  assert.equal(idx.nombre, 2);
  assert.equal(idx.posicion, 4);
  assert.equal(idx.fecha_colocacion, 5);
  assert.equal(idx.conexion, 10);
  assert.equal(idx.cod_implante, 12);
  assert.equal(idx.lote, 13);
  assert.deepEqual(desconegudes, []);
});

test('indexarCapcaleres reconoce las cabeceras nuevas en cualquier orden', () => {
  const desordenades = PM.CAPCALERES.slice().reverse().concat(['Notes']);
  const { idx, desconegudes } = PM.indexarCapcaleres(desordenades);
  PM.COLUMNES.forEach(c => {
    assert.equal(desordenades[idx[c.clau]], c.capcalera, c.clau);
  });
  assert.deepEqual(desconegudes, [desordenades.length - 1]);
});

test('filaAObjecte y objecteAFila son inversas sobre las cabeceras canónicas', () => {
  const obj = PM.filaAObjecte(['ABC123', '43001234', 'Anna', 'a@b.cat', false, '12345678Z', false], PM.indexarCapcaleres(PM.CAPCALERES).idx);
  assert.equal(obj.cuenta_quartup, '43001234');
  assert.equal(obj.sense_email, false);
  assert.equal(obj.lote, '');
  const fila = PM.objecteAFila(obj, PM.CAPCALERES);
  assert.equal(fila.length, PM.CAPCALERES.length);
  assert.equal(fila[1], '43001234');
  assert.equal(fila[5], '12345678Z');
});

test('las casillas aceptan TRUE de Sheets en cualquier forma', () => {
  assert.equal(PM.esCert(true), true);
  assert.equal(PM.esCert('TRUE'), true);
  assert.equal(PM.esCert('VERDADERO'), true);
  assert.equal(PM.esCert(false), false);
  assert.equal(PM.esCert(''), false);
});

// --- Clasificación del identificador ---

test('classificarIdentificador separa Cuenta, DNI, NIE y valores raros', () => {
  assert.equal(PM.classificarIdentificador('43001234'), 'cuenta');
  assert.equal(PM.classificarIdentificador(43001234), 'cuenta');
  assert.equal(PM.classificarIdentificador(' 43001234 '), 'cuenta');
  assert.equal(PM.classificarIdentificador('12345678A'), 'dni');
  assert.equal(PM.classificarIdentificador('12345678-a'), 'dni');
  assert.equal(PM.classificarIdentificador('X1234567L'), 'dni');
  assert.equal(PM.classificarIdentificador(''), 'buit');
  assert.equal(PM.classificarIdentificador(null), 'buit');
  assert.equal(PM.classificarIdentificador('abc'), 'revisar');
  assert.equal(PM.classificarIdentificador('4300-12'), 'revisar');
});

// --- Validación al guardar ---

const VALID = { cuenta_quartup: '43001234', nombre: 'Anna Puig', email: 'anna@exemple.cat', sense_email: false, dni: '12345678Z', sense_dni: false, codi_acces: 'GENERAR' };

test('validarPacient acepta un paciente completo', () => {
  assert.deepEqual(PM.validarPacient(VALID, []), { errors: [], avisos: [] });
});

test('validarPacient exige la Cuenta Quartup y rechaza un DNI en su lugar', () => {
  assert.equal(PM.validarPacient({ ...VALID, cuenta_quartup: '' }).errors.length, 1);
  const r = PM.validarPacient({ ...VALID, cuenta_quartup: '12345678Z' });
  assert.match(r.errors[0], /DNI/);
  assert.match(PM.validarPacient({ ...VALID, cuenta_quartup: '4300ab' }).errors[0], /xifres/);
});

test('validarPacient avisa sin bloquear si la Cuenta no empieza por 430', () => {
  const r = PM.validarPacient({ ...VALID, cuenta_quartup: '57000001' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.avisos.length, 1);
});

test('validarPacient bloquea una Cuenta que ya es de otro paciente', () => {
  const existents = [{ cuenta_quartup: '43001234', codi_acces: 'XYZ789', nombre: 'Joan' }];
  const nou = PM.validarPacient(VALID, existents);
  assert.match(nou.errors[0], /Joan/);
  // El mismo paciente (mismo código) puede volver a guardar con su Cuenta.
  assert.deepEqual(PM.validarPacient({ ...VALID, codi_acces: 'xyz789' }, existents).errors, []);
});

test('validarPacient: email y DNI obligatorios salvo con su casilla marcada', () => {
  assert.equal(PM.validarPacient({ ...VALID, email: '' }).errors.length, 1);
  assert.equal(PM.validarPacient({ ...VALID, email: 'no-es-email' }).errors.length, 1);
  assert.deepEqual(PM.validarPacient({ ...VALID, email: '', sense_email: true }).errors, []);
  assert.equal(PM.validarPacient({ ...VALID, dni: '' }).errors.length, 1);
  assert.equal(PM.validarPacient({ ...VALID, dni: '1234' }).errors.length, 1);
  assert.deepEqual(PM.validarPacient({ ...VALID, dni: '', sense_dni: true }).errors, []);
  assert.equal(PM.validarPacient({ ...VALID, nombre: ' ' }).errors.length, 1);
});

// --- Migración ---

function hojaMixta() {
  return [
    // Importado de Quartup: Cuenta correcta, con email, 2 implantes.
    filaAntiga('AAA111', '43000001', 'Pere Vila', 'pere@x.cat', '11'),
    filaAntiga('AAA111', '43000001', 'Pere Vila', 'pere@x.cat', '21'),
    // Dado de alta por la auxiliar con el DNI, sin email, 3 implantes.
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '36'),
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '46'),
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '47'),
    // NIE.
    filaAntiga('CCC333', 'X1234567L', 'Ahmed Ali', 'ahmed@x.com', '14'),
    // Valor raro.
    filaAntiga('DDD444', 'pendent', 'Lluís Font', 'lluis@x.cat', '24'),
    // Fila vacía (se descarta).
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '']
  ];
}

test('planificarMigracio reordena al formato canónico y separa los DNIs', () => {
  const plan = PM.planificarMigracio(ANTIGUES, hojaMixta());
  assert.deepEqual(plan.capcaleres, PM.CAPCALERES);
  assert.equal(plan.files.length, 7);

  const { idx } = PM.indexarCapcaleres(plan.capcaleres);
  const objs = plan.files.map(f => PM.filaAObjecte(f, idx));

  const pere = objs.filter(o => o.codi_acces === 'AAA111');
  assert.ok(pere.every(o => o.cuenta_quartup === '43000001' && o.dni === '' && o.sense_email === false));

  const maria = objs.filter(o => o.codi_acces === 'BBB222');
  assert.equal(maria.length, 3);
  assert.ok(maria.every(o => o.cuenta_quartup === '' && o.dni === '12345678Z' && o.sense_email === true && o.sense_dni === false));

  const ahmed = objs.find(o => o.codi_acces === 'CCC333');
  assert.equal(ahmed.dni, 'X1234567L');

  // El valor raro no se pierde: se queda visible en su sitio.
  assert.equal(objs.find(o => o.codi_acces === 'DDD444').cuenta_quartup, 'pendent');

  // Los datos de implante se conservan.
  assert.equal(maria[0].marca, 'Straumann');
  assert.ok(maria[0].fecha_colocacion instanceof Date);
});

test('planificarMigracio genera la revisión: una fila por paciente sin Cuenta o con valor raro', () => {
  const plan = PM.planificarMigracio(ANTIGUES, hojaMixta());
  assert.deepEqual(plan.revisio.map(r => r.codi_acces), ['BBB222', 'CCC333', 'DDD444']);
  const maria = plan.revisio[0];
  assert.equal(maria.nombre, 'Maria Roca');
  assert.equal(maria.dni, '12345678Z');
  assert.equal(maria.n_implants, 3);
  assert.equal(maria.valor_antic, '12345678Z');
  assert.match(plan.revisio[2].motiu, /estrany/);
  assert.deepEqual(plan.recompte, {
    files: 7, pacients: 4, mogutsADni: 4, senseCuenta: 2, senseEmail: 3, revisar: 1, columnesDesconegudes: []
  });
});

test('planificarMigracio completa la Cuenta/DNI que falta en alguna fila del mismo paciente', () => {
  const files = [
    filaAntiga('EEE555', '43000009', 'Rosa', 'r@x.cat', '11'),
    filaAntiga('EEE555', '12345678Z', 'Rosa', 'r@x.cat', '12')
  ];
  const plan = PM.planificarMigracio(ANTIGUES, files);
  const { idx } = PM.indexarCapcaleres(plan.capcaleres);
  const objs = plan.files.map(f => PM.filaAObjecte(f, idx));
  assert.ok(objs.every(o => o.cuenta_quartup === '43000009' && o.dni === '12345678Z'));
  assert.deepEqual(plan.revisio, []);
});

test('planificarMigracio marca a revisar un paciente con dos Cuentes distintas', () => {
  const files = [
    filaAntiga('FFF666', '43000001', 'Pau', 'p@x.cat', '11'),
    filaAntiga('FFF666', '43000002', 'Pau', 'p@x.cat', '12')
  ];
  const plan = PM.planificarMigracio(ANTIGUES, files);
  assert.equal(plan.revisio.length, 1);
  assert.match(plan.revisio[0].motiu, /més d'una/);
});

test('planificarMigracio conserva al final las columnas desconocidas', () => {
  const headers = ANTIGUES.concat(['Notes internes']);
  const files = [filaAntiga('AAA111', '43000001', 'Pere', 'p@x.cat', '11').concat(['revisat'])];
  const plan = PM.planificarMigracio(headers, files);
  assert.equal(plan.capcaleres[plan.capcaleres.length - 1], 'Notes internes');
  assert.equal(plan.files[0][plan.files[0].length - 1], 'revisat');
  assert.deepEqual(plan.recompte.columnesDesconegudes, ['Notes internes']);
});

test('planificarMigracio es idempotente', () => {
  const primera = PM.planificarMigracio(ANTIGUES, hojaMixta());
  const segona = PM.planificarMigracio(primera.capcaleres, primera.files);
  assert.deepEqual(segona.capcaleres, primera.capcaleres);
  assert.deepEqual(segona.files, primera.files);
  assert.deepEqual(segona.revisio, primera.revisio.map(r => ({ ...r, valor_antic: r.codi_acces === 'DDD444' ? 'pendent' : '' })));
});

test('planificarMigracio falla con un mensaje claro si no encuentra el identificador', () => {
  assert.throws(() => PM.planificarMigracio(['Código', 'Nombre', 'Email'], []), /cuenta_quartup/);
});

// --- Aplicar la revisión ---

test('aplicarRevisio escribe la Cuenta en todas las filas del paciente', () => {
  const plan = PM.planificarMigracio(ANTIGUES, hojaMixta());
  const r = PM.aplicarRevisio(plan.capcaleres, plan.files, [
    { codi_acces: 'BBB222', cuenta_quartup: 43000077 },
    { codi_acces: 'CCC333', cuenta_quartup: '' } // aún sin rellenar: se ignora
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.filesTocades, 3);
  const { idx } = PM.indexarCapcaleres(plan.capcaleres);
  const maria = r.files.map(f => PM.filaAObjecte(f, idx)).filter(o => o.codi_acces === 'BBB222');
  assert.ok(maria.every(o => o.cuenta_quartup === '43000077'));
});

test('aplicarRevisio rechaza DNIs, Cuentes repetidas y códigos que no existen', () => {
  const plan = PM.planificarMigracio(ANTIGUES, hojaMixta());
  const r = PM.aplicarRevisio(plan.capcaleres, plan.files, [
    { codi_acces: 'BBB222', cuenta_quartup: '12345678Z' },
    { codi_acces: 'CCC333', cuenta_quartup: '43000001' }, // ya es de Pere
    { codi_acces: 'DDD444', cuenta_quartup: '43000050' },
    { codi_acces: 'ZZZ999', cuenta_quartup: '43000051' }
  ]);
  assert.deepEqual(r.errors.map(e => e.codi_acces), ['BBB222', 'CCC333', 'ZZZ999']);
  assert.deepEqual(r.aplicats, [{ codi_acces: 'DDD444', cuenta_quartup: '43000050' }]);
});

test('pacientsUnics agrupa las filas-implante por Codi d\'accés', () => {
  const { idx } = PM.indexarCapcaleres(ANTIGUES);
  const ps = PM.pacientsUnics(hojaMixta().map(f => PM.filaAObjecte(f, idx)));
  assert.equal(ps.length, 4);
  assert.equal(ps[1].n_implants, 3);
});
