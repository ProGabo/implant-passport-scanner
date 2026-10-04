// Ejecuta Código.js de verdad contra una hoja de Google simulada en memoria: migración,
// aplicar la revisión, alta, búsqueda y portal. Cubre la capa de I/O que los tests de
// PacientModel no ven (índices, formatos, casillas, filas escritas).
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeSheet, FakeSpreadsheet, cargarCodigo } = require('./harness');

// --- Datos -------------------------------------------------------------------------------

const PM = require('../src/PacientModel.js');
const IMPLANT_HOJA = { fecha_colocacion: '15/01/2026', marca: 'Straumann', modelo: 'BLT', dimensiones: '4.1 x 10 mm',
  plataforma: 'RC', conexion: 'CrossFit', pilar: 'Sin pilar', cod_implante: '021.5310', lote: 'AB123' };
const filaNova = o => PM.objecteAFila(Object.assign(PM.filaAObjecte([], {}), IMPLANT_HOJA, o), PM.CAPCALERES);
const catalogo = () => new FakeSheet('Catálogo de Implantes', [['Marca', 'Modelo', 'Conexión'], ['Straumann', 'BLT', 'CrossFit']]);

// Pere: importado de Quartup, con Cuenta y email. Maria: dada de alta con el DNI, sin Cuenta ni email.
function libro() {
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', [
      PM.CAPCALERES.slice(),
      filaNova({ codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', posicion: '11' }),
      filaNova({ codi_acces: 'BBB222', nombre: 'Maria Roca', sense_email: true, dni: '12345678Z', posicion: '36' }),
      filaNova({ codi_acces: 'BBB222', nombre: 'Maria Roca', sense_email: true, dni: '12345678Z', posicion: '46' })
    ]),
    catalogo()
  ]);
}

// La hoja tal como estaba antes de S2: el código la sigue leyendo por alias de cabecera.
const ANTIGUES = ['Código', 'id_quartup', 'Nombre', 'Email', 'Posición', 'Fecha', 'Marca', 'Modelo',
  'Dimensiones', 'Plataforma', 'Conexión', 'Pilar', 'Código de implante', 'Lote'];
const fila = (codi, ident, nom, email, pos) =>
  [codi, ident, nom, email, pos, '15/01/2026', 'Straumann', 'BLT', '4.1 x 10 mm', 'RC', 'CrossFit', 'No', '021.5310', 'AB123'];

function libroCabecerasAntiguas() {
  return new FakeSpreadsheet([
    new FakeSheet('Pacientes', [
      ANTIGUES,
      fila('AAA111', 43000001, 'Pere Vila', 'pere@x.cat', 11),
      fila('BBB222', '12345678Z', 'Maria Roca', '', 36),
      fila('BBB222', '12345678Z', 'Maria Roca', '', 46)
    ]),
    catalogo()
  ]);
}

const IMPLANT = { posicion: '21', fecha_colocacion: '2026-10-03', marca: 'Nobel', modelo: 'Active', dimensiones: '4.3 x 11.5 mm',
  plataforma: 'RP', conexion: 'Cónica', pilar: 'No', cod_implante: 'NB-1', lote: 'L9' };

// Como el panel: guarda y, si ha ido bien, envía en una segunda llamada (enviarPasaport).
function desarIEnviar(ctx, formData) {
  const res = ctx.saveNewImplant(formData);
  return res.ok ? Object.assign({}, res, ctx.enviarPasaport(res.newCode, res.enviar)) : res;
}

function objetosDe(ctx, sheet) {
  const rows = sheet.rows();
  const { idx } = ctx.PacientModel.indexarCapcaleres(rows[0]);
  return rows.slice(1).map(r => ctx.PacientModel.filaAObjecte(r, idx));
}

// --- Tests ------------------------------------------------------------------------------

test('saveNewImplant da de alta un paciente nuevo con las columnas en su sitio', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);

  const res = desarIEnviar(ctx, {
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

test('saveNewImplant guarda justo después de la última fila con datos, aunque haya casillas vacías hasta abajo', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const sh = ss.getSheetByName('Pacientes');
  const ultima = sh.getLastRow();
  // Como "Pendent": casilla vacía (FALSE) hasta el final de la hoja.
  for (let r = ultima + 1; r <= 400; r++) sh.getRange(r, 1).setValue(false);

  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000501', nombre: 'Pau Vila', email: 'pau@x.cat',
    sense_email: false, dni: '', sense_dni: true, sendEmail: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  const files = sh.rows();
  const fila = files.findIndex(f => f.includes('Pau Vila')) + 1;
  assert.equal(fila, ultima + 1, 'en la siguiente fila libre, no al final de la hoja');
});

test('filesAmbDades: las casillas FALSE y las celdas vacías del final no cuentan', () => {
  const PM = require('../src/PacientModel.js');
  assert.equal(PM.filesAmbDades([['A', false], ['', true], [false, ''], ['', false]]), 2);
  assert.equal(PM.filesAmbDades([[false, ''], ['', null]]), 0);
});

test('saveNewImplant bloquea una Cuenta repetida y un DNI en el campo Cuenta', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const base = { codi_acces: 'GENERAR', nombre: 'Algú', email: '', sense_email: true, dni: '', sense_dni: true, sendEmail: 'false', implantes: [IMPLANT] };

  const repetida = ctx.saveNewImplant(Object.assign({}, base, { cuenta_quartup: '43000001' }));
  assert.equal(repetida.ok, false);
  assert.match(repetida.message, /Pere Vila/);

  const dni = ctx.saveNewImplant(Object.assign({}, base, { cuenta_quartup: '12345678Z' }));
  assert.equal(dni.ok, false);
  assert.match(dni.message, /DNI/);
});

