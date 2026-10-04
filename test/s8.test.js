// S8 - Filas vaciadas a mano, margen de casillas, lectura del portal por código y guardar
// sin esperar al email, contra la hoja simulada.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');

const H = PM.CAPCALERES.slice();
const col = clau => H.indexOf(PM.COLUMNES.find(c => c.clau === clau).capcalera) + 1;
const fila = o => PM.objecteAFila(Object.assign(PM.filaAObjecte([], {}), o), H);
const IMP = { fecha_colocacion: '12/09/2026', marca: 'Ticare', modelo: 'Inhex', dimensiones: '4 x 10 mm', conexion: 'Interna', cod_implante: 'T1', lote: 'L1', pilar: 'Sin pilar' };
const MARIA = { codi_acces: 'K7XH3P', cuenta_quartup: '43001234', nombre: 'Maria Puig', email: 'maria@x.cat', dni: '12345678Z' };
const JOAN = { codi_acces: 'J2AN22', cuenta_quartup: '43002222', nombre: 'Joan Mas', email: 'joan@x.cat', dni: '11111111H' };
const BUIDA = H.map(() => '');

// Maria tiene filas separadas (2ª visita al final) y en medio hay una fila vaciada a mano.
function libro() {
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', [
      H,
      fila(Object.assign({}, MARIA, IMP, { posicion: '25' })),
      fila(Object.assign({}, JOAN, IMP, { posicion: '11' })),
      BUIDA,
      fila(Object.assign({}, JOAN, IMP, { posicion: '21' })),
      fila(Object.assign({}, MARIA, IMP, { posicion: '36' }))
    ]),
    new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Ticare', 'Inhex', 'Interna']])
  ]);
}
const pacientes = ss => ss.getSheetByName('Pacientes');

const NOU = {
  codi_acces: 'GENERAR', cuenta_quartup: '43005555', nombre: 'Anna Font', email: 'anna@x.cat', dni: '22222222J',
  sendEmail: 'true', implantes: [{ posicion: '14', fecha_colocacion: '2026-10-03', marca: 'Ticare', modelo: 'Inhex', pilar: 'Sin pilar' }]
};

test('filaBuida: celdas vacías y casillas sin marcar; cualquier dato la llena', () => {
  assert.equal(PM.filaBuida(['', false, null, undefined]), true);
  assert.equal(PM.filaBuida(['', true]), false);
  assert.equal(PM.filaBuida(['', 0]), false);
  assert.equal(PM.filaBuida([' x ']), false);
});

test('portal: lee solo las filas del paciente, también separadas, con el código tolerante', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss, { usuari: '' });
  const r = ctx.initiateLogin('k7xh3p');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.codi_acces, 'K7XH3P');
  assert.deepEqual([...r.implantes.map(i => i.posicion)], ['25', '36']);
  assert.equal(ctx.initiateLogin('J2AN22').implantes.length, 2);
  assert.equal(ctx.initiateLogin('NOPE00').ok, false);
});

test('portal: con O/0 o I/1 entra; dos códigos que chocan al normalizar no enseñan ninguno', () => {
  const ss = libro();
  pacientes(ss).getRange(3, col('codi_acces')).setValue('J2ANZZ');
  const { ctx } = cargarCodigo(ss, { usuari: '' });
  assert.equal(ctx.getPatientDataVerbose_('K7XH3P').found, true);
  pacientes(ss).getRange(5, col('codi_acces')).setValue('AB0C12');
  pacientes(ss).getRange(3, col('codi_acces')).setValue('ABOC12');
  const d = ctx.getPatientDataVerbose_('ab0ci2'); // I=1: vale para los dos
  assert.equal(d.found, false);
  assert.equal(d.ambigu, true);
});

