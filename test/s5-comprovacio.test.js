// S5: avisos antes de guardar (P2e) y opciones de los desplegables del catálogo.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/ComprovacioModel.js');

const AVUI = new Date(2026, 9, 3);

// La hoja: "Interna" muy usada, "Externa" algo, un error suelto "Interan" de otro paciente.
const HISTORIC = [];
for (let i = 0; i < 30; i++) HISTORIC.push({ marca: 'Ticare', modelo: 'Inhex Quattro', conexion: 'Interna' });
for (let i = 0; i < 5; i++) HISTORIC.push({ marca: 'Avinent', modelo: 'Ocean', conexion: 'Externa' });
HISTORIC.push({ marca: 'Ticare', modelo: 'Inhex Quattro', conexion: 'Interan' });

const BO = { posicion: '24', marca: 'Ticare', modelo: 'Inhex Quattro', conexion: 'Interna', dimensiones: '4,0 x 10',
  fecha_colocacion: '3/10/2026', cod_implante: 'HE41410', lote: '2301A' };

test('un implante correcto no da avisos', () => {
  assert.deepEqual(C.comprovarPasaport([BO], HISTORIC, { avui: AVUI }), []);
});

test('una conexión mal escrita avisa con la forma conocida, aunque el error ya esté en la hoja', () => {
  const av = C.comprovarPasaport([Object.assign({}, BO, { conexion: 'Interan' })], HISTORIC, { avui: AVUI });
  assert.deepEqual(av, ["Implant 24: la connexió «Interan» s'assembla a «Interna» (30 vegades). Està ben escrit?"]);
  // Un error que no está en la hoja.
  const av2 = C.comprovarPasaport([Object.assign({}, BO, { conexion: 'Intrena' })], HISTORIC, { avui: AVUI });
  assert.match(av2[0], /Implant 24: la connexió «Intrena» s'assembla a «Interna» \(30 vegades\)/);
});

test('mayúsculas o acentos distintos de la forma habitual avisan', () => {
  const av = C.comprovarPasaport([Object.assign({}, BO, { conexion: 'interna' })], HISTORIC, { avui: AVUI });
  assert.deepEqual(av, ["Implant 24: la connexió «interna» normalment s'escriu «Interna»."]);
});

test('una marca nunca vista avisa, y su modelo no (no hay con qué compararlo)', () => {
  const av = C.comprovarPasaport([Object.assign({}, BO, { marca: 'Straumann', modelo: 'BLT' })], HISTORIC, { avui: AVUI });
  assert.deepEqual(av, ["Implant 24: és la primera vegada que surt la marca «Straumann». Està ben escrit?"]);
});

test('el modelo se compara solo con los de su marca', () => {
  const av = C.comprovarPasaport([Object.assign({}, BO, { marca: 'Avinent', modelo: 'Inhex Quattro', conexion: 'Externa' })], HISTORIC, { avui: AVUI });
  assert.deepEqual(av, ["Implant 24: és la primera vegada que surt el model «Inhex Quattro». Està ben escrit?"]);
});

test('formatos: posición, repetida, medidas, fecha, Ref, lote y conexión del pilar', () => {
  const imps = [
    Object.assign({}, BO, { posicion: '19' }),
    Object.assign({}, BO, { posicion: 'Fisura pterigoidea (cuadrante 1)', dimensiones: '4 mm', fecha_colocacion: '31/2/2026' }),
    Object.assign({}, BO, { posicion: 'Fisura pterigoidea (cuadrante 1)', fecha_colocacion: '1/1/2027', cod_implante: '', lote: '' }),
    Object.assign({}, BO, { posicion: '', pilar_conexion: 'Hexágono' })
  ];
  const av = C.comprovarPasaport(imps, HISTORIC, { avui: AVUI });
  assert.deepEqual(av, [
    "Implant 19: la posició «19» no és una dent (11-48) ni una fisura pterigoidea.",
    "Implant Fisura pterigoidea (cuadrante 1): les mides «4 mm» no tenen la forma «4,0 x 10».",
    "Implant Fisura pterigoidea (cuadrante 1): no entenc la data «31/2/2026».",
    "Implant Fisura pterigoidea (cuadrante 1): hi ha dos implants a la mateixa posició.",
    "Implant Fisura pterigoidea (cuadrante 1): la data 1/1/2027 és futura.",
    "Implant Fisura pterigoidea (cuadrante 1): falta la Ref de l'implant.",
    "Implant Fisura pterigoidea (cuadrante 1): falta el lot de l'implant.",
    "Implant 4 (sense posició): falta la posició.",
    "Implant 4 (sense posició): la connexió del pilar és «Hexágono»; ha de ser Externa o Interna."
  ]);
});

test('fechas aaaa-mm-dd y Date también valen', () => {
  const av = C.comprovarPasaport([
    Object.assign({}, BO, { fecha_colocacion: '2026-09-13' }),
    Object.assign({}, BO, { posicion: '25', fecha_colocacion: new Date(2026, 8, 1) })
  ], HISTORIC, { avui: AVUI });
  assert.deepEqual(av, []);
});

test('opcionsImplant empareja marca y modelo desde la hoja, no desde las filas del catálogo', () => {
  // Catálogo "desordenado" como lo deja actualitzarCataleg_: cada columna ordenada aparte.
  const cataleg = { marques: ['Avinent', 'Ticare'], models: ['Inhex Quattro', 'Ocean'], connexions: ['Externa', 'Interna'] };
  const o = C.opcionsImplant(cataleg, [
    { marca: 'Ticare', modelo: 'Inhex Quattro', conexion: 'Interna' },
    { marca: 'ticare', modelo: 'Quattro', conexion: 'Interna' },
    { marca: 'Avinent', modelo: 'Ocean', conexion: 'Externa' },
    { marca: 'Noricum', modelo: '', conexion: 'Cónico Interno' }
  ]);
  assert.deepEqual(o.brands, ['Avinent', 'Noricum', 'Ticare']);
  assert.deepEqual(o.modelsByBrand.Ticare, ['Inhex Quattro', 'Quattro']);
  assert.deepEqual(o.modelsByBrand.Avinent, ['Ocean']);
  assert.deepEqual(o.modelsByBrand.Noricum, []);
  assert.deepEqual(o.allConnections, ['Cónico Interno', 'Externa', 'Interna']);
});

test('opcionsImplant no sugiere erratas que el catálogo aprendió', () => {
  const o = C.opcionsImplant({ marques: ['Ticare'], connexions: ['Interan', 'Interna', 'interna'] }, HISTORIC);
  assert.deepEqual(o.allConnections, ['Externa', 'Interna']);
});