test('un paciente antiguo encontrado por DNI completa su Cuenta en todas sus filas al guardar', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);

  const b = ctx.buscarPacient('12345678-z');
  assert.equal(b.found, true);
  assert.equal(b.encontradoPor, 'dni');
  assert.equal(b.data.codi_acces, 'BBB222');
  assert.equal(b.data.cuenta_quartup, '');
  assert.equal(b.data.sense_email, true);

  const res = desarIEnviar(ctx, {
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
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  assert.equal(ctx.buscarPacient('aaa111').data.cuenta_quartup, '43000001');
  assert.equal(ctx.buscarPacient('Straumann').found, false);
  assert.equal(ctx.buscarPacient('4300000').found, false);
});

test('el portal recibe solo la lista blanca: ni email ni Cuenta, DNI enmascarado', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);

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
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);

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
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.initiateLogin(' aaa l1I ');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.codi_acces, 'AAA111');
  assert.equal(ctx.initiateLogin('BBB-222').codi_acces, 'BBB222');
});

test('login: dos códigos que chocan al normalizar no enseñan ninguno', () => {
  const ss = libro();
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
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
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
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss, { props: { ALERT_EMAIL: null } });
  for (let i = 0; i < 21; i++) ctx.initiateLogin('ZZZZ' + String(10 + i));
  assert.equal(sent.length, 0);
  assert.match(ctx.initiateLogin('AAA111').message, /Demasiados intentos/);
});

test('recuperar código: misma respuesta exista o no el email, y queda en el registro', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
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
  const ss = libro();
  const { ctx } = cargarCodigo(ss, { gmailFalla: 'Service invoked too many times for one day: email.' });
  const res = desarIEnviar(ctx, {
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
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const res = ctx.saveNewImplant({
    codi_acces: 'GENERAR', cuenta_quartup: '43000501', nombre: 'Joan Mas', email: '', sense_email: true,
    dni: '', sense_dni: true, sendEmail: 'false', avisSecretaria: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.match(res.newCode, /^[A-HJKMNP-Z2-9]{6}$/);
});

test('Sense email + avís: email a la secretaria con quién es, WhatsApp y el PDF adjunto', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const res = desarIEnviar(ctx, {
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
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  const res = desarIEnviar(ctx, {
    codi_acces: 'BBB222', cuenta_quartup: '43000222', nombre: 'Maria Roca', email: '', sense_email: true,
    dni: '12345678Z', sense_dni: false, sendEmail: 'false', avisSecretaria: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.avisSecretaria, null);
  assert.equal(sent.length, 0);
});

test('con email, el avís a la secretaria no se envía aunque llegue marcado', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  desarIEnviar(ctx, {
    codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_email: false,
    dni: '', sense_dni: true, sendEmail: 'false', avisSecretaria: 'true', implantes: [IMPLANT]
  });
  assert.equal(sent.length, 0);
});

test('comprobarTodo lista los códigos rotos y los rebotes', () => {
  const ss = libro();
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
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss, { usuari: '' });

  assert.equal(ctx.initiateLogin('AAA111').ok, true);
  assert.equal(ctx.retrieveCodeByEmail('pere@x.cat').ok, true);

  const nuevo = { codi_acces: 'GENERAR', cuenta_quartup: '43000999', nombre: 'X', email: 'x@x.cat', sense_email: false,
    dni: '', sense_dni: true, sendEmail: 'true', implantes: [IMPLANT] };
  [
    () => ctx.buscarPacient('43000001'),
    () => ctx.comprovarCuenta('43000001', 'GENERAR'),
    () => ctx.saveNewImplant(nuevo),
    () => ctx.enviarPasaport('AAA111', { email: true }),
    () => ctx.fusionarPacients('BBB222', 'AAA111'),
    () => ctx.corregirCuenta('AAA111', ''),
    () => ctx.getImplantOptions(),
    () => ctx.processImplantFile('data:image/png;base64,AAAA', 'x.png'),
    () => ctx.eliminarDuplicados(),
    () => ctx.comprobarTodo(),
    () => ctx.registrarDuda(1),
    () => ctx.provarAvisSecretaria()
  ].forEach(f => assert.throws(f, /només es pot fer servir des del full/));
  assert.equal(sent.length, 1, 'solo la recuperación de código');
});

test('panel sin el permiso userinfo.email (como en vivo): funciona igual y no habla de autorizar', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss, { senseUserinfo: true });
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'AAA111');
  ctx.comprobarTodo();
});

