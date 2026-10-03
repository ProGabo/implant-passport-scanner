// Ejecuta Código.js de verdad contra una hoja de Google simulada en memoria: migración,
// aplicar la revisión, alta, búsqueda y portal. Cubre la capa de I/O que los tests de
// PacientModel no ven (índices, formatos, casillas, filas escritas).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

// --- Hoja simulada -----------------------------------------------------------------

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    assert.equal(vals.length, this.nr, 'setValues: filas');
    vals.forEach((row, i) => {
      assert.equal(row.length, this.nc, 'setValues: columnas');
      row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v));
    });
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  getValue() { return this.sheet.get(this.r, this.c); }
  clearContent() { this.each((i, j) => this.sheet.set(i, j, '')); return this; }
  clearFormat() { this.each((i, j) => this.sheet.formats.delete(i + ',' + j)); return this; }
  clearDataValidations() { this.each((i, j) => this.sheet.checkboxes.delete(i + ',' + j)); return this; }
  setNumberFormat(f) { this.each((i, j) => this.sheet.formats.set(i + ',' + j, f)); return this; }
  setDataValidation() { this.each((i, j) => this.sheet.checkboxes.add(i + ',' + j)); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setNote() { return this; }
  getNumRows() { return this.nr; }
  removeDuplicates() {
    const seen = new Set();
    const rows = this.getValues().filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
    this.clearContent();
    rows.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j); }
}

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.cells = new Map();
    this.formats = new Map();
    this.checkboxes = new Set();
    this.maxCols = 26;
    (rows || []).forEach((row, i) => row.forEach((v, j) => this.set(i + 1, j + 1, v)));
  }
  get(r, c) { const v = this.cells.get(r + ',' + c); return v === undefined ? '' : v; }
  set(r, c, v) {
    // Como Sheets: en una celda con formato texto, un número se guarda como texto.
    if (this.formats.get(r + ',' + c) === '@' && typeof v === 'number') v = String(v);
    if (v === '' || v === null || v === undefined) this.cells.delete(r + ',' + c); else this.cells.set(r + ',' + c, v);
    if (c > this.maxCols) this.maxCols = c;
  }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return Math.max(this.getLastRow(), 1000); }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  setFrozenRows() {}
  autoResizeColumns() {}
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  rows() { return this.getDataRange().getValues(); }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getId() { return 'fake-id'; }
  getName() { return 'fake'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function cargarCodigo(ss, opts) {
  const o = opts || {};
  const sent = [];
  const alerts = [];
  const cache = new Map();
  const props = Object.assign({ ALERT_EMAIL: 'responsable@example.com' }, o.props);
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      getUi: () => {
        // Como Apps Script: desde el web app (visitante anónimo) no hay interfaz de Sheets.
        if (o.usuari === '') throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
        const prompts = o.prompts || [];
        return {
          alert: (...a) => { alerts.push(a); return 'YES'; },
          prompt: () => {
            const text = prompts.shift();
            return { getSelectedButton: () => (text === undefined ? 'CANCEL' : 'OK'), getResponseText: () => text || '' };
          },
          ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
          Button: { YES: 'YES', OK: 'OK' }
        };
      },
      newDataValidation: () => ({ requireCheckbox() { return this; }, build() { return 'checkbox'; } })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    Utilities: {
      formatDate: () => '2026-10-03 10.00',
      newBlob: (contingut, tipus, nom) => ({ contingut, tipus, nom, getAs: t => ({ tipus: t, nom, contingut, setName(n) { this.nom = n; return this; } }) })
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Madrid',
      // Panel y menú: la cuenta de la clínica. Visitante anónimo del web app: '' (opts.usuari).
      getActiveUser: () => {
        // Lo que pasó en vivo: sin el permiso userinfo.email, Google lanza en vez de dar el email.
        if (o.senseUserinfo) throw new Error('Specified permissions are not sufficient to call Session.getActiveUser. Required permissions: https://www.googleapis.com/auth/userinfo.email');
        return { getEmail: () => ('usuari' in o ? o.usuari : 'clinicapiesteller@gmail.com') };
      }
    },
    GmailApp: {
      sendEmail: (to, subject, body, options) => {
        if (o.gmailFalla) throw new Error(o.gmailFalla);
        sent.push({ to, subject, body, options: options || {} });
      },
      search: () => o.rebots || []
    },
    Logger: { log() {} },
    CacheService: { getScriptCache: () => ({
      put: (k, v) => { cache.set(k, String(v)); },
      get: k => (cache.has(k) ? cache.get(k) : null),
      remove: k => { cache.delete(k); }
    }) }
  };
  vm.createContext(ctx);
  // Mismo orden de carga que da igual en GAS: todos los archivos comparten el global.
  ['PacientModel.js', 'PortalModel.js', 'ScanEngine.js', 'Código.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });
  // Reloj fijo: el límite de intentos cuenta por ventanas de 10 minutos.
  ctx.ahoraMs = () => 1000000000000;
  // Las sheets clonadas por copyTo se registran en el libro.
  FakeSheet.prototype.copyTo = function (book) {
    const c = new FakeSheet(this.name + ' (còpia)', this.rows());
    book.sheets.push(c);
    return c;
  };
  return { ctx, sent, alerts, cache };
}

// --- Datos: la hoja tal como está antes de S2 ------------------------------------------

const ANTIGUES = ['Código', 'id_quartup', 'Nombre', 'Email', 'Posición', 'Fecha', 'Marca', 'Modelo',
  'Dimensiones', 'Plataforma', 'Conexión', 'Pilar', 'Código de implante', 'Lote'];
const fila = (codi, ident, nom, email, pos) =>
  [codi, ident, nom, email, pos, '15/01/2026', 'Straumann', 'BLT', '4.1 x 10 mm', 'RC', 'CrossFit', 'No', '021.5310', 'AB123'];

function libroAntiguo() {
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', [
      ANTIGUES,
      fila('AAA111', 43000001, 'Pere Vila', 'pere@x.cat', 11),
      fila('BBB222', '12345678Z', 'Maria Roca', '', 36),
      fila('BBB222', '12345678Z', 'Maria Roca', '', 46)
    ]),
    new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Straumann', 'BLT', 'CrossFit']])
  ]);
}

