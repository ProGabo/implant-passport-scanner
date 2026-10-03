// S3 - Ciclo de vida de la ficha, contra la hoja simulada: guardar con Pendent, el panel
// "Completar i enviar", los envíos, la preparación de la hoja y la propuesta de pendientes.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');

const H = PM.CAPCALERES.concat(['Notes de la clínica']); // una columna ajena al registro
const fila = (o, nota) => PM.objecteAFila(Object.assign(PM.filaAObjecte([], {}), o), H).map((v, i) => (i === H.length - 1 ? nota || '' : v));
const MARIA = { codi_acces: 'K7XH3P', cuenta_quartup: '43001234', nombre: 'Maria Puig', email: 'maria@x.cat', dni: '12345678Z' };
const JOAN = { codi_acces: 'J0AN22', cuenta_quartup: '43002222', nombre: 'Joan Mas', email: '', sense_email: true, dni: '11111111H' };
const IMP = { fecha_colocacion: '12/09/2026', marca: 'Ticare', modelo: 'Inhex', dimensiones: '4 x 10 mm', conexion: 'Interna', cod_implante: 'T1', lote: 'L1' };

function libro() {
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', [
      H,
      fila(Object.assign({}, MARIA, IMP, { posicion: '25', pilar: 'A cabeza de implante', pendent: true, que_falta: 'pilar definitiu' }), 'nota 25'),
      fila(Object.assign({}, MARIA, IMP, { posicion: '26', pilar: '', pendent: true })),
      fila(Object.assign({}, MARIA, IMP, { posicion: '36', fecha_colocacion: '03/02/2021', pilar: 'Multi-unit' })),
      fila(Object.assign({}, JOAN, IMP, { posicion: '11', pilar: '', pendent: true }))
    ]),
    new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Ticare', 'Inhex', 'Interna']])
  ]);
}

const pacientes = ss => ss.getSheetByName('Pacientes');
const celda = (ss, n, clau) => pacientes(ss).get(n, H.indexOf(PM.COLUMNES.find(c => c.clau === clau).capcalera) + 1);

const NOU = {
  codi_acces: 'GENERAR', cuenta_quartup: '43005555', nombre: 'Anna Font', email: 'anna@x.cat', dni: '22222222J',
  implantes: [{ posicion: '14', fecha_colocacion: '2026-10-03', marca: 'Ticare', modelo: 'Inhex', pilar: 'A cabeza de implante', pendent: 'true', que_falta: 'canvi de pilars' }]
};

test('saveNewImplant: la fila nueva guarda Pendent y Què falta, prepara la hoja y no envía si no se pide', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'false' }));
  assert.equal(r.ok, true, r.message);
  assert.equal(celda(ss, 6, 'pendent'), true);
  assert.equal(celda(ss, 6, 'que_falta'), 'canvi de pilars');
  assert.equal(celda(ss, 6, 'codi_acces'), r.newCode);
  assert.ok(pacientes(ss).checkboxes.has('6,' + (H.indexOf('Pendent') + 1)));
  assert.equal(sent.length, 0);
  // Hoja preparada: naranja, desplegable de aviso en Pilar y pestaña "Pendents".
  const regla = pacientes(ss).conditionalRules[0];
  assert.equal(regla.formula, '=$' + String.fromCharCode(65 + H.indexOf('Pendent')) + '2=TRUE');
  assert.equal(regla.background, '#ffedd5');
  const desplegable = pacientes(ss).validations.get('2,' + (H.indexOf('Pilar') + 1));
  assert.deepEqual([...desplegable.llista], ['Multi-unit', 'A cabeza de implante', 'Sin pilar']);
  assert.equal(desplegable.allowInvalid, true);
  const formula = ss.getSheetByName('Pendents').getRange(2, 1).getFormula();
  assert.match(formula, /FILTER\(ARRAYFORMULA\(\{HYPERLINK\("#gid=\d+&range=A"&ROW\('Pacientes'!A2:A\),"Anar-hi"\)/);
  const lletra = String.fromCharCode(65 + H.indexOf('Pendent'));
  assert.ok(formula.includes("'Pacientes'!" + lletra + '2:' + lletra + '=TRUE'), formula);
});

test('saveNewImplant: con email y "Enviar" envía el pasaporte; queda en el registro y buscarPacient lo enseña', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'true', implantes: [{ posicion: '14', pilar: 'Sin pilar' }] }));
  assert.equal(r.emailSent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'anna@x.cat');
  assert.equal(pacientes(ss).conditionalRules.length, 0); // nada pendiente: la hoja no se toca
  const b = ctx.buscarPacient('43005555');
  assert.equal(b.data.ultimEnviament.tipus, 'pasaport');
  assert.equal(typeof b.data.ultimEnviament.ms, 'number');
  assert.equal(ctx.buscarPacient('43001234').data.ultimEnviament, null);
});

