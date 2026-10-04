// S6 - Recordatoris contra la hoja simulada: guardar desde el alta y el panel, uno activo
// por paciente, cerrar al reenviar (solo si ya toca y el envío ha ido bien), la ✕, la
// ventana, el aviso al abrir, la fusión de fichas y el color de la fila.
// El reloj del harness es fijo: ahoraMs() = 1000000000000 -> "hoy" es 2001-09-09.
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');
const RM = require('../src/RecordatoriModel.js');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');
const esData = v => Object.prototype.toString.call(v) === '[object Date]';
const pla = o => JSON.parse(JSON.stringify(o)); // objetos del contexto vm -> de este contexto

const H = PM.CAPCALERES;
const fila = o => PM.objecteAFila(Object.assign(PM.filaAObjecte([], {}), o), H);
const MARIA = { codi_acces: 'K7XH3P', cuenta_quartup: '43001234', nombre: 'Maria Puig', email: 'maria@x.cat', dni: '12345678Z' };
const JOAN = { codi_acces: 'J0AN22', cuenta_quartup: '43002222', nombre: 'Joan Mas', email: 'joan@x.cat', dni: '11111111H' };
const IMP = { fecha_colocacion: '12/09/2001', marca: 'Ticare', modelo: 'Inhex', conexion: 'Interna', cod_implante: 'T1', lote: 'L1' };
const AVUI = '2001-09-09';

function libro(recordatoris) {
  const sheets = [
    new FakeSheet('Pacientes', [
      H,
      fila(Object.assign({}, MARIA, IMP, { posicion: '25', pilar: '', pendent: true })),
      fila(Object.assign({}, MARIA, IMP, { posicion: '26', pilar: 'Multi-unit' })),
      fila(Object.assign({}, JOAN, IMP, { posicion: '11', pilar: 'Multi-unit' }))
    ]),
    new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Ticare', 'Inhex', 'Interna']])
  ];
  if (recordatoris) {
    sheets.push(new FakeSheet('Recordatoris', [RM.CAPCALERES].concat(recordatoris.map(r =>
      RM.CAPCALERES.map((h, i) => {
        const k = RM.COLUMNES[i].clau;
        return k === 'data' ? RM.aData(r.data) : (r[k] === undefined ? '' : r[k]);
      })))));
  }
  return new FakeSpreadsheet(sheets);
}

const rec = ss => {
  const sheet = ss.getSheetByName('Recordatoris');
  if (!sheet) return [];
  const rows = sheet.rows();
  const idx = RM.indexarCapcaleres(rows[0]);
  return rows.slice(1).map(f => RM.filaAObjecte(f, idx)).filter(o => o.codi_acces);
};

const NOU = {
  codi_acces: 'GENERAR', cuenta_quartup: '43005555', nombre: 'Anna Font', email: 'anna@x.cat', dni: '22222222J', sendEmail: 'false',
  implantes: [{ posicion: '14', fecha_colocacion: '2001-09-01', marca: 'Ticare', modelo: 'Inhex', pilar: 'A cabeza de implante' }]
};

test('alta con 🔔: crea la pestaña y un recordatorio Actiu; sin 🔔 no crea nada', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const sense = ctx.saveNewImplant(Object.assign({}, NOU, { cuenta_quartup: '43005556', dni: '33333333P' }));
  assert.equal(sense.ok, true, sense.message);
  assert.equal(ss.getSheetByName('Recordatoris'), null);

  const r = ctx.saveNewImplant(Object.assign({}, NOU, { recordatori: { data: '2002-01-01', motiu: '' } }));
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(JSON.parse(JSON.stringify(r.recordatori)), { accio: 'crear', data: '2002-01-01' });
  const [o] = rec(ss);
  assert.deepEqual([o.codi_acces, o.cuenta_quartup, o.nombre, o.data, o.motiu, o.estat, o.origen],
    [r.newCode, '43005555', 'Anna Font', '2002-01-01', RM.MOTIU_PER_DEFECTE, 'Actiu', 'manual']);
  assert.ok(esData(ss.getSheetByName('Recordatoris').get(2, RM.CAPCALERES.indexOf('Data d\'avís') + 1)));
  assert.equal(ctx.buscarPacient('43005555').data.recordatori.data, '2002-01-01');
  assert.equal(ctx.buscarPacient('43001234').data.recordatori, null);
});