const IMPLANT = { posicion: '21', fecha_colocacion: '2026-10-03', marca: 'Nobel', modelo: 'Active', dimensiones: '4.3 x 11.5 mm',
  plataforma: 'RP', conexion: 'Cónica', pilar: 'No', cod_implante: 'NB-1', lote: 'L9' };

function objetosDe(ctx, sheet) {
  const rows = sheet.rows();
  const { idx } = ctx.PacientModel.indexarCapcaleres(rows[0]);
  return rows.slice(1).map(r => ctx.PacientModel.filaAObjecte(r, idx));
}

// --- Tests ------------------------------------------------------------------------------

test('migrarDadesS2 reordena, separa el DNI, marca Sense email y crea la revisión y la copia', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const sheet = ss.getSheetByName('Pacientes');
  assert.deepEqual(sheet.rows()[0], [...ctx.PacientModel.CAPCALERES]); // copia: otro realm (vm)
  const objs = objetosDe(ctx, sheet);
  assert.equal(objs.length, 3);
  assert.equal(objs[0].cuenta_quartup, '43000001');
  assert.equal(objs[1].dni, '12345678Z');
  assert.equal(objs[1].cuenta_quartup, '');
  assert.equal(objs[1].sense_email, true);
  assert.equal(objs[0].sense_email, false);

  // Casillas nativas en "Sense email" (columna 5) y texto en la Cuenta (columna 2).
  assert.ok(sheet.checkboxes.has('2,5'));
  assert.equal(sheet.formats.get('2,2'), '@');

  assert.ok(ss.sheets.some(s => s.name.startsWith('Còpia abans S2')));
  const rev = ss.getSheetByName('Revisió migració').rows();
  assert.equal(rev.length, 2);
  assert.equal(rev[1][0], 'BBB222');
  assert.equal(rev[1][3], 2);
});

