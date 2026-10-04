// S6 - RecordatoriModel: fechas, planificar el recordatorio de un paciente y la propuesta
// del escáner (P10d) con los textos reales de las fichas.
const test = require('node:test');
const assert = require('node:assert/strict');
const RM = require('../src/RecordatoriModel.js');

const MARIA = { codi_acces: 'K7XH3P', cuenta_quartup: '43001234', nombre: 'Maria Puig' };

test('aIso acepta Date, ISO y DD/MM/AAAA; rechaza fechas imposibles', () => {
  assert.equal(RM.aIso(new Date(2027, 1, 4)), '2027-02-04');
  assert.equal(RM.aIso('2027-02-04'), '2027-02-04');
  assert.equal(RM.aIso('4/2/2027'), '2027-02-04');
  assert.equal(RM.aIso('04/02/27'), '2027-02-04');
  assert.equal(RM.aIso('31/02/2027'), '');
  assert.equal(RM.aIso('mañana'), '');
  assert.equal(RM.aIso(''), '');
  assert.equal(RM.format('2027-02-04'), '04/02/2027');
});

test('sumar: meses de calendario (31/01 + 1 mes = 28/02), semanas y días', () => {
  assert.equal(RM.sumar('2026-10-04', 4, 'mesos'), '2027-02-04');
  assert.equal(RM.sumar('2027-01-31', 1, 'mesos'), '2027-02-28');
  assert.equal(RM.sumar('2026-12-30', 2, 'setmanes'), '2027-01-13');
  assert.equal(RM.sumar('2026-10-04', 15, 'dies'), '2026-10-19');
  assert.equal(RM.diesEntre('2026-10-04', '2026-10-19'), 15);
});

test('validar: sin fecha = quitarlo; motivo vacío = el de por defecto; fecha mala = error', () => {
  assert.deepEqual(RM.validar(undefined), { errors: [], recordatori: null });
  assert.deepEqual(RM.validar({ data: '' }).recordatori, { data: '', motiu: RM.MOTIU_PER_DEFECTE, origen: 'manual' });
  assert.deepEqual(RM.validar({ data: '2027-02-04', motiu: '  2ªC: 4 meses ', origen: 'escàner' }).recordatori,
    { data: '2027-02-04', motiu: '2ªC: 4 meses', origen: 'escàner' });
  assert.match(RM.validar({ data: '2027-13-40' }).errors[0], /no és vàlida/);
});

test('planificar: crea, actualiza el activo (uno por paciente), no hace nada si no cambia, cancela si se vacía', () => {
  const nou = RM.validar({ data: '2027-02-04' }).recordatori;
  const crear = RM.planificar([], nou, MARIA);
  assert.equal(crear.accio, 'crear');
  assert.equal(crear.objecte.estat, 'Actiu');
  assert.equal(crear.objecte.codi_acces, 'K7XH3P');

  const files = [
    { codi_acces: 'K7XH3P', data: '2026-01-01', motiu: 'vell', estat: 'Fet' },
    { codi_acces: 'k7xh3p', data: '2027-02-04', motiu: RM.MOTIU_PER_DEFECTE, estat: 'Actiu' }
  ];
  assert.equal(RM.planificar(files, nou, MARIA).accio, 'cap');
  const canvi = RM.planificar(files, RM.validar({ data: '2027-03-01' }).recordatori, MARIA);
  assert.deepEqual([canvi.accio, canvi.index, canvi.objecte.data], ['actualitzar', 1, '2027-03-01']);
  assert.deepEqual(RM.planificar(files, RM.validar({ data: '' }).recordatori, MARIA), { accio: 'cancellar', index: 1 });
  assert.equal(RM.planificar([], RM.validar({ data: '' }).recordatori, MARIA).accio, 'cap');
  assert.equal(RM.planificar(files, null, MARIA).accio, 'cap');
});