test('PDF del portal: usa el login de hace un momento (memoria de 60 s) sin volver a leer la hoja', () => {
  const ss = libro();
  const { ctx, cache } = cargarCodigo(ss, { usuari: '' });
  assert.equal(ctx.initiateLogin('K7XH3P').ok, true);
  assert.ok(cache.has('LOGIN_K7XH3P'));
  const rebuts = [];
  ctx.pdfPasaport_ = implants => { rebuts.push(implants); return { getName: () => 'p.pdf', getBytes: () => [] }; };
  ctx.Utilities.base64Encode = () => 'pdf';
  // Si leyera la hoja, vería el nombre cambiado.
  pacientes(ss).getRange(2, col('nombre')).setValue('Canviat');
  assert.equal(ctx.pdfPortal_('K7XH3P').ok, true);
  assert.equal(rebuts[0][0].nombre, 'Maria Puig');
  // Pasado el minuto (sin memoria), lee la hoja.
  cache.delete('LOGIN_K7XH3P');
  ctx.pdfPortal_('K7XH3P');
  assert.equal(rebuts[1][0].nombre, 'Canviat');
});

test('guardar o completar un paciente borra su memoria del login: el portal ve lo nuevo', () => {
  const ss = libro();
  const { ctx, cache } = cargarCodigo(ss);
  ctx.initiateLogin('K7XH3P');
  assert.ok(cache.has('LOGIN_K7XH3P'));
  const r = ctx.saveNewImplant(Object.assign({}, NOU, MARIA, { sendEmail: 'false' }));
  assert.equal(r.ok, true, r.message);
  assert.equal(cache.has('LOGIN_K7XH3P'), false);

  ctx.initiateLogin('K7XH3P');
  ss.seleccionar(pacientes(ss), 2);
  assert.equal(ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 2, posicion_esperada: '25', pilar: 'Multi-unit' }] }).ok, true);
  assert.equal(cache.has('LOGIN_K7XH3P'), false);
});

test('guardar no envía: devuelve qué enviar y enviarPasaport lo envía en la 2ª llamada', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(NOU);
  assert.equal(r.ok, true, r.message);
  assert.equal(sent.length, 0, 'guardar no envía');
  assert.deepEqual(JSON.parse(JSON.stringify(r.enviar)), { email: true, avisSecretaria: false, noTancarRecordatori: false });

  const env = ctx.enviarPasaport(r.newCode, r.enviar);
  assert.equal(env.ok, true);
  assert.equal(env.emailSent, true);
  assert.equal(env.emailDesti, 'anna@x.cat');
  assert.equal(env.recordatoriTancat, null, 'sin S6 no hay recordatorio que cerrar');
  assert.equal(sent.length, 1);
});

test('enviarPasaport: si existe el cierre de recordatorios (S6) lo llama, salvo noTancarRecordatori', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const crides = [];
  ctx.tancarRecordatoriSiToca_ = (codi, env) => { crides.push([codi, env.emailSent]); return { tancat: true }; };
  assert.equal(ctx.enviarPasaport('K7XH3P', { email: true }).recordatoriTancat.tancat, true);
  assert.equal(ctx.enviarPasaport('K7XH3P', { email: true, noTancarRecordatori: true }).recordatoriTancat, null);
  assert.deepEqual(crides, [['K7XH3P', true]]);
});

test('guardar respeta las filas vaciadas en medio y escribe después de la última con datos', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'false' }));
  assert.equal(r.ok, true, r.message);
  assert.equal(pacientes(ss).get(4, col('nombre')), '', 'el hueco sigue vacío');
  assert.equal(pacientes(ss).get(7, col('nombre')), 'Anna Font');
  assert.equal(ctx.buscarPacient('43005555').data.n_implants, 1);
});

test('margen: casilla Pendent solo hasta 200 filas por debajo de los datos; si falta hoja, se añaden filas', () => {
  const ss = libro();
  const sh = pacientes(ss);
  sh.maxRows = 10; // hoja recortada
  const { ctx } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'false' }));
  assert.equal(r.ok, true, r.message);
  // 6 filas de datos + cabecera + 200 de margen
  assert.ok(sh.getMaxRows() >= 207, 'filas añadidas: ' + sh.getMaxRows());
  assert.ok(sh.checkboxes.has('207,' + col('pendent')));
  assert.equal(sh.checkboxes.has('208,' + col('pendent')), false, 'no más allá del margen');
});

