// S5: vista previa, PDF del servidor, portal y opciones del catálogo, ejecutando Código.js
// de verdad contra la hoja simulada.
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');
const PortalModel = require('../src/PortalModel.js');

// Hoja ya migrada (cabeceras de PacientModel) con dos pacientes.
function libro(ctx0) {
  const cap = [...ctx0.PacientModel.CAPCALERES];
  const fila = o => {
    const { idx } = ctx0.PacientModel.indexarCapcaleres(cap);
    const r = cap.map(() => '');
    Object.keys(o).forEach(k => { if (idx[k] !== undefined) r[idx[k]] = o[k]; });
    return r;
  };
  const base = { marca: 'Ticare', modelo: 'Inhex Quattro', conexion: 'Interna', plataforma: '4,1', dimensiones: '4,0 x 10',
    fecha_colocacion: '3/9/2026', cod_implante: 'HE41410', lote: '2301A' };
  const rows = [cap];
  // Muchos "Interna" de otros pacientes: vocabulario conocido.
  for (let i = 0; i < 8; i++) {
    rows.push(fila(Object.assign({}, base, { codi_acces: 'OTR00' + i, cuenta_quartup: '4300010' + i, nombre: 'Altre ' + i,
      email: 'a' + i + '@x.cat', posicion: '16', pilar: 'Sin pilar' })));
  }
  rows.push(fila(Object.assign({}, base, { codi_acces: 'ABC234', cuenta_quartup: '43000200', nombre: 'Àngels Núñez',
    email: 'angels@x.cat', dni: '12345678Z', posicion: '26', pilar: 'Multi-unit', pilar_angulacion: '30', pilar_altura: '5',
    pilar_ref: 'HE48865' })));
  rows.push(fila(Object.assign({}, base, { codi_acces: 'ABC234', cuenta_quartup: '43000200', nombre: 'Àngels Núñez',
    email: 'angels@x.cat', dni: '12345678Z', posicion: '14', pilar: '' })));
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', rows),
    new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Avinent', 'Inhex Quattro', 'Interan'], ['Ticare', 'Ocean', 'Interna']])
  ]);
}

function carregar(opts) {
  const { ctx: ctx0 } = cargarCodigo(new FakeSpreadsheet([]));
  const ss = libro(ctx0);
  const r = cargarCodigo(ss, opts);
  const dialegs = [];
  // "Hoy" para la regla de la fecha futura (el harness fija 2001).
  r.ctx.ahoraMs = () => new Date(2026, 9, 3, 12).getTime();
  // Servicios que el harness no simula: lo justo para la vista previa y el PDF.
  r.ctx.HtmlService = {
    createTemplateFromFile: nom => ({ nom, evaluate() { const t = this; return { setWidth() { return this; }, setHeight() { return this; }, t }; } }),
    createHtmlOutputFromFile: nom => ({ getContent: () => '<!-- ' + nom + ' -->' })
  };
  r.ctx.UrlFetchApp = { fetch: () => { throw new Error('sense xarxa als tests'); } };
  r.ctx.Utilities = Object.assign({}, r.ctx.Utilities, {
    formatDate: () => '03/10/2026',
    base64Encode: b => Buffer.from(String(b)).toString('base64'),
    newBlob: (contingut, tipus, nom) => ({
      getAs: () => ({ nom, contingut, setName(n) { this.nom = n; return this; }, getName() { return this.nom; }, getBytes() { return contingut; } })
    })
  });
  const getUi = r.ctx.SpreadsheetApp.getUi;
  r.ctx.SpreadsheetApp.getUi = () => Object.assign(getUi(), { showModelessDialog: (out, titol) => dialegs.push({ out, titol }) });
  return Object.assign(r, { ss, dialegs });
}

// Pacientes completos: planificarDesat (S3) valida igual que al guardar.
const ANGELS = { codi_acces: 'ABC234', cuenta_quartup: '43000200', nombre: 'Àngels Núñez', email: 'angels@x.cat',
  sense_email: false, dni: '12345678Z', sense_dni: false };
