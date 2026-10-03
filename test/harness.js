// Hoja de Google simulada en memoria y carga de los archivos de src/ en un contexto vm,
// compartida por los tests que ejecutan Código.js de verdad (codigo.test.js, s3-*, s5-*).
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
  getSheets() { return this.sheets.slice(); }
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
      openById: id => (o.libres && o.libres[id]) || ss,
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
  // Todos los archivos comparten el global, como en GAS: primero los modelos (src/*Model.js,
  // en orden alfabético), luego el motor del escáner y por último Código.js.
  const models = fs.readdirSync(SRC).filter(f => /Model\.js$/.test(f)).sort();
  models.concat(['ScanEngine.js', 'Código.js']).forEach(f => {
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

module.exports = { FakeRange, FakeSheet, FakeSpreadsheet, cargarCodigo };