test('anónimo y sin permiso userinfo.email: bloqueado, sin la palabra "autoritzar"', () => {
  const { ctx } = cargarCodigo(libro(), { usuari: '', senseUserinfo: true });
  assert.throws(() => ctx.buscarPacient('43000001'), err => !/autoriz/i.test(err.message) && /des del full/.test(err.message));
});

test('avís de prova: envía a la dirección indicada lo mismo que a la consulta, con [PROVA]', () => {
  const ss = libro();
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
  const { ctx } = cargarCodigo(libro());
  ['getPatientDataVerbose', 'sendPassportEmail', 'enviarAvisSecretaria', 'generarPasaportePDF', 'enviarEmail',
    'registrarEnviament', 'gasHttpFetch', 'actualitzarCataleg', 'contarIntentoFallido', 'formaFull', 'iniciDiag', 'desarDiag', 'avisarLimitPortal']
    .forEach(n => {
      assert.equal(typeof ctx[n], 'undefined', n + ' debe ser privada');
      assert.equal(typeof ctx[n + '_'], 'function', n + '_');
    });
});

test('recuperar código: como mucho un email cada 15 minutos a la misma dirección', () => {
  const ss = libro();
  const { ctx, sent } = cargarCodigo(ss);
  ctx.retrieveCodeByEmail('pere@x.cat');
  const r = ctx.retrieveCodeByEmail('PERE@x.cat');
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
});

test('el código lee también una hoja con las cabeceras antiguas (por alias)', () => {
  const ss = libroCabecerasAntiguas();
  const { ctx } = cargarCodigo(ss);
  assert.equal(ctx.getPatientDataVerbose_('AAA111').implantes[0].nombre, 'Pere Vila');
  assert.equal(ctx.buscarPacient('43000001').data.codi_acces, 'AAA111');
  assert.equal(ctx.initiateLogin('BBB222').ok, true);
});

test('comprovarCuenta avisa en vivo si la Cuenta ya es de otra ficha', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const r = ctx.comprovarCuenta('43000001', 'GENERAR');
  assert.equal(r.lliure, false);
  assert.equal(r.altre.codi_acces, 'AAA111');
  assert.equal(r.altre.nombre, 'Pere Vila');
  assert.equal(ctx.comprovarCuenta('43000001', 'aaa111').lliure, true, 'su propia Cuenta no es conflicto');
  assert.equal(ctx.comprovarCuenta('43009999', 'GENERAR').lliure, true);
  assert.equal(ctx.comprovarCuenta('12345678Z', 'GENERAR').lliure, true, 'un DNI no se comprueba aquí');
});

test('fusionarPacients deja una sola ficha con el codi del DNI y el portal ve todos los implantes', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
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

test('corregirCuenta cambia la Cuenta equivocada de otra ficha y libera la buena', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
  const res = ctx.corregirCuenta('AAA111', '43000111');
  assert.equal(res.ok, true, res.message);
  assert.equal(ctx.buscarPacient('43000111').data.codi_acces, 'AAA111');
  assert.equal(ctx.comprovarCuenta('43000001', 'BBB222').lliure, true);
  assert.equal(ss.getSheetByName('Pacientes').formats.get('2,2'), '@');
});

// Lo que pasó en vivo el 2026-10-03: la primera versión del paso 4 dejó "Multi-unit" + alçada
// y tiró la marca y la conexión.
test('saveNewImplant guarda la pterigoidea y los detalles del pilar, y el portal los recibe', () => {
  const ss = libro();
  const { ctx } = cargarCodigo(ss);
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

test('un DNI que llega después desmarca "Sense DNI" en todas las filas del paciente', () => {
  const ss = libro();
  const sh = ss.getSheetByName('Pacientes');
  const col = PM.CAPCALERES.indexOf(PM.COLUMNES.find(c => c.clau === 'sense_dni').capcalera) + 1;
  sh.getRange(2, col).setValue(true); // Pere, importado sin DNI
  const { ctx } = cargarCodigo(ss);

  const res = ctx.saveNewImplant({
    codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_email: false,
    dni: '11111111H', sense_dni: false, sendEmail: 'false', implantes: [IMPLANT]
  });
  assert.equal(res.ok, true, res.message);
  const files = objetosDe(ctx, sh).filter(o => o.codi_acces === 'AAA111');
  assert.equal(files.length, 2);
  assert.ok(files.every(o => o.dni === '11111111H' && o.sense_dni === false));
});