test('aplicarCuentesRevisio escribe la Cuenta en todas las filas del paciente', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  ss.getSheetByName('Revisió migració').getRange(2, 7).setValue(43000077);
  ctx.aplicarCuentesRevisio();

  const maria = objetosDe(ctx, ss.getSheetByName('Pacientes')).filter(o => o.codi_acces === 'BBB222');
  assert.ok(maria.every(o => o.cuenta_quartup === '43000077'));
  assert.equal(ss.getSheetByName('Revisió migració').get(2, 8), '✅ Aplicada');
});

test('saveNewImplant da de alta un paciente nuevo con las columnas en su sitio', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000500', nombre: 'Anna Puig', email: 'anna@x.cat',
    sense_email: false, dni: '87654321x', sense_dni: false, sendEmail: 'true', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.match(res.newCode, /^[A-Z0-9]{6}$/);
  assert.equal(sent.length, 1);

  const anna = objetosDe(ctx, ss.getSheetByName('Pacientes')).find(o => o.nombre === 'Anna Puig');
  assert.equal(anna.cuenta_quartup, '43000500');
  assert.equal(anna.dni, '87654321X');
  assert.equal(anna.posicion, '21');
  assert.equal(anna.marca, 'Nobel');
  assert.equal(anna.lote, 'L9');
});

test('saveNewImplant bloquea una Cuenta repetida y un DNI en el campo Cuenta', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const base = { codi_acces: 'GENERAR', nombre: 'Algú', email: '', sense_email: true, dni: '', sense_dni: true, sendEmail: 'false', implantes: [IMPLANT] };

  const repetida = ctx.saveNewImplant(Object.assign({}, base, { cuenta_quartup: '43000001' }));
  assert.equal(repetida.ok, false);
  assert.match(repetida.message, /Pere Vila/);

  const dni = ctx.saveNewImplant(Object.assign({}, base, { cuenta_quartup: '12345678Z' }));
  assert.equal(dni.ok, false);
  assert.match(dni.message, /DNI/);
});

test('un paciente antiguo encontrado por DNI completa su Cuenta en todas sus filas al guardar', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const b = ctx.buscarPacient('12345678-z');
  assert.equal(b.found, true);
  assert.equal(b.encontradoPor, 'dni');
  assert.equal(b.data.codi_acces, 'BBB222');
  assert.equal(b.data.cuenta_quartup, '');
  assert.equal(b.data.sense_email, true);

  const res = ctx.saveNewImplant({
    codi_acces: 'BBB222', cuenta_quartup: '43000222', nombre: 'Maria Roca', email: '', sense_email: true,
    dni: '12345678Z', sense_dni: false, sendEmail: 'true', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.newCode, 'BBB222');
  assert.equal(sent.length, 0, 'Sense email: no se envía nada');

  const maria = objetosDe(ctx, ss.getSheetByName('Pacientes')).filter(o => o.codi_acces === 'BBB222');
  assert.equal(maria.length, 3);
  assert.ok(maria.every(o => o.cuenta_quartup === '43000222'));
  assert.equal(ctx.buscarPacient('43000222').data.codi_acces, 'BBB222');
});

test('buscarPacient busca solo en Cuenta, DNI y Codi d\'accés, y exacto', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  assert.equal(ctx.buscarPacient('aaa111').data.cuenta_quartup, '43000001');
  assert.equal(ctx.buscarPacient('Straumann').found, false);
  assert.equal(ctx.buscarPacient('4300000').found, false);
});