test('alta: una fecha de recordatorio mala no guarda nada', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const antes = ss.getSheetByName('Pacientes').getLastRow();
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { recordatori: { data: '2002-02-31' } }));
  assert.equal(r.ok, false);
  assert.match(r.message, /no és vàlida/);
  assert.equal(ss.getSheetByName('Pacientes').getLastRow(), antes);
});

test('uno activo por paciente: el panel cambia la fecha del activo, y vaciarla lo cancela', () => {
  const ss = libro([{ codi_acces: 'K7XH3P', nombre: 'Maria Puig', data: '2002-01-01', motiu: 'x', estat: 'Actiu', origen: 'manual' }]);
  const { ctx } = cargarCodigo(ss);
  ss.seleccionar(ss.getSheetByName('Pacientes'), 2);
  assert.equal(ctx.carregarPanell().pacient.recordatori.dataText, '01/01/2002');

  let r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 2, posicion_esperada: '25' }], recordatori: { data: '2002-02-01', motiu: '2ªC: 4 meses', origen: 'escàner' } });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.recordatori.accio, 'actualitzar');
  assert.deepEqual(rec(ss).map(o => [o.data, o.motiu, o.estat, o.origen]), [['2002-02-01', '2ªC: 4 meses', 'Actiu', 'escàner']]);

  r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 2, posicion_esperada: '25' }], recordatori: { data: '' } });
  assert.equal(r.recordatori.accio, 'cancellar');
  assert.deepEqual(rec(ss).map(o => o.estat), ['Cancel·lat']);
  // Un formulario que no trae el bloque no toca nada.
  assert.equal(ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 2, posicion_esperada: '25' }] }).recordatori, null);
});

test('reenviar cierra el recordatorio que ya toca; uno de dentro de meses sigue activo', () => {
  const ss = libro([
    { codi_acces: 'K7XH3P', nombre: 'Maria Puig', data: '2001-09-01', estat: 'Actiu' },
    { codi_acces: 'J0AN22', nombre: 'Joan Mas', data: '2002-01-01', estat: 'Actiu' }
  ]);
  const { ctx } = cargarCodigo(ss);
  const OPC = { email: true, avisSiSenseEmail: true };
  const a = ctx.enviarPasaport('K7XH3P', OPC);
  assert.equal(a.emailSent, true);
  assert.deepEqual(pla(a.recordatoriTancat), { tancat: true, data: '01/09/2001' });
  // Panel: completarPanell guarda y después enviarPasaport envía (dos llamadas, S8).
  const c = ctx.completarPanell({ codi_acces: 'J0AN22', implantes: [{ fila: 4, posicion_esperada: '11' }] });
  assert.equal(c.ok, true, c.message);
  const b = ctx.enviarPasaport('J0AN22', OPC);
  assert.deepEqual(pla(b.recordatoriTancat), { tancat: false, data: '01/01/2002' });
  assert.deepEqual(rec(ss).map(o => o.estat), ['Fet', 'Actiu']);
  assert.ok(esData(rec(ss)[0].tancat));
});

test('si el envío falla, el recordatorio no se cierra', () => {
  const ss = libro([{ codi_acces: 'K7XH3P', data: '2001-09-01', estat: 'Actiu' }]);
  const { ctx } = cargarCodigo(ss, { gmailFalla: 'Service invoked too many times' });
  const r = ctx.enviarPasaport('K7XH3P', { email: true });
  assert.equal(r.emailSent, false);
  assert.equal(r.recordatoriTancat, null);
  assert.equal(rec(ss)[0].estat, 'Actiu');
});

