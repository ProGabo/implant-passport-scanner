// S3 - Ciclo de vida de la ficha: planificarDesat (afegir / completar), Pendent y la
// propuesta de pendientes. Todo puro, sin hoja.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');
const PO = require('../src/PortalModel.js');

const H = PM.CAPCALERES.slice();
const fila = o => PM.objecteAFila(Object.assign(PM.filaAObjecte([], {}), o), H);
const PACIENT = { codi_acces: 'K7XH3P', cuenta_quartup: '43001234', nombre: 'Maria Puig', email: 'maria@x.cat', dni: '12345678Z' };
const IMP = { posicion: '25', fecha_colocacion: '2026-09-12', marca: 'Ticare', modelo: 'Inhex', dimensiones: '4 x 10 mm', conexion: 'Interna', cod_implante: 'T1', lote: 'L1' };

function hoja() {
  return [
    fila(Object.assign({}, PACIENT, IMP, { pilar: 'A cabeza de implante', pendent: true, que_falta: 'pilar definitiu' })),
    fila(Object.assign({}, PACIENT, IMP, { posicion: '26', pilar: '', pendent: true })),
    fila(Object.assign({}, PACIENT, IMP, { posicion: '36', fecha_colocacion: '2021-02-03', pilar: 'Multi-unit', pilar_altura: '2' })),
    fila({ codi_acces: 'ZZZ999', cuenta_quartup: '43009999', nombre: 'Pere Vila', email: 'pere@x.cat', dni: '87654321X', posicion: '11', pilar: 'Sin pilar' })
  ];
}

test('registro: Pendent es casilla de implante y Què falta texto; los dos se reconocen por cabecera', () => {
  const { idx } = PM.indexarCapcaleres(['Pendent', 'Què falta', 'Pendiente']);
  assert.equal(idx.pendent, 0);
  assert.equal(idx.que_falta, 1);
  assert.equal(PM.COLUMNES.find(c => c.clau === 'pendent').casella, true);
  assert.ok(PM.CLAUS_IMPLANT.includes('pendent') && PM.CLAUS_IMPLANT.includes('que_falta'));
  assert.ok(!PM.CLAUS_PACIENT.includes('pendent'));
});

test('pilarPendent: solo si es Pendent y el pilar está vacío', () => {
  assert.equal(PM.pilarPendent({ pendent: true, pilar: '' }), true);
  assert.equal(PM.pilarPendent({ pendent: 'TRUE', pilar: '  ' }), true);
  assert.equal(PM.pilarPendent({ pendent: true, pilar: 'A cabeza de implante' }), false);
  assert.equal(PM.pilarPendent({ pendent: false, pilar: '' }), false);
});

test('planificarDesat afegir: paciente nuevo -> codi vacío, filas con claves del registro y Pendent del formulario', () => {
  const r = PM.planificarDesat(H, hoja(), {
    codi_acces: 'GENERAR', cuenta_quartup: '43005555', nombre: 'Joan Mas', email: 'joan@x.cat', dni: '11111111H',
    implantes: [Object.assign({}, IMP, { pilar: 'A cabeza de implante', pendent: 'true', que_falta: 'canvi de pilars' }),
      Object.assign({}, IMP, { posicion: '24', pilar: 'Sin pilar' })]
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.mode, 'afegir');
  assert.equal(r.codi, '');
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].pendent, true);
  assert.equal(r.filas[0].que_falta, 'canvi de pilars');
  assert.equal(r.filas[1].pendent, false);
  assert.equal(r.filas[0].nombre, 'Joan Mas');
  assert.deepEqual(Object.keys(r.filas[0]).sort(), PM.COLUMNES.map(c => c.clau).sort());
  assert.deepEqual(r.totes, r.filas);
});