test('el portal recibe solo la lista blanca: ni email ni Cuenta, DNI enmascarado', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const datos = ctx.getPatientDataVerbose_('aaa111');
  assert.equal(datos.found, true);
  const p = datos.implantes[0];
  assert.equal(p.nombre, 'Pere Vila');
  assert.equal(p.posicion, '11');
  assert.equal(p.cod_implante, '021.5310');
  ['email', 'cuenta_quartup', 'dni', 'sense_email', 'sense_dni'].forEach(k => assert.equal(k in p, false, k));
  assert.equal('dni_parcial' in p, false, 'Pere no tiene DNI');

  const maria = ctx.getPatientDataVerbose_('BBB222').implantes[0];
  assert.equal(maria.dni_parcial, '***4567**');
});

test('login sin PIN: con email o sin él, entra directo y no se envía nada', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const pere = ctx.initiateLogin('AAA111'); // tiene email
  assert.equal(pere.ok, true);
  assert.equal(pere.implantes.length, 1);
  assert.equal(pere.codi_acces, 'AAA111');
  assert.equal('requiresOTP' in pere, false);
  assert.equal('maskedEmail' in pere, false);

  const maria = ctx.initiateLogin('BBB222'); // Sense email
  assert.equal(maria.implantes.length, 2);
  assert.equal(sent.length, 0);
  assert.equal(typeof ctx.verifyOTPAndGetData, 'undefined', 'el OTP ya no existe');
});

test('login tolerante: O/0, I/L/1, minúsculas y espacios', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const r = ctx.initiateLogin(' aaa l1I ');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.codi_acces, 'AAA111');
  assert.equal(ctx.initiateLogin('BBB-222').codi_acces, 'BBB222');
});

test('login: dos códigos que chocan al normalizar no enseñan ninguno', () => {
  const ss = libroAntiguo();
  const sheet = ss.getSheetByName('Pacientes');
  sheet.getRange(2, 1).setValue('KKOZ2L');
  sheet.getRange(3, 1).setValue('KK0Z21');
  sheet.getRange(4, 1).setValue('KK0Z21');
  const { ctx } = cargarCodigo(ss);
  const r = ctx.initiateLogin('KK0Z2I');
  assert.equal(r.ok, false);
  assert.match(r.message, /clínica/);
  assert.equal(ctx.initiateLogin('KK0Z21').implantes.length, 2, 'el exacto sí entra');
});

test('límite: 20 códigos fallidos pausan el portal y avisan una vez al responsable', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  for (let i = 0; i < 19; i++) {
    const r = ctx.initiateLogin('ZZZZ' + String(10 + i));
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.message, /Demasiados/);
  }
  assert.equal(sent.length, 0);
  assert.match(ctx.initiateLogin('ZZZZ99').message, /Demasiados intentos/);
  assert.match(ctx.initiateLogin('AAA111').message, /Demasiados intentos/, 'en pausa ni el bueno entra');
  ctx.initiateLogin('ZZZZ98');
  const avisos = sent.filter(s => s.to === 'responsable@example.com');
  assert.equal(avisos.length, 1);
  const registre = ss.getSheetByName("Registre d'enviaments").rows();
  assert.ok(registre.some(r => r.includes('alerta')));
});

test('límite: sin ALERT_EMAIL pausa igual y no falla', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss, { props: { ALERT_EMAIL: null } });
  for (let i = 0; i < 21; i++) ctx.initiateLogin('ZZZZ' + String(10 + i));
  assert.equal(sent.length, 0);
  assert.match(ctx.initiateLogin('AAA111').message, /Demasiados intentos/);
});

test('recuperar código: misma respuesta exista o no el email, y queda en el registro', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const si = ctx.retrieveCodeByEmail(' PERE@x.cat ');
  const no = ctx.retrieveCodeByEmail('nadie@x.cat');
  assert.equal(si.ok, true);
  assert.equal(no.ok, true);
  assert.equal(si.message, no.message);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'pere@x.cat');
  assert.match(sent[0].body, /AAA111/, 'lleva versión en texto plano');
  assert.match(sent[0].options.htmlBody, /AAA111/);
  const registre = ss.getSheetByName("Registre d'enviaments").rows();
  assert.deepEqual(registre[0], ['Data', 'Tipus', "Codi d'accés", 'Destinatari', 'Resultat', 'Detall']);
  assert.equal(registre[1][1], 'recuperació');
  assert.equal(registre[1][2], 'AAA111');
  assert.equal(registre[1][4], 'OK');
});