test('cambiar la fecha y enviar en el mismo clic: manda la fecha nueva (no se cierra)', () => {
  const ss = libro([{ codi_acces: 'K7XH3P', data: '2001-09-01', estat: 'Actiu' }]);
  const { ctx } = cargarCodigo(ss);
  const r = ctx.completarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 2, posicion_esperada: '25' }], recordatori: { data: '2001-09-15' } });
  assert.equal(r.ok, true, r.message);
  // El panel pasa noTancarRecordatori cuando el guardado ha cambiado el recordatorio.
  const e = ctx.enviarPasaport('K7XH3P', { email: true, noTancarRecordatori: r.recordatori.accio !== 'cap' });
  assert.equal(e.emailSent, true);
  assert.equal(e.recordatoriTancat, null);
  assert.deepEqual(rec(ss).map(o => [o.data, o.estat]), [['2001-09-15', 'Actiu']]);
});

test('ventana: lista los activos (vencidos primero), la ✕ los pasa a Fet, Obrir abre el panel del paciente', () => {
  const ss = libro([
    { codi_acces: 'J0AN22', nombre: 'Joan Mas', data: '2002-01-01', estat: 'Actiu' },
    { codi_acces: 'K7XH3P', nombre: 'Maria Puig', cuenta_quartup: '43001234', data: '2001-09-01', motiu: '2ªC', estat: 'Actiu' },
    { codi_acces: 'ZZZ999', nombre: 'Vell', data: '2001-01-01', estat: 'Fet' }
  ]);
  const { ctx, sidebars, dialegs } = cargarCodigo(ss);
  ctx.obrirRecordatoris();
  assert.equal(dialegs[0].h.nom, 'Recordatoris');
  assert.equal(dialegs[0].titol, '🔔 Recordatoris');

  const l = ctx.llistarRecordatoris();
  assert.equal(l.ok, true, l.message);
  assert.deepEqual(pla(l.recordatoris).map(o => [o.codi_acces, o.vencut, o.dataText]), [['K7XH3P', true, '01/09/2001'], ['J0AN22', false, '01/01/2002']]);
  assert.equal(l.recordatoris[0].dies, -8);

  const o = ctx.obrirPacientDesdeRecordatori('k7xh3p');
  assert.deepEqual(pla(o), { ok: true, fila: 2 });
  assert.equal(sidebars[0].nom, 'PanelPendents');
  assert.equal(ctx.carregarPanell().pacient.codi_acces, 'K7XH3P');
  assert.match(ctx.obrirPacientDesdeRecordatori('NOPE00').message, /No hi ha cap implant/);

  assert.deepEqual(pla(ctx.tancarRecordatori('K7XH3P')), { ok: true, tancat: true });
  assert.deepEqual(pla(ctx.llistarRecordatoris().recordatoris).map(o => o.codi_acces), ['J0AN22']);
  assert.deepEqual(pla(ctx.tancarRecordatori('K7XH3P')), { ok: true, tancat: false });
});

test('al abrir la hoja: un aviso solo si hay recordatorios que ya tocan', () => {
  const ss = libro([
    { codi_acces: 'K7XH3P', nombre: 'Maria Puig', data: '2001-09-09', estat: 'Actiu' },
    { codi_acces: 'J0AN22', nombre: 'Joan Mas', data: '2002-01-01', estat: 'Actiu' }
  ]);
  const { ctx } = cargarCodigo(ss);
  assert.equal(ctx.avisarRecordatorisEnObrir_(), 1);
  assert.match(ss.toasts[0].msg, /Tens 1 recordatori per revisar: Maria Puig/);
  const buit = libro();
  assert.equal(cargarCodigo(buit).ctx.avisarRecordatorisEnObrir_(), 0);
  assert.equal(buit.toasts, undefined);
});

test('unir fichas: el recordatorio de la que desaparece pasa a la que se queda', () => {
  const ss = libro([{ codi_acces: 'J0AN22', nombre: 'Joan Mas', data: '2002-01-01', estat: 'Actiu' }]);
  ss.getSheetByName('Pacientes').getRange(5, 1, 1, H.length).setValues([fila(Object.assign({}, IMP,
    { codi_acces: 'JMAS01', cuenta_quartup: '', nombre: 'Joan Mas', email: 'joan@x.cat', dni: '', sense_dni: true, posicion: '21', pilar: 'Multi-unit' }))]);
  const { ctx } = cargarCodigo(ss);
  const r = ctx.fusionarPacients('JMAS01', 'J0AN22');
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(rec(ss).map(o => [o.codi_acces, o.estat]), [['JMAS01', 'Actiu']]);
});