test('saveNewImplant: Sense email + avís -> solo el avís a la Secretària', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { email: '', sense_email: 'true', sendEmail: 'true', avisSecretaria: 'true' }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.emailSent, false);
  assert.equal(r.avisSecretaria.enviat, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'consulta@doctorpiurgell.com');
});

test('carregarPanell: el paciente de la fila seleccionada con sus pendientes (y la seleccionada), fechas como texto', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  ss.seleccionar(pacientes(ss), 4); // la 36, que no está pendiente
  const r = ctx.carregarPanell();
  assert.equal(r.ok, true, r.message);
  assert.equal(r.pacient.codi_acces, 'K7XH3P');
  assert.deepEqual([...r.files.map(f => f.fila)], [2, 3, 4]);
  assert.equal(r.files[0].que_falta, 'pilar definitiu');
  assert.equal(typeof r.files[0].fecha_colocacion, 'string');
  assert.equal(r.filaSeleccionada, 4);
  assert.ok(r.marques.includes('Ticare'));
  assert.equal('cuenta_quartup' in r.files[0], false); // solo claves de implante en las filas
});

test('carregarPanell: desde la pestaña Pendents (columna Fila), y errores claros fuera de una fila', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const pend = ss.insertSheet('Pendents');
  pend.set(2, 8, 5);
  ss.seleccionar(pend, 2);
  assert.equal(ctx.carregarPanell().pacient.codi_acces, 'J0AN22');
  ss.seleccionar(pacientes(ss), 1);
  assert.match(ctx.carregarPanell().message, /capçalera/);
  ss.seleccionar(ss.getSheetByName('Catálogo de Implantes'), 3);
  assert.match(ctx.carregarPanell().message, /Selecciona una fila/);
  ss.seleccionar(pacientes(ss), 40);
  assert.match(ctx.carregarPanell().message, /no té cap pacient/);
});

test('completarIEnviarPanell: escribe solo lo tocado, desmarca Pendent y envía el email', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const r = ctx.completarIEnviarPanell({ codi_acces: 'K7XH3P', implantes: [
    { fila: 2, posicion_esperada: '25', pilar: 'Multi-unit', pilar_altura: '3', pilar_ref: '0196', pendent: true }
  ] }, {});
  assert.equal(r.ok, true, r.message);
  assert.equal(r.emailSent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'maria@x.cat');
  assert.equal(celda(ss, 2, 'pilar'), 'Multi-unit');
  assert.equal(celda(ss, 2, 'pilar_ref'), '0196'); // texto: no pierde el 0
  assert.equal(celda(ss, 2, 'pendent'), false);
  assert.equal(celda(ss, 3, 'pendent'), true); // la otra pendiente no se toca
  assert.equal(celda(ss, 2, 'lote'), 'L1');
  assert.equal(pacientes(ss).get(2, H.length), 'nota 25'); // columna ajena intacta
});

