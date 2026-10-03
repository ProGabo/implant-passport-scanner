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

function cargarCodigo(ss) {
  const sent = [];
  const alerts = [];
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      getUi: () => ({
        alert: (...a) => { alerts.push(a); return 'YES'; },
        ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
        Button: { YES: 'YES' }
      }),
      newDataValidation: () => ({ requireCheckbox() { return this; }, build() { return 'checkbox'; } })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '2026-10-03 10.00' },
    Session: { getScriptTimeZone: () => 'Europe/Madrid' },
    GmailApp: { sendEmail: (to, subject) => sent.push({ to, subject }) },
    Logger: { log() {} },
    CacheService: { getScriptCache: () => ({ put() {}, get() {}, remove() {} }) }
  };
  vm.createContext(ctx);
  // Mismo orden de carga que da igual en GAS: todos los archivos comparten el global.
  ['PacientModel.js', 'ScanEngine.js', 'Código.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });
  // Las sheets clonadas por copyTo se registran en el libro.
  FakeSheet.prototype.copyTo = function (book) {
    const c = new FakeSheet(this.name + ' (còpia)', this.rows());
    book.sheets.push(c);
    return c;
  };
  return { ctx, sent, alerts };
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

test('el portal recibe las claves estables y Sense email entra sin PIN', () => {
  const ss = libroAntiguo();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.migrarDadesS2();

  const datos = ctx.getPatientDataVerbose('aaa111');
  assert.equal(datos.found, true);
  const p = datos.implantes[0];
  assert.equal(p.cuenta_quartup, '43000001');
  assert.equal(p.nombre, 'Pere Vila');
  assert.equal(p.posicion, '11');
  assert.equal(p.cod_implante, '021.5310');

  const login = ctx.initiateLogin('BBB222');
  assert.equal(login.skipOTP, true);
  assert.equal(login.implantes.length, 2);
  assert.equal(sent.length, 0);
});

test('el código funciona también ANTES de migrar (cabeceras antiguas por alias)', () => {
  const ss = libroAntiguo();
  const { ctx } = cargarCodigo(ss);
  assert.equal(ctx.getPatientDataVerbose('AAA111').implantes[0].nombre, 'Pere Vila');
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'AAA111');
  assert.equal(ctx.initiateLogin('BBB222').skipOTP, true);
});