test('envío de pasaporte que falla: el sidebar recibe el error y queda en el registro', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss, { gmailFalla: 'Service invoked too many times for one day: email.' });
  ctx.migrarDadesS2();
  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000500', nombre: 'Anna Puig', email: 'anna@hotmail.com',
    sense_email: false, dni: '87654321x', sense_dni: false, sendEmail: 'true', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.emailSent, false);
  assert.match(res.emailError, /quota|cuota|límit/i);
  const fila = ss.getSheetByName("Registre d'enviaments").rows()[1];
  assert.equal(fila[1], 'pasaport');
  assert.equal(fila[3], 'anna@hotmail.com');
  assert.equal(fila[4], 'ERROR');
  assert.match(fila[5], /too many times/);
});

test('saveNewImplant genera códigos del alfabeto nuevo', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000501', nombre: 'Joan Mas', email: '', sense_email: true,
    dni: '', sense_dni: true, sendEmail: 'false', avisSecretaria: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.match(res.newCode, /^[A-HJKMNP-Z2-9]{6}$/);
});

test('Sense email + avís: email a la secretaria con quién es, WhatsApp y el PDF adjunto', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const res = ctx.saveNewImplant({
    codi_acces: 'BBB222', cuenta_quartup: '43000222', nombre: 'Maria Roca', email: '', sense_email: true,
    dni: '12345678Z', sense_dni: false, sendEmail: 'false', avisSecretaria: 'true', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.avisSecretaria.enviat, true);
  assert.equal(sent.length, 1);
  const e = sent[0];
  assert.equal(e.to, 'consulta@doctorpiurgell.com');
  assert.match(e.options.htmlBody, /43000222/);
  assert.match(e.options.htmlBody, /12345678Z/);
  assert.match(e.options.htmlBody, /wa\.me/);
  assert.equal(e.options.attachments.length, 1);
  const pdf = e.options.attachments[0];
  assert.equal(pdf.tipus, 'application/pdf');
  assert.match(pdf.nom, /\.pdf$/);
  assert.match(pdf.contingut, /Código de acceso/);
  assert.match(pdf.contingut, /\*\*\*4567\*\*/, 'el PDF lleva el DNI enmascarado');
  assert.equal(pdf.contingut.includes('43000222'), false, 'el PDF no lleva la Cuenta');
  const fila = ss.getSheetByName("Registre d'enviaments").rows()[1];
  assert.equal(fila[1], 'avís secretària');
});

test('Sense email con el avís desmarcado: no se envía nada', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const res = ctx.saveNewImplant({
    codi_acces: 'BBB222', cuenta_quartup: '43000222', nombre: 'Maria Roca', email: '', sense_email: true,
    dni: '12345678Z', sense_dni: false, sendEmail: 'false', avisSecretaria: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.avisSecretaria, null);
  assert.equal(sent.length, 0);
});

test('con email, el avís a la secretaria no se envía aunque llegue marcado', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  ctx.saveNewImplant({
    codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_email: false,
    dni: '', sense_dni: true, sendEmail: 'false', avisSecretaria: 'true', implantes: [IMPLANT]
  });
  assert.equal(sent.length, 0);
});

test('comprobarTodo lista los códigos rotos y los rebotes', () => {
  const ss = libroAntiguo();
  const sheet = ss.getSheetByName('Pacientes');
  sheet.getRange(2, 1).setValue(12345);
  sheet.getRange(3, 1).setValue('ABCO12');
  sheet.getRange(4, 1).setValue('ABC012');
  const rebot = {
    getMessages: () => [{
      getHeader: h => (h === 'X-Failed-Recipients' ? 'anna@hotmail.com' : ''),
      getPlainBody: () => '',
      getDate: () => new Date(2026, 9, 1)
    }]
  };
  const { ctx, alerts } = cargarCodigo(ss, { rebots: [rebot] });
  ctx.comprobarTodo();
  const text = alerts[0][1];
  assert.match(text, /12345/);
  assert.match(text, /ABCO12.*ABC012|ABC012.*ABCO12/);
  assert.match(text, /anna@hotmail\.com/);
});