test('completarIEnviarPanell: "Avisar també la secretària" con email -> email + avís; Sense email -> solo avís', () => {
  let ss = libro();
  let c = cargarCodigo(ss);
  let r = c.ctx.completarIEnviarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 3, posicion_esperada: '26', pilar: 'Sin pilar' }] }, { avisSecretaria: true });
  assert.equal(r.emailSent, true);
  assert.equal(r.avisSecretaria.enviat, true);
  assert.deepEqual(c.sent.map(s => s.to), ['maria@x.cat', 'consulta@doctorpiurgell.com']);

  ss = libro();
  c = cargarCodigo(ss);
  r = c.ctx.completarIEnviarPanell({ codi_acces: 'J0AN22', implantes: [{ fila: 5, posicion_esperada: '11', pilar: 'Multi-unit' }] }, {});
  assert.equal(r.ok, true, r.message);
  assert.equal(r.emailSent, false);
  assert.equal(r.avisSecretaria.enviat, true);
  assert.deepEqual(c.sent.map(s => s.to), ['consulta@doctorpiurgell.com']);
  assert.equal(celda(ss, 5, 'pendent'), false);
});

test('desarPanell: guarda sin enviar ni tocar Pendent; si la fila ha cambiado, error y nada escrito', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  let r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 3, posicion_esperada: '26', pilar: 'Multi-unit', que_falta: 'falta la REF' }] });
  assert.equal(r.ok, true, r.message);
  assert.equal(sent.length, 0);
  assert.equal(celda(ss, 3, 'pilar'), 'Multi-unit');
  assert.equal(celda(ss, 3, 'pendent'), true);
  assert.equal(celda(ss, 3, 'que_falta'), 'falta la REF');

  r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 3, posicion_esperada: '27', pilar: 'Sin pilar' }] });
  assert.equal(r.ok, false);
  assert.match(r.message, /ha canviat/);
  assert.equal(celda(ss, 3, 'pilar'), 'Multi-unit');
});

test('desarPanell: rellena el email que faltaba en todas las filas del paciente, sin pisar los que hay', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.desarPanell({ codi_acces: 'J0AN22', email: 'joan@x.cat', implantes: [{ fila: 5, posicion_esperada: '11', pilar: 'Multi-unit' }] });
  assert.equal(r.ok, true, r.message);
  assert.equal(celda(ss, 5, 'email'), 'joan@x.cat');
  assert.equal(celda(ss, 5, 'sense_email'), false);
  assert.equal(celda(ss, 2, 'email'), 'maria@x.cat');
});

test('enviarPasaportPanell: envía sin cambiar nada; codi inexistente -> error sin enviar', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  assert.equal(ctx.enviarPasaportPanell('k7xh3p', {}).emailSent, true);
  assert.equal(sent.length, 1);
  const r = ctx.enviarPasaportPanell('NOPE00', {});
  assert.equal(r.emailSent, false);
  assert.match(r.emailError, /No trobo/);
  assert.equal(sent.length, 1);
});

test('prepararHoja_ es idempotente y respeta las reglas de formato de la clínica', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const sheet = pacientes(ss);
  const propia = { formula: '=$C2="VIP"', getBooleanCondition: () => ({ getCriteriaValues: () => ['=$C2="VIP"'] }) };
  sheet.setConditionalFormatRules([propia]);
  ctx.prepararHoja_(sheet, H);
  ctx.prepararHoja_(sheet, H);
  assert.equal(sheet.conditionalRules.length, 2);
  assert.equal(sheet.conditionalRules[0], propia);
  assert.equal(ss.getSheets().filter(s => s.name === 'Pendents').length, 1);
});