test('tancaAlReenviar: solo si ya toca o faltan 14 días o menos', () => {
  const r = d => ({ estat: 'Actiu', data: d });
  assert.equal(RM.tancaAlReenviar(r('2026-10-01'), '2026-10-04'), true);
  assert.equal(RM.tancaAlReenviar(r('2026-10-18'), '2026-10-04'), true);
  assert.equal(RM.tancaAlReenviar(r('2027-02-04'), '2026-10-04'), false);
  assert.equal(RM.tancaAlReenviar({ estat: 'Fet', data: '2026-10-01' }, '2026-10-04'), false);
  assert.equal(RM.tancaAlReenviar(null, '2026-10-04'), false);
});

test('llistaActius: solo activos, por fecha, con los vencidos marcados', () => {
  const files = [
    { codi_acces: 'A', data: '2026-12-01', estat: 'Actiu' },
    { codi_acces: 'B', data: '2026-09-01', estat: 'Actiu' },
    { codi_acces: 'C', data: '2026-08-01', estat: 'Fet' },
    { codi_acces: 'D', data: '2026-10-04', estat: 'Actiu' }
  ];
  const l = RM.llistaActius(files, '2026-10-04');
  assert.deepEqual(l.map(o => o.codi_acces), ['B', 'D', 'A']);
  assert.deepEqual(l.map(o => o.vencut), [true, true, false]);
  assert.deepEqual(RM.vencuts(files, '2026-10-04').map(o => o.codi_acces), ['B', 'D']);
});

test('pestaña por cabecera: columnas movidas o con alias', () => {
  const idx = RM.indexarCapcaleres(['Estat', 'Codi d\'accés', 'Data d\'avís', 'Motiu']);
  const o = RM.filaAObjecte(['Actiu', 'K7XH3P', new Date(2027, 1, 4), 'x'], idx);
  assert.deepEqual([o.estat, o.codi_acces, o.data, o.motiu, o.nombre], ['Actiu', 'K7XH3P', '2027-02-04', 'x', '']);
});

test('llegirTermini con las indicaciones de las fichas reales', () => {
  const t = s => { const r = RM.llegirTermini(s); return r && [r.n, r.unitat, r.dies]; };
  assert.deepEqual(t('2ªC: 4 meses'), [4, 'mesos', 120]);
  assert.deepEqual(t('canvi de pilars en 4 mesos'), [4, 'mesos', 120]);
  assert.deepEqual(t('Comp. impl: 4 meses'), [4, 'mesos', 120]);
  assert.deepEqual(t('Ctrol 25 semanas'), [25, 'setmanes', 175]);
  assert.deepEqual(t('Control: 15 dies'), [15, 'dies', 15]);
  assert.deepEqual(t('Control + S.P: 15 dies'), [15, 'dies', 15]);
  assert.deepEqual(t('Ctrol + Rx final: 3 meses'), [3, 'mesos', 90]);
  assert.deepEqual(t('Ctrl: 1 semana'), [1, 'setmanes', 7]);
  assert.equal(t('control amb Dr. Orriols'), null);
});

test('proposarSeguiment: la más larga de 1 mes o más, desde la fecha de colocación', () => {
  // Martínez Izquierdo: el control de 15 días no; la 2ª cirugía a los 4 meses sí.
  const p = RM.proposarSeguiment([{ text: 'Control + S.P: 15 dies' }, { text: '2ªC: 4 meses' }], '2019-10-15', '2026-10-04');
  assert.deepEqual([p.text, p.data], ['2ªC: 4 meses', '2020-02-15']);
  // Albo: 25 semanas gana a 4 meses.
  assert.equal(RM.proposarSeguiment(['Comp. impl: 4 meses', 'Ctrol 25 semanas'], '13/09/2021').text, 'Ctrol 25 semanas');
  // Lalaguna: solo el control de 15 días -> nada.
  assert.equal(RM.proposarSeguiment([{ text: 'Control: 15 dies' }], '2025-11-06'), null);
  // Sin fecha de colocación: desde hoy.
  assert.equal(RM.proposarSeguiment(['canvi de pilars en 4 mesos'], '', '2026-10-04').data, '2027-02-04');
  assert.equal(RM.proposarSeguiment(undefined, ''), null);
});