const NOVA = { codi_acces: 'GENERAR', cuenta_quartup: '43000999', nombre: 'Nou Pacient', email: 'nou@x.cat',
  sense_email: false, dni: '', sense_dni: true };
const fd = (pac, implantes, extra) => Object.assign({}, pac, extra || {}, { implantes });

const NOU = { posicion: '24', fecha_colocacion: '2026-10-01', marca: 'Ticare', modelo: 'Inhex Quattro', dimensiones: '3,75 x 11,5',
  plataforma: '3,5', conexion: 'Intrena', pilar: 'A cabeza de implante', cod_implante: 'HE37511', lote: '2302B' };

test('vista previa de un paciente existente: sus filas + las nuevas, ordenadas, con avisos y sin escribir nada', () => {
  const { ctx, ss, dialegs } = carregar();
  const abans = JSON.stringify(ss.getSheetByName('Pacientes').rows());
  const r = ctx.vistaPreviaPasaport(fd(ANGELS, [NOU]));
  assert.equal(r.ok, true, r.message);
  assert.equal(JSON.stringify(ss.getSheetByName('Pacientes').rows()), abans, 'la vista previa no escribe');
  assert.deepEqual([...r.avisos], ["Implant 24: la connexió «Intrena» s'assembla a «Interna» (8 vegades). Està ben escrit?"]);

  assert.equal(dialegs.length, 1);
  const t = dialegs[0].out.t;
  assert.equal(t.nom, 'VistaPreviaFinestra');
  // Orden por posición: 14, 24, 26. Sin email, Cuenta ni DNI completo.
  const html = t.pasaport;
  assert.ok(html.indexOf('>14<') < html.indexOf('>24<') && html.indexOf('>24<') < html.indexOf('>26<'), 'ordenado');
  assert.match(html, /Código de acceso<\/div>\s*<div[^>]*>ABC234/);
  assert.match(html, /\*\*\*4567\*\*/);
  assert.doesNotMatch(html, /angels@x\.cat|43000200|12345678Z/);
  assert.match(html, /Multi-unit · 30º · 5 mm · ref\. pilar HE48865/);
  assert.match(html, /Interna<br>plataforma&nbsp;4,1/);
  assert.doesNotMatch(html, /<html>/, 'dentro de la ventana va solo el cuerpo');
});

test('vista previa de un paciente nuevo: el codi "es generarà en desar" y lo de los demás cuenta como conocido', () => {
  const { ctx, dialegs } = carregar();
  const r = ctx.vistaPreviaPasaport(fd(NOVA, [Object.assign({}, NOU, { conexion: 'Interna' })]));
  assert.equal(r.ok, true, r.message);
  assert.deepEqual([...r.avisos], []);
  assert.match(dialegs[0].out.t.pasaport, /Código de acceso<\/div>\s*<div[^>]*>es generarà en desar/);
});

test('el formData no puede cerrar el <script> de la ventana', () => {
  const { ctx, dialegs } = carregar();
  ctx.vistaPreviaPasaport(fd(NOVA, [NOU], { nombre: '</script><script>alert(1)</script>' }));
  const json = dialegs[0].out.t.formDataJson;
  assert.doesNotMatch(json, /</);
  assert.equal(JSON.parse(json).nombre, '</script><script>alert(1)</script>');
  assert.doesNotMatch(dialegs[0].out.t.pasaport, /<script>alert/);
});

test('la vista previa solo se abre desde la hoja o el panel (ADR 0003)', () => {
  const { ctx } = carregar({ usuari: '' });
  assert.throws(() => ctx.vistaPreviaPasaport({ implantes: [NOU] }), /només es pot fer servir des del full/);
  assert.throws(() => ctx.pdfVistaPreviaPasaport({ implantes: [NOU] }), /només es pot fer servir des del full/);
});