test('visitante anónimo del web app: el portal funciona, el panel y el menú no', () => {
  const ss = libroAntiguo();
  const { ctx: intern } = cargarCodigo(ss);
  intern.migrarDadesS2();
  const { ctx, sent } = cargarCodigo(ss, { usuari: '' });

  assert.equal(ctx.initiateLogin('AAA111').ok, true);
  assert.equal(ctx.retrieveCodeByEmail('pere@x.cat').ok, true);

  const nuevo = { codi_acces: 'GENERAR', cuenta_quartup: '43000999', nombre: 'X', email: 'x@x.cat', sense_email: false,
    dni: '', sense_dni: true, sendEmail: 'true', implantes: [IMPLANT] };
  [
    () => ctx.buscarPacient('43000001'),
    () => ctx.comprovarCuenta('43000001', 'GENERAR'),
    () => ctx.saveNewImplant(nuevo),
    () => ctx.fusionarPacients('BBB222', 'AAA111'),
    () => ctx.corregirCuenta('AAA111', ''),
    () => ctx.getImplantOptions(),
    () => ctx.processImplantFile('data:image/png;base64,AAAA', 'x.png'),
    () => ctx.migrarDadesS2(),
    () => ctx.aplicarCuentesRevisio(),
    () => ctx.marcarSenseDniMenu(),
    () => ctx.migrarPilarsMenu(),
    () => ctx.eliminarDuplicados(),
    () => ctx.comprobarTodo(),
    () => ctx.registrarDuda(1),
    () => ctx.provarAvisSecretaria()
  ].forEach(f => assert.throws(f, /només es pot fer servir des del full/));
  assert.equal(sent.length, 1, 'solo la recuperación de código');
});

test('panel sin el permiso userinfo.email (como en vivo): funciona igual y no habla de autorizar', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss, { senseUserinfo: true });
  ctx.migrarDadesS2();
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'AAA111');
  ctx.comprobarTodo();
});

test('anónimo y sin permiso userinfo.email: bloqueado, sin la palabra "autoritzar"', () => {
  const { ctx } = cargarCodigo(libroAntiguo(), { usuari: '', senseUserinfo: true });
  assert.throws(() => ctx.buscarPacient('43000001'), err => !/autoriz/i.test(err.message) && /des del full/.test(err.message));
});

test('avís de prova: envía a la dirección indicada lo mismo que a la consulta, con [PROVA]', () => {
  const ss = libroAntiguo();
  const { ctx: intern } = cargarCodigo(ss);
  intern.migrarDadesS2();
  const { ctx, sent, alerts } = cargarCodigo(ss, { prompts: ['bbb-222', 'prova@example.com'] });
  ctx.provarAvisSecretaria();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'prova@example.com');
  assert.match(sent[0].subject, /^\[PROVA\] .*Maria Roca/);
  assert.match(sent[0].options.htmlBody, /BBB222/);
  assert.equal(sent[0].options.attachments.length, 1);
  assert.match(alerts[0][1], /Enviat a prova@example\.com/);
  assert.equal(ss.getSheetByName('Pacientes').rows().length, 4, 'no toca la hoja');
});

test('las funciones internas no se pueden llamar desde el portal (terminan en "_")', () => {
  const { ctx } = cargarCodigo(libroAntiguo());
  ['getPatientDataVerbose', 'sendPassportEmail', 'enviarAvisSecretaria', 'generarPasaportePDF', 'enviarEmail',
    'registrarEnviament', 'gasHttpFetch', 'updateCatalog', 'contarIntentoFallido', 'avisarLimitPortal']
    .forEach(n => {
      assert.equal(typeof ctx[n], 'undefined', n + ' debe ser privada');
      assert.equal(typeof ctx[n + '_'], 'function', n + '_');
    });
});