test('planificarDesat afegir: paciente existente -> totes = sus filas (rellenando huecos) + las nuevas', () => {
  const files = hoja();
  files[0][H.indexOf('Email')] = '';
  const r = PM.planificarDesat(H, files, Object.assign({}, PACIENT, { implantes: [Object.assign({}, IMP, { posicion: '27' })] }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.codi, 'K7XH3P');
  assert.equal(r.filas.length, 1);
  assert.equal(r.totes.length, 4);
  assert.equal(r.totes[0].email, 'maria@x.cat');
});

test('planificarDesat afegir: errores de validación, codi inexistente y sin implantes', () => {
  assert.match(PM.planificarDesat(H, hoja(), { codi_acces: 'NOPE00', implantes: [IMP] }).errors[0], /no existeix/);
  assert.ok(PM.planificarDesat(H, hoja(), { codi_acces: 'GENERAR', nombre: 'X', implantes: [IMP] }).errors.length > 0);
  assert.match(PM.planificarDesat(H, hoja(), Object.assign({}, PACIENT, { implantes: [] })).errors[0], /cap implant/);
});

test('planificarDesat: sin columnas Pendent/Què falta en la hoja, el valor del formulario se ve igual (vista previa)', () => {
  const sense = H.filter(h => h !== 'Pendent' && h !== 'Què falta');
  const files = hoja().map(f => f.filter((_, i) => H[i] !== 'Pendent' && H[i] !== 'Què falta'));
  const r = PM.planificarDesat(sense, files, Object.assign({}, PACIENT, { implantes: [Object.assign({}, IMP, { posicion: '27', pendent: true })] }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.totes[r.totes.length - 1].pendent, true);
  assert.equal(r.totes[0].pendent, false);
});

test('planificarDesat completar: solo cambia las claves que trae, en sus filas, y devuelve claus_tocades', () => {
  const r = PM.planificarDesat(H, hoja(), {
    mode: 'completar', codi_acces: 'k7xh3p',
    implantes: [{ fila: 3, posicion_esperada: '26', pilar: 'Multi-unit', pilar_altura: '3', pendent: false }]
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.mode, 'completar');
  assert.equal(r.codi, 'K7XH3P');
  assert.deepEqual(r.files_hoja, [3]);
  assert.deepEqual(r.claus_tocades, ['pilar', 'pilar_altura', 'pendent']);
  assert.equal(r.filas[0].pilar, 'Multi-unit');
  assert.equal(r.filas[0].pendent, false);
  assert.equal(r.filas[0].lote, 'L1'); // lo demás, tal cual
  assert.equal(r.totes.length, 3);
  assert.equal(r.totes[1].pilar, 'Multi-unit');
  assert.equal(r.totes[0].pendent, true); // la otra fila pendiente no se toca
});

test('planificarDesat completar: la fila cambiada, de otro paciente, repetida o inexistente -> error y nada', () => {
  const base = { mode: 'completar', codi_acces: 'K7XH3P' };
  const err = imps => PM.planificarDesat(H, hoja(), Object.assign({}, base, { implantes: imps })).errors.join(' ');
  assert.match(err([{ fila: 3, posicion_esperada: '27', pilar: 'X' }]), /ha canviat/);
  assert.match(err([{ fila: 5, posicion_esperada: '11', pilar: 'X' }]), /no és d'aquest pacient/);
  assert.match(err([{ fila: 3, pilar: 'X' }, { fila: 3, pilar: 'Y' }]), /dues vegades/);
  assert.match(err([{ fila: 40, pilar: 'X' }]), /no existeix/);
  const r = PM.planificarDesat(H, hoja(), Object.assign({}, base, { implantes: [{ fila: 3, posicion_esperada: '27', pilar: 'X' }] }));
  assert.deepEqual(r.filas, []);
  assert.deepEqual(r.files_hoja, []);
});

test('planificarDesat completar: datos de paciente solo rellenan huecos, validados uno a uno', () => {
  const files = hoja();
  [0, 1, 2].forEach(i => { files[i][H.indexOf('DNI')] = ''; files[i][H.indexOf('Cuenta Quartup')] = ''; });
  const imp = [{ fila: 3, posicion_esperada: '26', pilar: 'Multi-unit' }];
  // Una ficha antigua sin Cuenta ni DNI no impide completar el pilar.
  assert.deepEqual(PM.planificarDesat(H, files, { mode: 'completar', codi_acces: 'K7XH3P', implantes: imp }).errors, []);
  const r = PM.planificarDesat(H, files, { mode: 'completar', codi_acces: 'K7XH3P', dni: '12345678z', email: 'otro@x.cat', implantes: imp });
  assert.deepEqual(r.errors, []);
  assert.equal(r.paciente.dni, '12345678Z');
  assert.equal(r.paciente.email, 'maria@x.cat'); // ya tenía email: no se cambia
  assert.ok(r.totes.every(o => o.dni === '12345678Z'));
  assert.match(PM.planificarDesat(H, files, { mode: 'completar', codi_acces: 'K7XH3P', dni: 'xx', implantes: imp }).errors[0], /DNI no és vàlid/);
  assert.match(PM.planificarDesat(H, files, { mode: 'completar', codi_acces: 'K7XH3P', cuenta_quartup: '43009999', implantes: imp }).errors[0], /ja és de Pere Vila/);
});

test('portal: Pendent y Què falta nunca salen hacia el paciente', () => {
  const o = PM.filaAObjecte(hoja()[0], PM.indexarCapcaleres(H).idx);
  const p = PO.perAlPortal(o);
  assert.ok(!('pendent' in p));
  assert.ok(!('que_falta' in p));
  assert.ok(!PO.CAMPS_PORTAL.includes('pendent') && !PO.CAMPS_PORTAL.includes('que_falta'));
});

test('planificarDesat completar: claus_per_fila dice qué cambia cada fila', () => {
  const r = PM.planificarDesat(H, hoja(), { mode: 'completar', codi_acces: 'K7XH3P', implantes: [
    { fila: 2, posicion_esperada: '25', que_falta: 'x' },
    { fila: 3, posicion_esperada: '26', pilar: 'Multi-unit', pendent: false }
  ] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.claus_per_fila, [['que_falta'], ['pilar', 'pendent']]);
  assert.equal(PM.COLUMNES.find(c => c.clau === 'que_falta').text, true);
});