test('pilar pendiente: casilla Pendent + pilar vacío -> "Pendiente de colocar"; nunca sale la casilla', () => {
  const { ctx } = carregar();
  const r = ctx.calcularVistaPrevia_(fd(NOVA, [
    Object.assign({}, NOU, { conexion: 'Interna', pilar: '', pendent: true, que_falta: 'el pilar definitiu' }),
    Object.assign({}, NOU, { conexion: 'Interna', posicion: '25', pilar: '' })
  ]));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.implants[0].pilar_texto, 'Pendiente de colocar');
  assert.equal(r.implants[1].pilar_texto, '');
  r.implants.forEach(i => {
    assert.equal('pendent' in i, false);
    assert.equal('que_falta' in i, false);
  });
});

test('portal: el PDF pasa por las mismas protecciones que la entrada', () => {
  const { ctx, cache } = carregar({ usuari: '' });
  const bo = ctx.pdfPortal_('abc 234');
  assert.equal(bo.ok, true, bo.message);
  assert.equal(bo.nom, 'Pasaporte_Àngels_Núñez.pdf');
  const html = Buffer.from(bo.base64, 'base64').toString();
  assert.match(html, /Pasaporte Implantológico/);
  assert.doesNotMatch(html, /angels@x\.cat|43000200|12345678Z/);

  const dolent = ctx.pdfPortal_('ZZZ999');
  assert.equal(dolent.ok, false);
  assert.equal(dolent.base64, undefined);
  assert.ok([...cache.keys()].some(k => k.startsWith('PORTAL_FALLITS_')), 'cuenta como intento fallido');
});

test('doPost: acción pdfPasaporte', () => {
  const { ctx } = carregar({ usuari: '' });
  ctx.ContentService = { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } };
  const out = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'pdfPasaporte', code: 'ABC234' }) } }).s);
  assert.equal(out.ok, true);
  assert.ok(out.base64.length > 100);
});

test('portal: los implantes llevan los textos ya escritos y salen ordenados', () => {
  const { ctx } = carregar({ usuari: '' });
  const r = ctx.initiateLogin('ABC234');
  assert.deepEqual(r.implantes.map(i => i.posicion), ['14', '26']);
  assert.equal(r.implantes[1].pilar_texto, 'Multi-unit · 30º · 5 mm · ref. pilar HE48865');
  assert.equal(r.implantes[1].implante_texto, 'Ticare Inhex Quattro');
  assert.equal(r.implantes[0].pilar_pendiente, false);
  // Lista blanca: solo lo que ya salía más lo derivado de S5.
  const permeses = new Set(['nombre', 'dni_parcial', ...PortalModel.CAMPS_PORTAL, 'pilar_pendiente', 'implante_texto', 'conexion_texto', 'pilar_texto']);
  r.implantes.forEach(i => Object.keys(i).forEach(k => assert.ok(permeses.has(k), 'clave inesperada: ' + k)));
});

test('getImplantOptions: modelos por marca desde la hoja y sin erratas del catálogo', () => {
  const { ctx } = carregar();
  const r = ctx.getImplantOptions();
  assert.equal(r.ok, true, r.message);
  assert.deepEqual([...r.options.brands], ['Avinent', 'Ticare']);
  assert.deepEqual([...r.options.modelsByBrand.Ticare], ['Inhex Quattro']);
  assert.deepEqual([...r.options.modelsByBrand.Avinent], []);
  assert.deepEqual([...r.options.allConnections], ['Interna']);
});

test('generarPasaportePDF_ (adjunto del avís) mantiene su firma y usa el mismo renderer', () => {
  const { ctx } = carregar();
  const b = ctx.generarPasaportePDF_('ABC234');
  assert.equal(b.getName(), 'Pasaporte_Àngels_Núñez.pdf');
  assert.match(b.getBytes(), /Registro de Implantes Colocados/);
  assert.match(b.getBytes(), /Multi-unit/);
});