test('recuperar código: como mucho un email cada 15 minutos a la misma dirección', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  ctx.retrieveCodeByEmail('pere@x.cat');
  const r = ctx.retrieveCodeByEmail('PERE@x.cat');
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
});

test('el código funciona también ANTES de migrar (cabeceras antiguas por alias)', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  assert.equal(ctx.getPatientDataVerbose_('AAA111').implantes[0].nombre, 'Pere Vila');
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'AAA111');
  assert.equal(ctx.initiateLogin('BBB222').ok, true);
});

test('comprovarCuenta avisa en vivo si la Cuenta ya es de otra ficha', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const r = ctx.comprovarCuenta('43000001', 'GENERAR');
  assert.equal(r.lliure, false);
  assert.equal(r.altre.codi_acces, 'AAA111');
  assert.equal(r.altre.nombre, 'Pere Vila');
  assert.equal(ctx.comprovarCuenta('43000001', 'aaa111').lliure, true, 'su propia Cuenta no es conflicto');
  assert.equal(ctx.comprovarCuenta('43009999', 'GENERAR').lliure, true);
  assert.equal(ctx.comprovarCuenta('12345678Z', 'GENERAR').lliure, true, 'un DNI no se comprueba aquí');
});

test('fusionarPacients deja una sola ficha con el codi del DNI y el portal ve todos los implantes', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const res = ctx.fusionarPacients('BBB222', 'AAA111');
  assert.equal(res.ok, true, res.message);
  assert.equal(res.filesMogudes, 1);

  const sheet = ss.getSheetByName('Pacientes');
  const objs = objetosDe(ctx, sheet);
  assert.ok(objs.every(o => o.codi_acces === 'BBB222' && o.cuenta_quartup === '43000001' && o.dni === '12345678Z'));
  assert.equal(sheet.formats.get('2,2'), '@', 'la Cuenta sigue como texto');
  assert.equal(ctx.getPatientDataVerbose_('BBB222').implantes.length, 3);
  assert.equal(ctx.getPatientDataVerbose_('AAA111').found, false);
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'BBB222');
});

test('aplicarCuentesRevisio con "Unir" = SÍ fusiona; sin él explica cómo hacerlo', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const rev = ss.getSheetByName('Revisió migració');
  rev.getRange(2, 7).setValue('43000001');
  ctx.aplicarCuentesRevisio();
  assert.match(rev.get(2, 8), /^❌ .*Pere Vila.*Unir/);

  rev.getRange(2, 9).setValue('sí');
  ctx.aplicarCuentesRevisio();
  assert.match(rev.get(2, 8), /^✅ .*unida.*AAA111/);
  const objs = objetosDe(ctx, ss.getSheetByName('Pacientes'));
  assert.ok(objs.every(o => o.codi_acces === 'BBB222' && o.cuenta_quartup === '43000001'));
});

test('aplicarCuentesRevisio añade la columna "Unir" a una revisión creada antes de existir', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const rev = ss.getSheetByName('Revisió migració');
  rev.getRange(1, 9).setValue('');
  rev.getRange(2, 7).setValue('43000077');
  ctx.aplicarCuentesRevisio();
  assert.equal(rev.get(1, 9), 'Unir');
  assert.equal(rev.get(2, 8), '✅ Aplicada');
});

test('corregirCuenta cambia la Cuenta equivocada de otra ficha y libera la buena', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const res = ctx.corregirCuenta('AAA111', '43000111');
  assert.equal(res.ok, true, res.message);
  assert.equal(ctx.buscarPacient('43000111').data.codi_acces, 'AAA111');
  assert.equal(ctx.comprovarCuenta('43000001', 'BBB222').lliure, true);
  assert.equal(ss.getSheetByName('Pacientes').formats.get('2,2'), '@');
});