test('prepararHoja_ ya no pone casillas hasta el final de la hoja', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'false', implantes: [Object.assign({}, NOU.implantes[0], { pendent: 'true' })] }));
  assert.equal(r.ok, true, r.message);
  assert.equal(pacientes(ss).checkboxes.has('900,' + col('pendent')), false);
  assert.equal(pacientes(ss).conditionalRules.length, 1, 'el naranja sí');
});

test('arreglarCodigosUndefined no inventa códigos para las filas vaciadas', () => {
  const ss = libro();
  pacientes(ss).getRange(5, col('codi_acces')).setValue('undefined');
  const { ctx } = cargarCodigo(ss);
  ctx.arreglarCodigosUndefined();
  assert.equal(pacientes(ss).get(4, col('codi_acces')), '', 'la fila vacía sigue vacía');
  assert.equal(pacientes(ss).get(5, col('codi_acces')), 'J2AN22', 'la rota recupera el de su paciente');
});

test('eliminarDuplicados: borra la fila repetida y deja las vaciadas en su sitio', () => {
  const ss = libro();
  const sh = pacientes(ss);
  sh.getRange(7, 1, 1, H.length).setValues([fila(Object.assign({}, MARIA, IMP, { posicion: '36' }))]);
  sh.getRange(8, 1, 1, H.length).setValues([BUIDA.map(() => false)]);
  const { ctx, alerts } = cargarCodigo(ss);
  ctx.eliminarDuplicados();
  assert.match(alerts[0][1], /eliminat 1 files/);
  assert.equal(sh.get(4, col('nombre')), '', 'el hueco sigue');
  assert.equal(sh.get(6, col('posicion')), '36');
  assert.equal(PM.filaBuida(H.map((_, i) => sh.get(7, i + 1))), true, 'la repetida ya no está');
});

test('retallarFilesBuides: deja las filas de datos + 200 de margen; nunca borra datos', () => {
  const ss = libro();
  const sh = pacientes(ss);
  sh.maxRows = 5000;
  for (let r = 7; r <= 5000; r += 7) sh.getRange(r, col('pendent')).setValue(false);
  const { ctx } = cargarCodigo(ss);
  assert.match(ctx.retallarFilesBuides(), /4794 files buides esborrades/);
  assert.equal(sh.getMaxRows(), 206); // 5 filas de datos + cabecera + 200
  assert.equal(sh.get(6, col('posicion')), '36');

  const ss2 = libro();
  pacientes(ss2).maxRows = 3000;
  pacientes(ss2).getRange(2500, col('nombre')).setValue('Algú perdut');
  const { ctx: ctx2 } = cargarCodigo(ss2);
  // Algo escrito muy abajo cuenta como dato: el margen se deja por debajo de eso.
  assert.match(ctx2.retallarFilesBuides(), /300 files buides esborrades/);
  assert.equal(pacientes(ss2).getMaxRows(), 2700);
  assert.equal(pacientes(ss2).get(2500, col('nombre')), 'Algú perdut');
});

test('Comprovar-ho tot cuenta implantes, no filas con casillas vacías', () => {
  const ss = libro();
  for (let r = 7; r <= 900; r++) pacientes(ss).getRange(r, col('pendent')).setValue(false);
  const { ctx, alerts } = cargarCodigo(ss);
  ctx.comprobarTodo();
  assert.match(alerts[0][1], /Base de dades: OK \(4 implants\)/);
});

test('menú: solo lo que usa la clínica, y Comprovar-ho tot dentro de Manteniment', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const items = [];
  const menu = nom => {
    const m = { nom, items: [] };
    m.addItem = (t, f) => { m.items.push([t, f]); return m; };
    m.addSeparator = () => m;
    m.addSubMenu = sub => { m.items.push([sub.nom, sub.items]); return m; };
    m.addToUi = () => { items.push(...m.items); };
    return m;
  };
  const getUi = ctx.SpreadsheetApp.getUi;
  ctx.SpreadsheetApp.getUi = () => Object.assign(getUi(), { createMenu: menu });
  ctx.onOpen();
  assert.deepEqual(items.map(i => i[1]).map(f => (Array.isArray(f) ? f.map(x => x[1]) : f)),
    ['showSidebar', 'obrirPanellPendents', 'obrirRecordatoris', 'autorizarCuenta', ['comprobarTodo']]);
});