test('Proposar / Aplicar pendents: propone los recientes con pilar vacío o +PC y marca los que se dejan marcados', () => {
  const ss = libro();
  const { ctx, alerts } = cargarCodigo(ss);
  ctx.ahoraMs = () => new Date(2026, 9, 3).getTime();
  // Ninguno marcado todavía, y uno nuevo sin pilar del mes pasado.
  [2, 3, 5].forEach(n => pacientes(ss).set(n, H.indexOf('Pendent') + 1, false));
  ctx.proposarPendentsMenu();
  const prop = ss.getSheetByName('Proposta pendents');
  assert.ok(prop, alerts.map(a => a.join(' ')).join('\n'));
  const rows = prop.rows();
  assert.deepEqual(rows.slice(1).map(r => r[0]), [2, 3, 5]); // la 36 (2021, Multi-unit) no
  assert.ok(rows.slice(1).every(r => r[7] === true));
  prop.set(3, 8, false); // la Auxiliar desmarca la fila 3
  ctx.aplicarPendentsMenu();
  assert.equal(celda(ss, 2, 'pendent'), true);
  assert.equal(celda(ss, 3, 'pendent'), false);
  assert.equal(celda(ss, 5, 'pendent'), true);
  assert.deepEqual(prop.rows().slice(1).map(r => r[8]), ['Marcat pendent', 'No marcat', 'Marcat pendent']);
  assert.match(alerts[alerts.length - 1][1], /Marcats com a pendents: 2/);
});

test('el panel y los menús de S3 son solo para el personal (ADR 0003)', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss, { usuari: '' });
  ['carregarPanell', 'desarPanell', 'completarIEnviarPanell', 'enviarPasaportPanell', 'obrirPanellPendents',
    'proposarPendentsMenu', 'aplicarPendentsMenu'].forEach(fn => {
    assert.throws(() => ctx[fn]({ codi_acces: 'K7XH3P', implantes: [] }), /full de càlcul de la clínica/, fn);
  });
});

test('obrirPanellPendents abre el sidebar del panel', () => {
  const ss = libro();
  const { ctx, sidebars } = cargarCodigo(ss);
  ctx.obrirPanellPendents();
  assert.equal(sidebars[0].nom, 'PanelPendents');
  assert.equal(sidebars[0].titol, 'Completar i enviar');
});

test('revisión: "Què falta" se guarda como texto (un "+PC..." no es una fórmula) en el alta y en el panel', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const col = H.indexOf('Què falta') + 1;
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'false', implantes: [Object.assign({}, NOU.implantes[0], { que_falta: '+PC, falta el pilar' })] }));
  assert.equal(r.ok, true, r.message);
  assert.equal(pacientes(ss).formats.get('6,' + col), '@');
  ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 3, posicion_esperada: '26', que_falta: '-canvi de pilars' }] });
  assert.equal(pacientes(ss).formats.get('3,' + col), '@');
  assert.equal(celda(ss, 3, 'que_falta'), '-canvi de pilars');
});

test('revisión: el panel solo escribe las celdas que cambia cada fila (una fecha de otra fila no se toca)', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const colData = H.indexOf('Data de col·locació') + 1;
  const data = new Date(2026, 8, 12);
  pacientes(ss).set(3, colData, data);
  const r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [
    { fila: 2, posicion_esperada: '25', fecha_colocacion: '13/09/2026' },
    { fila: 3, posicion_esperada: '26', pilar: 'Multi-unit' }
  ] });
  assert.equal(r.ok, true, r.message);
  assert.equal(pacientes(ss).get(3, colData), data); // el mismo objeto: no se ha reescrito
  assert.equal(celda(ss, 2, 'fecha_colocacion'), '13/09/2026');
  assert.equal(celda(ss, 2, 'pilar'), 'A cabeza de implante');
});

test('revisión: el resultado del envío dice a qué email se ha enviado', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.completarIEnviarPanell({ codi_acces: 'J0AN22', email: 'joan@x.cat', implantes: [{ fila: 5, posicion_esperada: '11' }] }, {});
  assert.equal(r.ok, true, r.message);
  assert.equal(r.emailSent, true);
  assert.equal(r.emailDesti, 'joan@x.cat');
});