test('migrarPilarsMenu crea las columnas del pilar y pone al día los pilares antiguos', () => {
  const ss = libroAntiguo();
  const sheet = ss.getSheetByName('Pacientes');
  sheet.set(3, 12, 'Multi-unit 1.5 mm'); // Maria, 36
  const { ctx, alerts } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  ctx.migrarPilarsMenu();

  const objs = objetosDe(ctx, ss.getSheetByName('Pacientes'));
  assert.deepEqual(objs.map(o => [o.posicion, o.pilar, o.pilar_altura]),
    [[11, 'Sin pilar', ''], [36, 'Multi-unit', '1.5'], [46, 'Sin pilar', '']]);
  const headers = ss.getSheetByName('Pacientes').rows()[0];
  const { idx } = ctx.PacientModel.indexarCapcaleres(headers);
  // La alçada como texto: "1.5" no puede acabar siendo una fecha.
  assert.equal(ss.getSheetByName('Pacientes').formats.get('3,' + (idx.pilar_altura + 1)), '@');
  assert.match(alerts[alerts.length - 1][1], /3 files/);

  ctx.migrarPilarsMenu(); // idempotente
  assert.match(alerts[alerts.length - 1][1], /ja estan al dia/);
});

test('saveNewImplant guarda la pterigoidea y los detalles del pilar, y el portal los recibe', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  const pterigo = Object.assign({}, IMPLANT, {
    posicion: 'Fisura pterigoidea (cuadrante 2)', pilar: 'Multi-unit', pilar_altura: '5', pilar_angulacion: '30',
    pilar_marca: 'Ticare', pilar_conexion: 'Externa', pilar_ref: '0196'
  });
  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000600', nombre: 'Jordi Pla', email: '', sense_email: true,
    dni: '', sense_dni: true, sendEmail: 'false', implantes: [pterigo]
  });
  assert.equal(res.ok, true, res.message);

  const sheet = ss.getSheetByName('Pacientes');
  const jordi = objetosDe(ctx, sheet).find(o => o.nombre === 'Jordi Pla');
  assert.equal(jordi.posicion, 'Fisura pterigoidea (cuadrante 2)');
  assert.deepEqual([jordi.pilar, jordi.pilar_altura, jordi.pilar_angulacion, jordi.pilar_marca, jordi.pilar_conexion, jordi.pilar_ref],
    ['Multi-unit', '5', '30', 'Ticare', 'Externa', '0196']);
  const { idx } = ctx.PacientModel.indexarCapcaleres(sheet.rows()[0]);
  assert.equal(sheet.formats.get(sheet.getLastRow() + ',' + (idx.pilar_ref + 1)), '@'); // "0196" no pierde el 0

  // El portal (S5 lo mostrará) recibe la pterigoidea y los detalles del pilar
  // (están en la lista blanca CAMPS_PORTAL).
  const portal = JSON.stringify(ctx.getPatientDataVerbose_(res.newCode));
  assert.ok(portal.indexOf('"pilar_ref":"0196"') !== -1, portal.slice(0, 400));
  assert.ok(portal.indexOf('"pilar_angulacion":"30"') !== -1);
  assert.ok(portal.indexOf('Fisura pterigoidea (cuadrante 2)') !== -1);
});

test('marcarSenseDniMenu marca Sense DNI y el DNI que llega después lo desmarca', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  ctx.migrarDadesS2();
  ctx.marcarSenseDniMenu();
  let pere = objetosDe(ctx, ss.getSheetByName('Pacientes')).find(o => o.codi_acces === 'AAA111');
  assert.equal(pere.sense_dni, true);
  assert.equal(objetosDe(ctx, ss.getSheetByName('Pacientes')).find(o => o.codi_acces === 'BBB222').sense_dni, false);

  const res = ctx.saveNewImplant({
    codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_email: false,
    dni: '11111111H', sense_dni: false, sendEmail: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  const files = objetosDe(ctx, ss.getSheetByName('Pacientes')).filter(o => o.codi_acces === 'AAA111');
  assert.equal(files.length, 2);
  assert.ok(files.every(o => o.dni === '11111111H' && o.sense_dni === false));
});