test('mantenimiento desde el editor (sin interfaz de Sheets): funciona y el resultado va al registro', () => {
  const ss = libro();
  const logs = [];
  const { ctx } = cargarCodigo(ss, { senseUi: true });
  ctx.console = { log: m => logs.push(m) };
  assert.match(ctx.retallarFilesBuides(), /files buides esborrades|No hi ha res/);
  ctx.eliminarDuplicados();
  assert.ok(logs.some(l => /Neteja feta/.test(l)));
});

test('provarEntregabilitat: el email real del pasaporte de DEMO2026 a cada dirección de PROVA_EMAILS', () => {
  const ss = libro();
  pacientes(ss).getRange(2, col('codi_acces')).setValue('DEMO2026');
  pacientes(ss).getRange(6, col('codi_acces')).setValue('DEMO2026');
  const { ctx, sent } = cargarCodigo(ss, { senseUi: true, props: { PROVA_EMAILS: 'test-x@srv1.mail-tester.com, gabo@yahoo.com, no-es-email' } });
  ctx.console = { log() {} };
  const r = ctx.provarEntregabilitat();
  assert.deepEqual([...sent.map(e => e.to)], ['test-x@srv1.mail-tester.com', 'gabo@yahoo.com']);
  assert.doesNotMatch(sent[0].subject, /PROVA/, 'igual que el de un paciente');
  assert.match(sent[0].body, /DEMO2026/);
  assert.equal(r.length, 2);
});

test('avís de prova desde el editor: DEMO2026 a la primera dirección de PROVA_EMAILS', () => {
  const ss = libro();
  pacientes(ss).getRange(2, col('codi_acces')).setValue('DEMO2026');
  pacientes(ss).getRange(6, col('codi_acces')).setValue('DEMO2026');
  const { ctx, sent } = cargarCodigo(ss, { senseUi: true, props: { PROVA_EMAILS: 'gabo@yahoo.com' } });
  ctx.console = { log() {} };
  ctx.provarAvisSecretaria();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'gabo@yahoo.com');
  assert.match(sent[0].subject, /^\[PROVA\]/);
});

test('nombre de la clínica: remitente "Doctores Pi y Esteller" y en los textos y el PDF la forma completa', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.enviarPasaport('K7XH3P', { email: true });
  assert.equal(sent[0].options.name, 'Doctores Pi y Esteller');
  assert.match(sent[0].subject, /Clínica Dental Doctores Pi y Esteller/);
  assert.match(sent[0].body, /Clínica Dental Doctores Pi y Esteller/);
  assert.doesNotMatch(sent[0].options.htmlBody, /Drs\./);
  const PortalModel = require('../src/PortalModel.js');
  const html = PortalModel.htmlPasaporte({ nombre: 'Maria' }, [], 'K7XH3P', '04/10/2026');
  assert.match(html, /© Clínica Dental Doctores Pi y Esteller/);
});

test('memoria del login: escribir el código con O/0 o I/1 usa la misma clave, y guardar la borra', () => {
  const ss = libro();
  pacientes(ss).getRange(2, col('codi_acces')).setValue('AB0L2C');
  pacientes(ss).getRange(6, col('codi_acces')).setValue('AB0L2C');
  const { ctx, cache } = cargarCodigo(ss);
  assert.equal(ctx.initiateLogin('abo12c').ok, true);
  assert.equal([...cache.keys()].filter(k => k.startsWith('LOGIN_')).length, 1);
  ctx.saveNewImplant(Object.assign({}, NOU, MARIA, { codi_acces: 'AB0L2C', sendEmail: 'false' }));
  assert.equal([...cache.keys()].filter(k => k.startsWith('LOGIN_')).length, 0);
});

test('enviarPasaport: si cerrar el recordatorio falla, el envío ya hecho no se da por fallido', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.tancarRecordatoriSiToca_ = () => { throw new Error('boom'); };
  const r = ctx.enviarPasaport('K7XH3P', { email: true });
  assert.equal(r.ok, true);
  assert.equal(r.emailSent, true);
  assert.equal(r.recordatoriTancat, null);
  assert.equal(sent.length, 1);
});