test('color: regla propia idempotente para los vencidos, detrás de la de Pendent', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  ctx.saveNewImplant(Object.assign({}, NOU, { recordatori: { data: '2002-01-01' } }));
  const p = ss.getSheetByName('Pacientes');
  const formules = () => p.conditionalRules.map(r => r.formula);
  assert.equal(formules().length, 1);
  assert.match(formules()[0], /^=COUNTIFS\(INDIRECT\("Recordatoris!A:A"\),\$A2,INDIRECT\("Recordatoris!F:F"\),"Actiu",INDIRECT\("Recordatoris!D:D"\),"<="&TODAY\(\)\)>0$/);
  assert.equal(p.conditionalRules[0].background, '#ede9fe');
  // Guardar algo Pendent después: la regla de Pendent va delante.
  ctx.saveNewImplant(Object.assign({}, NOU, { cuenta_quartup: '43005557', dni: '44444444A', implantes: [Object.assign({}, NOU.implantes[0], { pendent: 'true' })] }));
  assert.equal(formules().length, 2);
  assert.match(formules()[0], /=TRUE$/);
  ctx.tancarRecordatori('NOPE00');
  ctx.desarPanell({ codi_acces: ctx.buscarPacient('43005555').data.codi_acces, implantes: [{ fila: 5, posicion_esperada: '14' }], recordatori: { data: '2002-02-01' } });
  assert.equal(formules().length, 2, 'idempotente');
  assert.match(formules()[1], /COUNTIFS/);
});

test('las funciones de los recordatorios son solo para el personal (ADR 0003)', () => {
  const ss = libro([{ codi_acces: 'K7XH3P', data: '2001-09-01', estat: 'Actiu' }]);
  const { ctx } = cargarCodigo(ss, { usuari: '' });
  ['llistarRecordatoris', 'tancarRecordatori', 'obrirRecordatoris', 'obrirPacientDesdeRecordatori'].forEach(fn => {
    assert.throws(() => ctx[fn]('K7XH3P'), /full de càlcul de la clínica/, fn);
  });
  assert.equal(rec(ss)[0].estat, 'Actiu');
});

test('revisión: el alta con 🔔 no se cierra con su propio envío (el sidebar envía después con enviar)', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { sendEmail: 'true', recordatori: { data: '2001-09-12' } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.enviar.noTancarRecordatori, true);
  const e = ctx.enviarPasaport(r.newCode, r.enviar);
  assert.equal(e.emailSent, true);
  assert.equal(e.recordatoriTancat, null);
  assert.deepEqual(rec(ss).map(o => o.estat), ['Actiu']);
  // Sin tocar el 🔔, el envío sí lo da por hecho (ya toca).
  assert.equal(ctx.saveNewImplant(Object.assign({}, NOU, { codi_acces: r.newCode, implantes: [Object.assign({}, NOU.implantes[0], { posicion: '15' })] })).enviar.noTancarRecordatori, false);
});

test('revisión: crear la pestaña Recordatoris no cambia la pestaña ni la fila seleccionadas', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  ss.seleccionar(ss.getSheetByName('Pacientes'), 3);
  const r = ctx.desarPanell({ codi_acces: 'K7XH3P', implantes: [{ fila: 3, posicion_esperada: '26' }], recordatori: { data: '2002-01-01' } });
  assert.equal(r.ok, true, r.message);
  assert.equal(ss.getActiveSheet().getName(), 'Pacientes');
  assert.equal(ctx.carregarPanell().filaSeleccionada, 3);
});

test('revisión: si el 🔔 falla, el guardado sigue siendo ok y lo dice', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  ss.insertSheet = () => { throw new Error('quota'); };
  const r = ctx.saveNewImplant(Object.assign({}, NOU, { recordatori: { data: '2002-01-01' } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.recordatori.accio, 'error');
  assert.match(r.recordatori.message, /quota/);
});
