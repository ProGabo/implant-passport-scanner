// --- CONFIGURACIÓN ---
// Medición del portal (doPost con diag: true): cuánto tarda la carga del script y cada paso.
const T_INICI_SCRIPT_ = Date.now();
let DIAG_ = null;
function marca_(pas) {
  if (DIAG_) DIAG_.passos.push([pas, Date.now() - DIAG_.inici]);
}
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_NAME = "Pacientes";
const CATALOG_SHEET_NAME = "Catálogo de Implantes";

/**
 * Sirve la página principal de la aplicación web (la interfaz de búsqueda del paciente).
 * Esta función es el punto de entrada de la aplicación web publicada.
 */
function doGet() {
  const htmlOutput = HtmlService.createTemplateFromFile('Index')
      .evaluate();

  htmlOutput.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
            .setTitle('Pasaporte Implantológico');

  return htmlOutput;
}

// ==========================================
//  MENÚ Y SIDEBAR (interfaz interna: en catalán)
// ==========================================

const NOM_MENU = 'Pasaport Implantològic 🦷';

/**
 * Crea un menú personalizado en la interfaz de Google Sheets al abrir la hoja.
 */
function onOpen() {
  // Menú FIJO a propósito: mismos ítems, mismo orden, para todas las cuentas y todos los
  // días. Se probó a detectar aquí el estado de autorización para avisar por adelantado,
  // pero ScriptApp.getAuthorizationInfo() no es fiable dentro de onOpen (corre en
  // AuthMode.LIMITED y da "pendiente" a cuentas que sí están autorizadas): avisaba en falso
  // y desplazaba hacia abajo el botón que se usa cada día. El aviso fiable lo da el panel
  // lateral, que detecta el fallo de verdad justo cuando se va a trabajar.
  const ui = SpreadsheetApp.getUi();
  ui.createMenu(NOM_MENU)
      .addItem('➕ Afegir implant / pacient', 'showSidebar')
      .addItem('✏️ Completar i enviar (fila seleccionada)', 'obrirPanellPendents')
      .addItem('🔔 Recordatoris', 'obrirRecordatoris')
      .addSeparator()
      .addItem('🔑 Autoritzar el meu compte', 'autorizarCuenta')
      .addSubMenu(ui.createMenu('⚙️ Manteniment')
          .addItem('🩺 Comprovar-ho tot', 'comprobarTodo'))
      .addToUi();
  // Sin menú a propósito (solo para quien mantiene la herramienta, desde el editor de
  // Apps Script): arreglarCodigosUndefined, eliminarDuplicados, provarAvisSecretaria,
  // retallarFilesBuides.

  // Recordatoris (S6): un aviso si hoy toca alguno. Solo lee la hoja; nunca rompe el menú.
  try { avisarRecordatorisEnObrir_(); } catch (e) { /* el menú ya está */ }
}

/**
 * Abre el sidebar. Le inyecta el código de PacientModel para que el formulario valide
 * con las mismas reglas que el servidor, sin duplicarlas.
 */
function showSidebar() {
  const html = HtmlService.createTemplateFromFile('SidebarForm');
  html.pacientModelJs = crearPacientModel.toString();
  html.recordatoriModelJs = crearRecordatoriModel.toString();
  SpreadsheetApp.getUi()
      .showSidebar(html.evaluate()
      .setTitle("Escàner d'implants"));
}


// ==========================================
//  ACCESO A LA HOJA (siempre por cabecera, vía PacientModel)
// ==========================================

/**
 * Las funciones del panel y del menú son solo para el personal. El web app del portal es
 * anónimo y se ejecuta como quien lo despliega, y desde su página cualquiera podría llamar
 * con google.script.run a cualquier función global sin "_" final.
 * La prueba: desde la hoja (panel o menú) existe la interfaz de Sheets; desde el web app,
 * SpreadsheetApp.getUi() lanza "Cannot call ... from this context". No se usa
 * Session.getActiveUser() como prueba principal: exige el permiso userinfo.email, que el
 * manifiesto no declara, y añadirlo obligaría a todas las cuentas a volver a autorizar.
 */
/**
 * Mensaje al final de una herramienta de mantenimiento. Desde el editor de Apps Script no
 * hay interfaz de Sheets: el mensaje va al registro de ejecución.
 */
function avisar_(titol, text) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(titol, text, ui.ButtonSet.OK);
  } catch (e) {
    console.log(titol + ': ' + text);
  }
}

/** Pregunta en la hoja; desde el editor (sin interfaz) devuelve `perDefecte`. null = cancelado. */
function demanar_(titol, pregunta, perDefecte) {
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    return perDefecte;
  }
  const r = ui.prompt(titol, pregunta, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? r.getResponseText() : null;
}

/** Direcciones de prueba: propiedad del script PROVA_EMAILS, separadas por comas. */
function adrecesProva_() {
  return String(PropertiesService.getScriptProperties().getProperty('PROVA_EMAILS') || '')
      .split(',').map(a => a.trim()).filter(a => PacientModel.esEmail(a));
}

function exigirUsuariIntern_() {
  try {
    SpreadsheetApp.getUi();
    return;
  } catch (e) { /* no es la hoja: se prueba la identidad */ }
  if (!emailUsuariActual_()) {
    // Sin la palabra "autoritzar": el panel la confunde con un fallo de permisos.
    throw new Error("Aquesta funció només es pot fer servir des del full de càlcul de la clínica.");
  }
}

/** Email de quien ejecuta, o '' si Google no lo da (sin el permiso userinfo.email, anónimo...). */
function emailUsuariActual_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function hojaPacientes() {
  const sheet =SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No existeix la pestanya '" + SHEET_NAME + "'.");
  return sheet;
}

/** Lee la hoja entera: cabeceras, índice clave -> columna, filas crudas y como objetos. */
function leerPacientes(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.length ? data[0] : [];
  const { idx } = PacientModel.indexarCapcaleres(headers);
  // Sin las filas vacías del final (con casillas FALSE hasta abajo de la hoja).
  const files = data.slice(1);
  files.length = PacientModel.filesAmbDades(files);
  return { headers, idx, files, objetos: files.map(f => PacientModel.filaAObjecte(f, idx)) };
}

/**
 * Lee solo lo necesario de un paciente: la columna del Codi d'accés y después únicamente
 * sus filas (por tramos seguidos), en vez de la hoja entera. Acepta el código como lo
 * escribe el paciente (O/0, I/1, minúsculas: PortalModel.resoldreCodi).
 * @returns {{codi: string, ambigu: boolean, objetos: object[]}} codi '' si no existe
 */
function llegirPacientPerCodi_(code) {
  const sheet = hojaPacientes();
  marca_('obrirFull');
  const nCols = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, nCols).getValues()[0];
  marca_('capcaleres');
  const { idx } = PacientModel.indexarCapcaleres(headers);
  if (idx.codi_acces === undefined) throw new Error("No trobo la columna \"Codi d'accés\".");
  const nFiles = sheet.getLastRow() - 1;
  marca_('lastRow=' + (nFiles + 1));
  if (nFiles < 1) return { codi: '', ambigu: false, objetos: [] };

  const codis = sheet.getRange(2, idx.codi_acces + 1, nFiles, 1).getValues().map(f => f[0]);
  marca_('columnaCodi');
  const r = PortalModel.resoldreCodi(code, codis);
  if (!r.codi) return { codi: '', ambigu: r.ambigu, objetos: [] };

  const posicions = [];
  codis.forEach((c, i) => { if (mismoCodigo(c, r.codi)) posicions.push(i); });
  const objetos = [];
  // Las filas de un paciente suelen ir seguidas, pero la 2ª visita las añade al final.
  for (let a = 0; a < posicions.length;) {
    let b = a;
    while (b + 1 < posicions.length && posicions[b + 1] === posicions[b] + 1) b++;
    sheet.getRange(posicions[a] + 2, 1, b - a + 1, nCols).getValues()
        .forEach(f => objetos.push(PacientModel.filaAObjecte(f, idx)));
    a = b + 1;
  }
  marca_('filesPacient');
  return { codi: String(r.codi).trim().toUpperCase(), ambigu: false, objetos };
}

// Caché del login (60 s), solo para que el PDF que el portal pide justo después no vuelva a
// leer la hoja. Se borra al guardar o completar ese paciente.
const SEGONS_CACHE_LOGIN = 60;

// Forma canónica (O=0, I=L=1): todas las maneras de escribir un código comparten la clave,
// y oblidarLogin_ con el código de la hoja las borra todas.
function clauLogin_(codi) {
  return 'LOGIN_' + PortalModel.codiCanonic(codi);
}

function oblidarLogin_(codi) {
  try {
    CacheService.getScriptCache().remove(clauLogin_(codi));
  } catch (e) {
    Logger.log('No es pot esborrar la memòria cau del login: ' + e);
  }
}

// Filas vacías que se dejan por debajo de los datos, con la casilla "Pendent" puesta, para
// que la Auxiliar pueda escribir a mano. No más: cada casilla cuenta como fila para Sheets
// (getLastRow, getDataRange) y leer miles de filas vacías hacía lento el portal.
const MARGE_FILES = 200;

/**
 * Deja MARGE_FILES filas por debajo de las nDades filas de datos: las añade si faltan y les
 * pone la casilla "Pendent". Devuelve hasta qué fila (sin cabecera) llega el margen.
 */
function assegurarMarge_(sheet, headers, nDades) {
  const n = nDades + MARGE_FILES;
  const falten = n + 1 - sheet.getMaxRows();
  if (falten > 0) sheet.insertRowsAfter(sheet.getMaxRows(), falten);
  const { idx } = PacientModel.indexarCapcaleres(headers);
  if (idx.pendent !== undefined) {
    sheet.getRange(nDades + 2, idx.pendent + 1, MARGE_FILES, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  return n;
}

function mismoCodigo(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

/**
 * Crea las cabeceras del registro que falten (al final) y pone casillas en las columnas
 * de casilla. Idempotente: S3 y S4 añadirán así sus columnas, sin migraciones.
 */
function asegurarColumnas(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const faltan = PacientModel.COLUMNES.filter(c => idx[c.clau] === undefined);
  if (faltan.length) {
    const primeraLibre = headers.filter(h => String(h).trim() !== '').length === 0 ? 1 : lastCol + 1;
    sheet.getRange(1, primeraLibre, 1, faltan.length).setValues([faltan.map(c => c.capcalera)]);
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** Casillas nativas en las columnas de casilla para las filas indicadas (no cambia valores). */
function ponerCasillas(sheet, headers, filaInicio, numFilas) {
  if (numFilas <= 0) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const regla = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  PacientModel.COLUMNES.filter(c => c.casella && idx[c.clau] !== undefined).forEach(c => {
    sheet.getRange(filaInicio, idx[c.clau] + 1, numFilas, 1).setDataValidation(regla);
  });
}

/**
 * Columnas que se guardan como texto (`text: true` en el registro), para que Sheets no
 * convierta 012345 o 4300... en número, ni "1.5" (alçada del pilar) en una fecha.
 */
function ponerFormatoTexto(sheet, headers, filaInicio, numFilas) {
  if (numFilas <= 0) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  PacientModel.COLUMNES.filter(c => c.text && idx[c.clau] !== undefined).forEach(c => {
    sheet.getRange(filaInicio, idx[c.clau] + 1, numFilas, 1).setNumberFormat('@');
  });
}

/**
 * Genera un Codi d'accés de 6 caracteres que no exista ya (sin O/0/I/1/L, ver PortalModel).
 * @param {string[]} existentes códigos ya usados
 */
function generarCodigoUnico(existentes) {
  return PortalModel.generarCodi(existentes);
}

function ahoraMs() {
  return Date.now();
}


// ==========================================
//  BÚSQUEDAS (Backend para Sidebar y Web)
// ==========================================

/**
 * Busca un paciente para el sidebar por Cuenta Quartup, DNI o Codi d'accés. Coincidencia
 * exacta y solo en esas tres columnas.
 * @returns {{ok, found, data?, encontradoPor?, message?}}
 */
function buscarPacient(termino) {
  exigirUsuariIntern_();
  try {
    const busca = String(termino || '').trim();
    if (!busca) return { ok: true, found: false };

    const { objetos } = leerPacientes(hojaPacientes());
    const buscaDoc = PacientModel.netejarDocument(busca);

    let encontradoPor = null;
    const fila = objetos.find(o => {
      if (String(o.cuenta_quartup).trim() === busca) { encontradoPor = 'cuenta'; return true; }
      if (o.dni && PacientModel.netejarDocument(o.dni) === buscaDoc) { encontradoPor = 'dni'; return true; }
      if (mismoCodigo(o.codi_acces, busca)) { encontradoPor = 'codi'; return true; }
      return false;
    });
    if (!fila) return { ok: true, found: false };

    // Los datos de paciente se repiten en cada fila-implante: se toma lo más completo.
    const codi = String(fila.codi_acces).trim().toUpperCase();
    const filasPaciente = objetos.filter(o => mismoCodigo(o.codi_acces, codi));
    const p = PacientModel.pacientsUnics(filasPaciente)[0];
    return {
      ok: true,
      found: true,
      encontradoPor: encontradoPor,
      data: {
        codi_acces: codi,
        cuenta_quartup: p.cuenta_quartup,
        nombre: p.nombre,
        email: p.email,
        sense_email: filasPaciente.some(o => o.sense_email),
        dni: p.dni,
        sense_dni: filasPaciente.some(o => o.sense_dni),
        n_implants: p.n_implants,
        ultimEnviament: ultimEnviamentDe_(codi),
        recordatori: recordatoriActiu_(codi)
      }
    };
  } catch (e) {
    Logger.log('Error en buscarPacient: ' + e);
    return { ok: false, message: 'Error intern: ' + e.message };
  }
}

/**
 * Comprobación en vivo del sidebar al escribir la Cuenta: ¿ya es de otro paciente?
 * @param {string} cuenta
 * @param {string} codiPropi Codi d'accés de la ficha abierta ('GENERAR' si es nueva)
 * @returns {{ok, lliure, altre?: {codi_acces, nombre, dni, n_implants}}}
 */
function comprovarCuenta(cuenta, codiPropi) {
  exigirUsuariIntern_();
  try {
    const c = String(cuenta || '').trim();
    if (PacientModel.classificarIdentificador(c) !== 'cuenta') return { ok: true, lliure: true };
    const { objetos } = leerPacientes(hojaPacientes());
    const altre = PacientModel.pacientsUnics(objetos).find(p =>
      String(p.cuenta_quartup).trim() === c && !mismoCodigo(p.codi_acces, codiPropi));
    if (!altre) return { ok: true, lliure: true };
    return { ok: true, lliure: false, altre: { codi_acces: altre.codi_acces, nombre: altre.nombre, dni: altre.dni, n_implants: altre.n_implants } };
  } catch (e) {
    Logger.log('Error en comprovarCuenta: ' + e);
    return { ok: false, message: 'Error intern: ' + e.message };
  }
}

/** Escribe las columnas de paciente (y el codi) de todas las filas, como texto. */
function escribirColumnasPaciente(sheet, headers, files) {
  if (!files.length) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  ponerFormatoTexto(sheet, headers, 2, files.length);
  const aTexto = textoSiId(headers);
  PacientModel.CLAUS_PACIENT.forEach(k => {
    const i = idx[k];
    if (i === undefined) return;
    sheet.getRange(2, i + 1, files.length, 1).setValues(files.map(f => [aTexto(f[i], i)]));
  });
}

/**
 * Une dos fichas que son la misma persona: todos los implantes pasan al `codiQueQueda`
 * (el que el paciente ya ha recibido) y los datos se completan entre las dos.
 */
function fusionarPacients(codiQueQueda, codiQueMarxa) {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hojaPacientes();
    const { headers, files } = leerPacientes(sheet);
    const fusio = PacientModel.planificarFusio(headers, files, codiQueQueda, codiQueMarxa);
    if (fusio.errors.length) return { ok: false, message: fusio.errors.join('\n'), errors: fusio.errors };
    escribirColumnasPaciente(sheet, headers, fusio.files);
    oblidarLogin_(codiQueQueda);
    oblidarLogin_(codiQueMarxa);
    moureRecordatori_(codiQueMarxa, codiQueQueda);
    return { ok: true, pacient: fusio.pacient, filesMogudes: fusio.filesMogudes, avisos: fusio.avisos };
  } catch (e) {
    Logger.log('Error en fusionarPacients: ' + e);
    return { ok: false, message: 'Error en unir les fitxes: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Corrige la Cuenta Quartup de OTRA ficha que chocaba con la que se está escribiendo y
 * que no es la misma persona (su Cuenta estaba mal). Vacía = se le quita.
 */
function corregirCuenta(codi, novaCuenta) {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hojaPacientes();
    const { headers, files } = leerPacientes(sheet);
    const r = PacientModel.planificarCanviCuenta(headers, files, codi, novaCuenta);
    if (r.errors.length) return { ok: false, message: r.errors.join('\n'), errors: r.errors };
    escribirColumnasPaciente(sheet, headers, r.files);
    return { ok: true, filesTocades: r.filesTocades };
  } catch (e) {
    Logger.log('Error en corregirCuenta: ' + e);
    return { ok: false, message: 'Error en corregir la Cuenta: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Busca TODAS las filas-implante de un Codi d'accés (portal del paciente). Acepta el
 * código con O/0, I/L/1, minúsculas o espacios (PortalModel.resoldreCodi) y devuelve
 * solo la lista blanca de PortalModel: nunca email, Cuenta ni DNI completo.
 * @returns {{ok, found, codi_acces?, implantes?, ambigu?, message?}}
 */
function getPatientDataVerbose_(code) {
  try {
    const r = llegirPacientPerCodi_(code);
    if (r.ambigu) {
      Logger.log('Codi ambigu al portal: ' + code);
      return { ok: true, found: false, ambigu: true, message: 'No podemos identificar este código. Por favor, contacte con la clínica.' };
    }
    if (!r.codi) return { ok: true, found: false, message: 'No se encontraron implantes para este código.' };

    return { ok: true, found: true, codi_acces: r.codi, implantes: implantsPerAlPacient_(r.objetos) };

  } catch (err) {
    Logger.log('ERROR en getPatientDataVerbose_: ' + err);
    return { ok: false, message: 'No hemos podido consultar el pasaporte. Inténtelo de nuevo más tarde.' };
  }
}


// ==========================================
//  GUARDADO DE DATOS
// ==========================================


/**
 * Guarda los implantes de un paciente (nuevo o existente), envía el email del pasaporte
 * si se pide y actualiza el catálogo.
 * @param {object} formData { codi_acces ('GENERAR' si es nuevo), cuenta_quartup, nombre,
 *   email, sense_email, dni, sense_dni, sendEmail ('true'|'false'), implantes: [] }
 */
function saveNewImplant(formData) {
  exigirUsuariIntern_();
  // Dos guardados a la vez podrían generar el mismo código o pisarse la última fila.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let paciente, plan, filas, recordatori;
  try {
    const sheet = hojaPacientes();
    const headers = asegurarColumnas(sheet);
    const { files, objetos } = leerPacientes(sheet);

    plan = PacientModel.planificarDesat(headers, files, Object.assign({}, formData, { mode: 'afegir' }));
    const rec = RecordatoriModel.validar(formData.recordatori);
    plan.errors = plan.errors.concat(rec.errors);
    if (plan.errors.length) {
      return { ok: false, message: plan.errors.join('\n'), errors: plan.errors };
    }
    paciente = plan.paciente;
    if (!plan.codi) {
      paciente.codi_acces = generarCodigoUnico(objetos.map(o => o.codi_acces));
      plan.filas.forEach(f => { f.codi_acces = paciente.codi_acces; });
    } else {
      completarDatosPaciente(sheet, headers, paciente, files.length);
    }

    filas = plan.filas.map(o => PacientModel.objecteAFila(o, headers));
    // Justo después de la última fila con datos (no getLastRow(): ver filesAmbDades).
    // Antes, el margen: si la hoja se ha quedado corta, se añaden filas.
    const primera = files.length + 2;
    assegurarMarge_(sheet, headers, files.length + filas.length);
    ponerFormatoTexto(sheet, headers, primera, filas.length);
    sheet.getRange(primera, 1, filas.length, headers.length).setValues(filas);
    ponerCasillas(sheet, headers, primera, filas.length);

    plan.filas.forEach(imp => {
      updateCatalog_({ marca: imp.marca, modelo: imp.modelo, conexion: imp.conexion });
    });
    // La primera vez que se guarda algo pendiente: color, desplegable y pestaña "Pendents".
    if (plan.filas.some(f => f.pendent)) prepararHoja_(sheet, headers);
    recordatori = desarRecordatoriSegur_(rec.recordatori, paciente);
  } catch (e) {
    Logger.log('Error en saveNewImplant: ' + e.message);
    return { ok: false, message: 'Error en desar: ' + e.message };
  } finally {
    lock.releaseLock();
  }

  oblidarLogin_(paciente.codi_acces);
  // Guardar no envía: el panel lanza enseguida enviarPasaport(newCode, enviar) en otra
  // llamada, para que "Desat" salga sin esperar al email. Sin email, la Secretària hace
  // llegar el codi (casilla marcada por defecto en el panel).
  return {
    ok: true,
    newCode: paciente.codi_acces,
    implantsCount: filas.length,
    enviar: {
      email: formData.sendEmail === 'true',
      avisSecretaria: !!paciente.sense_email && formData.avisSecretaria === 'true',
      // Un recordatorio que se acaba de poner o cambiar no se da por hecho con este envío.
      noTancarRecordatori: !!(recordatori && recordatori.accio && recordatori.accio !== 'cap')
    },
    avisos: plan.avisos,
    recordatori: recordatori
  };
}

/**
 * Paciente existente: rellena en TODAS sus filas los datos de identidad que estaban
 * vacíos (p. ej. la Cuenta Quartup de un paciente antiguo dado de alta con el DNI).
 * Nunca sobrescribe un dato ya guardado; editar datos existentes es cosa de S3.
 */
function completarDatosPaciente(sheet, headers, paciente, nFiles) {
  if (nFiles < 1) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const rango = sheet.getRange(2, 1, nFiles, headers.length);
  const filas = rango.getValues();
  const campos = ['cuenta_quartup', 'email', 'sense_email', 'dni', 'sense_dni'];
  let cambios = false;

  filas.forEach(f => {
    if (!mismoCodigo(f[idx.codi_acces], paciente.codi_acces)) return;
    campos.forEach(k => {
      const i = idx[k];
      if (i === undefined) return;
      const actual = f[i];
      const vacio = actual === '' || actual === null || actual === false;
      if (vacio && paciente[k] !== '' && paciente[k] !== false) {
        f[i] = paciente[k];
        cambios = true;
      }
    });
    // Ha llegado el dato que "no teníamos": la casilla deja de tener sentido.
    [['email', 'sense_email'], ['dni', 'sense_dni']].forEach(([dato, casilla]) => {
      const iD = idx[dato], iC = idx[casilla];
      if (iD === undefined || iC === undefined) return;
      if (String(f[iD]).trim() && PacientModel.esCert(f[iC])) { f[iC] = false; cambios = true; }
    });
  });

  if (cambios) {
    ponerFormatoTexto(sheet, headers, 2, filas.length);
    // Solo se reescriben las columnas tocadas, para no pisar fórmulas ni formatos ajenos.
    campos.forEach(k => {
      const i = idx[k];
      if (i === undefined) return;
      sheet.getRange(2, i + 1, filas.length, 1).setValues(filas.map(f => [f[i]]));
    });
  }
}

// ==========================================
//  CICLO DE VIDA DE LA FICHA (S3): pendientes y panel "Completar i enviar"
// ==========================================

const HOJA_PENDENTS = 'Pendents';
const COLOR_PENDENT = '#ffedd5';
const RE_REGLA_PENDENT = /^=\$[A-Z]+2=TRUE$/;

function columnaLletra_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

/**
 * Deja la hoja lista para los pendientes (idempotente; las columnas se buscan por cabecera,
 * así que si se mueven basta con volver a llamarla): fila en naranja mientras "Pendent" está
 * marcada (también si se edita a mano), "Què falta" como texto, desplegable de aviso en
 * "Pilar" y la pestaña "Pendents". Las casillas las pone assegurarMarge_.
 */
function prepararHoja_(sheet, headers) {
  const { idx } = PacientModel.indexarCapcaleres(headers);
  if (idx.pendent === undefined) return;
  // El color, el formato y el desplegable no escriben valores: pueden llegar al final de la
  // hoja. La casilla "Pendent" sí (FALSE), y por eso solo llega al margen (assegurarMarge_).
  const nFiles = Math.max(sheet.getMaxRows(), 2) - 1;

  // "Què falta" como texto: "+PC, falta el pilar" no debe convertirse en fórmula.
  if (idx.que_falta !== undefined) sheet.getRange(2, idx.que_falta + 1, nFiles, 1).setNumberFormat('@');

  // Formato condicional: se reconoce el propio por su fórmula y se sustituye.
  const formula = '=$' + columnaLletra_(idx.pendent + 1) + '2=TRUE';
  const esPropia = r => {
    const c = r.getBooleanCondition();
    return !!c && RE_REGLA_PENDENT.test(String((c.getCriteriaValues() || [])[0]));
  };
  const regles = sheet.getConditionalFormatRules().filter(r => !esPropia(r));
  // Delante de la del recordatorio vencido (S6): la primera regla que se cumple manda.
  const iRecordatori = regles.findIndex(r => {
    const c = r.getBooleanCondition();
    return !!c && RE_REGLA_RECORDATORI.test(String((c.getCriteriaValues() || [])[0]));
  });
  regles.splice(iRecordatori === -1 ? regles.length : iRecordatori, 0, SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground(COLOR_PENDENT)
      .setRanges([sheet.getRange(2, 1, nFiles, Math.max(sheet.getMaxColumns(), headers.length))])
      .build());
  sheet.setConditionalFormatRules(regles);

  if (idx.pilar !== undefined) {
    sheet.getRange(2, idx.pilar + 1, nFiles, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(PacientModel.TIPUS_PILAR, true)
        .setAllowInvalid(true)
        .setHelpText('Tria el tipus de pilar. Si és un altre, escriu-lo: només sortirà un avís.')
        .build());
  }
  prepararPestanyaPendents_(sheet, idx);
}

/** Pestaña "Pendents": lista en vivo de los implantes pendientes, con enlace a su fila. */
function prepararPestanyaPendents_(sheet, idx) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hoja = ss.getSheetByName(HOJA_PENDENTS) || ss.insertSheet(HOJA_PENDENTS);
  const pref = "'" + sheet.getName().replace(/'/g, "''") + "'!";
  const files = pref + 'A2:A';
  const col = k => {
    const l = columnaLletra_(idx[k] + 1);
    return idx[k] === undefined ? 'IF(ROW(' + files + '),"")' : pref + l + '2:' + l;
  };
  const columnes = ['HYPERLINK("#gid=' + sheet.getSheetId() + '&range=A"&ROW(' + files + '),"Anar-hi")']
      .concat(['nombre', 'codi_acces', 'posicion', 'fecha_colocacion', 'pilar', 'que_falta'].map(col))
      .concat(['ROW(' + files + ')']);
  const formula = '=IFERROR(FILTER(ARRAYFORMULA({' + columnes.join(',') + '}),' + col('pendent') + '=TRUE),"Cap implant pendent")';
  if (hoja.getRange(2, 1).getFormula() === formula) return;
  hoja.clear();
  hoja.getRange(1, 1, 1, 8).setValues([['Anar-hi', 'Nom', "Codi d'accés", 'Posició', 'Data', 'Pilar', 'Què falta', 'Fila']]).setFontWeight('bold');
  hoja.getRange(2, 1).setFormula(formula);
  hoja.getRange(2, 5, Math.max(hoja.getMaxRows() - 1, 1), 1).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(1, 1).setNote("Llista automàtica dels implants marcats com a «Pendent». Per completar-ne un: «Anar-hi», i després " + NOM_MENU + " → ✏️ Completar i enviar.");
  hoja.setFrozenRows(1);
}

/** Menú y botón: abre el panel lateral "Completar i enviar" sobre la fila seleccionada. */
function obrirPanellPendents() {
  exigirUsuariIntern_();
  const html = HtmlService.createTemplateFromFile('PanelPendents');
  html.pacientModelJs = crearPacientModel.toString();
  html.recordatoriModelJs = crearRecordatoriModel.toString();
  SpreadsheetApp.getUi().showSidebar(html.evaluate().setTitle('Completar i enviar'));
}

/**
 * Fila de "Pacientes" que la Auxiliar tiene seleccionada (también desde la pestaña
 * "Pendents", por su columna "Fila"). Se lee al llamar, no al abrir el panel.
 * @returns {{fila: number}|{error: string}}
 */
function filaSeleccionada_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getActiveSheet();
  const rang = ss.getActiveRange();
  if (!hoja || !rang) return { error: "Selecciona una fila d'un implant a la pestanya " + SHEET_NAME + '.' };
  if (hoja.getName() === SHEET_NAME) {
    return rang.getRow() >= 2 ? { fila: rang.getRow() } : { error: "Selecciona una fila d'un implant (no la capçalera)." };
  }
  if (hoja.getName() === HOJA_PENDENTS && rang.getRow() >= 2) {
    const fila = parseInt(hoja.getRange(rang.getRow(), 8).getValue(), 10);
    if (fila >= 2) return { fila: fila };
  }
  return { error: "Selecciona una fila d'un implant a la pestanya " + SHEET_NAME + ' (o a ' + HOJA_PENDENTS + ').' };
}

/** Claves de implante de una fila para el panel (las fechas, como texto). */
function perAlPanell_(o, fila) {
  const out = { fila: fila };
  PacientModel.CLAUS_IMPLANT.forEach(k => {
    const v = o[k];
    out[k] = v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy') : v;
  });
  return out;
}

/**
 * Panel: el paciente de la fila seleccionada y sus implantes pendientes (más la fila
 * seleccionada, aunque no lo esté).
 */
function carregarPanell() {
  exigirUsuariIntern_();
  try {
    const sel = filaSeleccionada_();
    if (sel.error) return { ok: false, message: sel.error };
    const sheet = hojaPacientes();
    asegurarColumnas(sheet);
    const { objetos } = leerPacientes(sheet);
    const o = objetos[sel.fila - 2];
    if (!o || !String(o.codi_acces || '').trim()) {
      return { ok: false, message: "La fila " + sel.fila + " no té cap pacient. Selecciona la fila d'un implant." };
    }
    const codi = String(o.codi_acces).trim().toUpperCase();
    const delPacient = objetos.filter(x => mismoCodigo(x.codi_acces, codi));
    const files = [];
    objetos.forEach((x, i) => {
      if (mismoCodigo(x.codi_acces, codi) && (x.pendent || i + 2 === sel.fila)) files.push(perAlPanell_(x, i + 2));
    });
    const p = PacientModel.pacientsUnics(delPacient)[0];
    return {
      ok: true,
      filaSeleccionada: sel.fila,
      pacient: {
        codi_acces: codi,
        nombre: p.nombre,
        cuenta_quartup: p.cuenta_quartup,
        email: p.email,
        dni: p.dni,
        sense_email: delPacient.some(x => x.sense_email),
        sense_dni: delPacient.some(x => x.sense_dni),
        n_implants: p.n_implants,
        ultimEnviament: ultimEnviamentDe_(codi),
        recordatori: recordatoriActiu_(codi)
      },
      files: files,
      marques: marquesCataleg_()
    };
  } catch (e) {
    Logger.log('Error en carregarPanell: ' + e);
    return { ok: false, message: 'Error intern: ' + e.message };
  }
}

/**
 * Guarda los cambios del panel en sus filas, columna a columna (no pisa columnas ajenas).
 * `completar`: además desmarca "Pendent" de esas filas.
 */
function desarPanell_(formData, completar) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hojaPacientes();
    const headers = asegurarColumnas(sheet);
    const { files } = leerPacientes(sheet);
    const fd = Object.assign({}, formData, { mode: 'completar' });
    if (completar) fd.implantes = (fd.implantes || []).map(i => Object.assign({}, i, { pendent: false }));
    const plan = PacientModel.planificarDesat(headers, files, fd);
    const rec = RecordatoriModel.validar(formData && formData.recordatori);
    plan.errors = plan.errors.concat(rec.errors);
    if (plan.errors.length) return { ok: false, message: plan.errors.join('\n'), errors: plan.errors };

    const { idx } = PacientModel.indexarCapcaleres(headers);
    const esText = {};
    PacientModel.COLUMNES.forEach(c => { esText[c.clau] = !!c.text; });
    // Solo las celdas que cambia cada fila: las demás (una fecha, un número) se quedan
    // exactamente como estaban.
    plan.files_hoja.forEach((n, i) => {
      plan.claus_per_fila[i].forEach(k => {
        if (idx[k] === undefined) return;
        const cel = sheet.getRange(n, idx[k] + 1);
        const v = plan.filas[i][k];
        // Un texto que empiece por = + - @ sería una fórmula: como texto literal.
        if (esText[k] || (typeof v === 'string' && /^[=+\-@]/.test(v))) cel.setNumberFormat('@');
        cel.setValue(esText[k] && v !== '' && v !== null ? String(v) : v);
      });
      ponerCasillas(sheet, headers, n, 1);
    });
    completarDatosPaciente(sheet, headers, plan.paciente, files.length);
    if (['marca', 'modelo', 'conexion'].some(k => plan.claus_tocades.indexOf(k) !== -1)) {
      plan.filas.forEach(imp => updateCatalog_({ marca: imp.marca, modelo: imp.modelo, conexion: imp.conexion }));
    }
    oblidarLogin_(plan.codi);
    const recordatori = desarRecordatoriSegur_(rec.recordatori, plan.paciente);
    return { ok: true, codi: plan.codi, filesDesades: plan.files_hoja.length, avisos: plan.avisos, recordatori: recordatori };
  } catch (e) {
    Logger.log('Error en desarPanell_: ' + e);
    return { ok: false, message: 'Error en desar: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Panel: "Desar" (Pendent queda como lo haya dejado la Auxiliar). */
function desarPanell(formData) {
  exigirUsuariIntern_();
  return desarPanell_(formData, false);
}

/**
 * Panel: "Completar i enviar". Guarda y desmarca Pendent; el panel envía después con
 * enviarPasaport(codi, {email: true, avisSiSenseEmail: true, avisSecretaria?}).
 */
function completarPanell(formData) {
  exigirUsuariIntern_();
  return desarPanell_(formData, true);
}

// ==========================================
//  RECORDATORIS (S6): avisos de seguimiento de la Auxiliar, solo dentro de la hoja
// ==========================================
// Pestaña "Recordatoris" (una fila por recordatorio, historial incluido), un aviso al abrir
// la hoja y una ventana con los Actius. Sin emails ni triggers: es de la Auxiliar.

const HOJA_RECORDATORIS = 'Recordatoris';
const COLOR_RECORDATORI = '#ede9fe';
const RE_REGLA_RECORDATORI = /INDIRECT\("'?Recordatoris'?!/;

/** La pestaña "Recordatoris" (la crea con sus cabeceras si `crear`), o null. */
function fullRecordatoris_(crear) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_RECORDATORIS);
  if (!sheet && crear) {
    // insertSheet deja activa la pestaña nueva: el panel lee la selección (filaSeleccionada_)
    // y la Auxiliar estaría mirando otra pestaña. Se vuelve a donde estaba.
    const abans = ss.getActiveSheet();
    const rang = ss.getActiveRange();
    sheet = ss.insertSheet(HOJA_RECORDATORIS);
    const n = RecordatoriModel.CAPCALERES.length;
    sheet.getRange(1, 1, 1, n).setValues([RecordatoriModel.CAPCALERES]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1).setNote("Recordatoris de la Auxiliar. Es posen i es canvien des del panell (🔔 Recordatori). " +
      "Per veure els actius: " + NOM_MENU + " → 🔔 Recordatoris.");
    try {
      if (rang) ss.setActiveRange(rang); else if (abans) ss.setActiveSheet(abans);
    } catch (e) { /* sin interfaz (tests, editor): no hay selección que devolver */ }
  }
  return sheet;
}

/** Filas de la pestaña como objetos (con su número de fila en `_fila`). */
function llegirRecordatoris_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return { idx: {}, objectes: [] };
  const data = sheet.getDataRange().getValues();
  const idx = RecordatoriModel.indexarCapcaleres(data[0]);
  const objectes = [];
  data.slice(1).forEach((f, i) => {
    const o = RecordatoriModel.filaAObjecte(f, idx);
    if (String(o.codi_acces).trim()) objectes.push(Object.assign(o, { _fila: i + 2 }));
  });
  return { idx: idx, objectes: objectes };
}

/** Escribe unas claves en una fila de la pestaña, por cabecera (las fechas, como fecha). */
function escriureRecordatori_(sheet, idx, fila, valors) {
  Object.keys(valors).forEach(k => {
    if (idx[k] === undefined) return;
    const cel = sheet.getRange(fila, idx[k] + 1);
    let v = valors[k];
    if (k === 'data') { v = RecordatoriModel.aData(v) || ''; cel.setNumberFormat('dd/mm/yyyy'); }
    else if (k === 'creat' || k === 'tancat') cel.setNumberFormat('dd/mm/yyyy hh:mm');
    else cel.setNumberFormat('@');
    cel.setValue(v);
  });
}

function avuiIso_() {
  return RecordatoriModel.avuiIso(ahoraMs());
}

/**
 * Aplica el recordatorio del formulario (sidebar o panel) a un paciente ya guardado.
 * Se llama dentro del lock del guardado. `nou` es RecordatoriModel.validar(...).recordatori.
 * @returns {{accio, data?}|null}
 */
function desarRecordatori_(nou, pacient) {
  if (!nou) return null;
  const sheet = fullRecordatoris_(!!nou.data);
  if (!sheet) return { accio: 'cap' };
  const { idx, objectes } = llegirRecordatoris_(sheet);
  const pla = RecordatoriModel.planificar(objectes, nou, pacient);
  const ara = new Date(ahoraMs());
  if (pla.accio === 'crear') {
    const fila = objectes.length ? Math.max.apply(null, objectes.map(o => o._fila)) + 1 : 2;
    escriureRecordatori_(sheet, idx, fila, Object.assign({}, pla.objecte, { creat: ara }));
  } else if (pla.accio === 'actualitzar') {
    escriureRecordatori_(sheet, idx, objectes[pla.index]._fila, pla.objecte);
  } else if (pla.accio === 'cancellar') {
    escriureRecordatori_(sheet, idx, objectes[pla.index]._fila, { estat: RecordatoriModel.CANCELLAT, tancat: ara });
  }
  if (pla.accio !== 'cap') prepararColorRecordatoris_();
  return { accio: pla.accio, data: nou.data };
}

/**
 * desarRecordatori_ sin hacer fallar el guardado: los implantes ya están escritos, y un
 * "Error en desar" haría reintentar y duplicar el paciente. El fallo sale solo en el 🔔.
 */
function desarRecordatoriSegur_(nou, pacient) {
  try {
    return desarRecordatori_(nou, pacient);
  } catch (e) {
    Logger.log('No es pot desar el recordatori de ' + pacient.codi_acces + ': ' + e);
    return { accio: 'error', message: String(e && e.message || e) };
  }
}

/** El recordatorio Actiu de un paciente para el sidebar y el panel, o null. */
function recordatoriActiu_(codi) {
  try {
    const r = RecordatoriModel.actiuDe(llegirRecordatoris_(fullRecordatoris_(false)).objectes, codi);
    return r ? { data: r.data, dataText: RecordatoriModel.format(r.data), motiu: String(r.motiu || ''), origen: String(r.origen || '') } : null;
  } catch (e) {
    Logger.log('No es pot llegir el recordatori de ' + codi + ': ' + e);
    return null;
  }
}

/** Cierra (Fet o Cancel·lat) el Actiu de un paciente. @returns {boolean} si había uno */
function tancarRecordatori_(codi, estat) {
  const sheet = fullRecordatoris_(false);
  if (!sheet) return false;
  const { idx, objectes } = llegirRecordatoris_(sheet);
  const i = RecordatoriModel.indexActiu(objectes, codi);
  if (i === -1) return false;
  escriureRecordatori_(sheet, idx, objectes[i]._fila, { estat: estat || RecordatoriModel.FET, tancat: new Date(ahoraMs()) });
  prepararColorRecordatoris_();
  return true;
}

/**
 * Al unir fichas: el recordatorio de la que desaparece pasa a la que se queda. Si las dos
 * tenían uno, se queda el de la ficha que queda y el otro se cancela. Nunca lanza.
 */
function moureRecordatori_(codiQueMarxa, codiQueQueda) {
  try {
    const sheet = fullRecordatoris_(false);
    if (!sheet) return;
    const { idx, objectes } = llegirRecordatoris_(sheet);
    const i = RecordatoriModel.indexActiu(objectes, codiQueMarxa);
    if (i === -1) return;
    if (RecordatoriModel.indexActiu(objectes, codiQueQueda) !== -1) {
      escriureRecordatori_(sheet, idx, objectes[i]._fila, { estat: RecordatoriModel.CANCELLAT, tancat: new Date(ahoraMs()) });
    } else {
      escriureRecordatori_(sheet, idx, objectes[i]._fila, { codi_acces: String(codiQueQueda).trim().toUpperCase() });
    }
    prepararColorRecordatoris_();
  } catch (e) {
    Logger.log('No es pot moure el recordatori de ' + codiQueMarxa + ': ' + e);
  }
}

/**
 * Tras reenviar el pasaporte: si el recordatorio ya toca (o falta poco), está hecho. Nunca
 * hace fallar el envío.
 * @returns {{tancat: boolean, data?: string}|null}
 */
function tancarRecordatoriSiToca_(codi, env) {
  try {
    if (!env || !(env.emailSent || (env.avisSecretaria && env.avisSecretaria.enviat))) return null;
    const sheet = fullRecordatoris_(false);
    if (!sheet) return null;
    const r = RecordatoriModel.actiuDe(llegirRecordatoris_(sheet).objectes, codi);
    if (!r) return null;
    if (!RecordatoriModel.tancaAlReenviar(r, avuiIso_())) return { tancat: false, data: RecordatoriModel.format(r.data) };
    tancarRecordatori_(codi, RecordatoriModel.FET);
    return { tancat: true, data: RecordatoriModel.format(r.data) };
  } catch (e) {
    Logger.log('No es pot tancar el recordatori de ' + codi + ': ' + e);
    return null;
  }
}

/**
 * Pacientes con un recordatorio vencido: su fila en lila (formato condicional que cruza
 * con la pestaña; idempotente). Va detrás de la regla de Pendent: el naranja manda.
 */
function prepararColorRecordatoris_() {
  try {
    const sheet = hojaPacientes();
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const { idx } = PacientModel.indexarCapcaleres(headers);
    const rIdx = llegirRecordatoris_(fullRecordatoris_(false)).idx;
    const esPropia = r => {
      const c = r.getBooleanCondition();
      return !!c && RE_REGLA_RECORDATORI.test(String((c.getCriteriaValues() || [])[0]));
    };
    const regles = sheet.getConditionalFormatRules().filter(r => !esPropia(r));
    if (idx.codi_acces !== undefined && ['codi_acces', 'estat', 'data'].every(k => rIdx[k] !== undefined)) {
      const col = k => { const l = columnaLletra_(rIdx[k] + 1); return 'INDIRECT("' + HOJA_RECORDATORIS + '!' + l + ':' + l + '")'; };
      const formula = '=COUNTIFS(' + col('codi_acces') + ',$' + columnaLletra_(idx.codi_acces + 1) + '2,' +
        col('estat') + ',"' + RecordatoriModel.ACTIU + '",' + col('data') + ',"<="&TODAY())>0';
      const nFiles = Math.max(sheet.getMaxRows(), 2) - 1;
      regles.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(formula)
          .setBackground(COLOR_RECORDATORI)
          .setRanges([sheet.getRange(2, 1, nFiles, Math.max(sheet.getMaxColumns(), headers.length))])
          .build());
    }
    sheet.setConditionalFormatRules(regles);
  } catch (e) {
    // El color es una ayuda: si Sheets no lo acepta, los recordatorios funcionan igual.
    Logger.log('No es pot preparar el color dels recordatoris: ' + e);
  }
}

/** Ventana "Recordatoris": los Actius, vencidos primero. */
function llistarRecordatoris() {
  exigirUsuariIntern_();
  try {
    const avui = avuiIso_();
    const llista = RecordatoriModel.llistaActius(llegirRecordatoris_(fullRecordatoris_(false)).objectes, avui)
      .map(o => ({
        codi_acces: String(o.codi_acces).trim().toUpperCase(),
        cuenta_quartup: String(o.cuenta_quartup || ''),
        nombre: String(o.nombre || ''),
        motiu: String(o.motiu || ''),
        origen: String(o.origen || ''),
        data: o.data,
        dataText: o.dataText,
        dies: o.dies,
        vencut: o.vencut
      }));
    return { ok: true, avui: RecordatoriModel.format(avui), recordatoris: llista };
  } catch (e) {
    Logger.log('Error en llistarRecordatoris: ' + e);
    return { ok: false, message: 'Error intern: ' + e.message };
  }
}

/** Ventana "Recordatoris": la ✕. */
function tancarRecordatori(codi) {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return { ok: true, tancat: tancarRecordatori_(codi, RecordatoriModel.FET) };
  } catch (e) {
    Logger.log('Error en tancarRecordatori: ' + e);
    return { ok: false, message: 'Error en tancar el recordatori: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/** Menú y sidebar: abre la ventana de los recordatorios (no modal, como la vista prèvia). */
function obrirRecordatoris() {
  exigirUsuariIntern_();
  const html = HtmlService.createTemplateFromFile('Recordatoris').evaluate().setWidth(720).setHeight(520);
  SpreadsheetApp.getUi().showModelessDialog(html, '🔔 Recordatoris');
}

/**
 * Ventana "Recordatoris": "Obrir". Selecciona la primera fila del paciente y abre el panel
 * "Completar i enviar", que lee la selección (desde ahí se reenvía el pasaporte).
 */
function obrirPacientDesdeRecordatori(codi) {
  exigirUsuariIntern_();
  try {
    const sheet = hojaPacientes();
    const { objetos } = leerPacientes(sheet);
    const i = objetos.findIndex(o => mismoCodigo(o.codi_acces, codi));
    if (i === -1) return { ok: false, message: "No hi ha cap implant amb el codi " + codi + " a la pestanya " + SHEET_NAME + ". Potser s'ha unit amb una altra fitxa." };
    SpreadsheetApp.getActiveSpreadsheet().setActiveRange(sheet.getRange(i + 2, 1));
    obrirPanellPendents();
    return { ok: true, fila: i + 2 };
  } catch (e) {
    Logger.log('Error en obrirPacientDesdeRecordatori: ' + e);
    return { ok: false, message: "No s'ha pogut obrir el pacient: " + e.message };
  }
}

/**
 * Al abrir la hoja (desde onOpen): un aviso si hay recordatorios que ya tocan. Solo lee
 * la hoja activa (vale en el onOpen simple, sin permisos) y nunca lanza.
 */
function avisarRecordatorisEnObrir_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(HOJA_RECORDATORIS);
    if (!sheet) return 0;
    const v = RecordatoriModel.vencuts(llegirRecordatoris_(sheet).objectes, avuiIso_());
    if (!v.length) return 0;
    const qui = v.slice(0, 3).map(o => String(o.nombre || o.codi_acces).trim()).join(', ') + (v.length > 3 ? '...' : '');
    ss.toast((v.length === 1 ? 'Tens 1 recordatori per revisar: ' : 'Tens ' + v.length + ' recordatoris per revisar: ') + qui +
      '. Menú ' + NOM_MENU + ' → 🔔 Recordatoris.', '🔔 Recordatoris', 20);
    return v.length;
  } catch (e) {
    Logger.log('avisarRecordatorisEnObrir_: ' + e);
    return 0;
  }
}

/**
 * Envía el pasaporte de un paciente ya guardado. Es la segunda llamada del sidebar y del
 * panel, justo después de guardar: así guardar responde enseguida y el envío (que puede
 * tardar o fallar) se ve aparte, con "Tornar a enviar" si falla.
 * @param {string} codi Codi d'accés
 * @param {{email?: boolean, avisSecretaria?: boolean, avisSiSenseEmail?: boolean,
 *   noTancarRecordatori?: boolean}} opcions ver enviarPasaport_
 */
function enviarPasaport(codi, opcions) {
  exigirUsuariIntern_();
  const o = opcions || {};
  try {
    const env = enviarPasaport_(codi, { email: !!o.email, avisSecretaria: !!o.avisSecretaria, avisSiSenseEmail: !!o.avisSiSenseEmail });
    // Recordatorios (S6): reenviar el pasaporte cierra el que ya toca. Si eso falla, el
    // envío ya ha salido: no se da por fallido (el panel lo volvería a enviar).
    let recordatoriTancat = null;
    try {
      if (typeof tancarRecordatoriSiToca_ === 'function' && !o.noTancarRecordatori) recordatoriTancat = tancarRecordatoriSiToca_(codi, env);
    } catch (e) {
      Logger.log('Error en tancar el recordatori de ' + codi + ': ' + e);
    }
    return Object.assign({ ok: true, codi: String(codi || '').trim().toUpperCase() }, env, { recordatoriTancat });
  } catch (e) {
    Logger.log('Error en enviarPasaport: ' + e);
    return { ok: false, message: 'Error en enviar: ' + e.message };
  }
}

// ==========================================
//  ENVÍOS DE EMAIL (pasaporte, recuperación, avís secretària, alerta)
// ==========================================

const EMAIL_REMITENT = 'clinicapiesteller@gmail.com';
const NOM_REMITENT = 'Doctores Pi y Esteller';
// Adonde responden los pacientes y adonde llegan los avisos para la Secretària.
const EMAIL_SECRETARIA = 'consulta@doctorpiurgell.com';
const FULL_REGISTRE = "Registre d'enviaments";

/**
 * Envía un email con las opciones comunes de la clínica (remitente, respuesta a la
 * clínica, versión en texto plano: Hotmail penaliza los emails solo HTML) y lo apunta en
 * el Registre d'enviaments.
 * @returns {{ok: boolean, message?: string}}
 */
function enviarEmail_(tipus, codi, destinatari, assumpte, text, html, extres) {
  try {
    GmailApp.sendEmail(destinatari, assumpte, text, Object.assign({
      htmlBody: html,
      name: NOM_REMITENT,
      from: EMAIL_REMITENT,
      replyTo: EMAIL_SECRETARIA
    }, extres || {}));
    registrarEnviament_(tipus, codi, destinatari, true, '');
    return { ok: true };
  } catch (e) {
    Logger.log('ERROR enviant (' + tipus + ') a ' + destinatari + ': ' + e);
    registrarEnviament_(tipus, codi, destinatari, false, String(e && e.message || e));
    return { ok: false, message: explicarErrorEnviament_(e) };
  }
}

function explicarErrorEnviament_(e) {
  const m = String(e && e.message || e);
  if (/too many times|limit|quota/i.test(m)) return "S'ha arribat al límit diari d'emails de Google. Torna-ho a provar demà.";
  if (/invalid email|invalid argument/i.test(m)) return "L'adreça d'email no és vàlida.";
  return "No s'ha pogut enviar el correu.";
}

/**
 * Apunta un envío en la pestaña "Registre d'enviaments" (la crea si no existe). Nunca
 * hace fallar el envío: si no se puede apuntar, solo queda en el log.
 */
function registrarEnviament_(tipus, codi, destinatari, ok, detall) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(FULL_REGISTRE);
    if (!sheet) {
      sheet = ss.insertSheet(FULL_REGISTRE);
      sheet.getRange(1, 1, 1, 6).setValues([['Data', 'Tipus', "Codi d'accés", 'Destinatari', 'Resultat', 'Detall']]);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    const fila = sheet.getLastRow() + 1;
    // Texto: un destinatario o un error que empiece por "=" no debe convertirse en fórmula.
    sheet.getRange(fila, 2, 1, 5).setNumberFormat('@');
    sheet.getRange(fila, 1, 1, 6).setValues([[new Date(), tipus, String(codi || ''), String(destinatari || ''), ok ? 'OK' : 'ERROR', String(detall || '')]]);
  } catch (e) {
    Logger.log('No es pot escriure al registre d\'enviaments: ' + e);
  }
}

/**
 * Envía un correo electrónico al paciente con su código de acceso.
 * @param {string} recipientEmail - El correo electrónico del paciente.
 * @param {string} patientName - El nombre del paciente.
 * @param {string} patientCode - El código único del paciente.
 */
function sendPassportEmail_(recipientEmail, patientName, patientCode) {
  if (!recipientEmail || recipientEmail.indexOf('@') === -1) {
    registrarEnviament_('pasaport', patientCode, recipientEmail, false, 'Email no vàlid');
    return { ok: false, message: 'Email no vàlid.' };
  }

  const subject = 'Su Pasaporte Implantológico - Clínica Dental Doctores Pi y Esteller';
  const webAppUrl = PortalModel.URL_PORTAL;
  const nom = PortalModel.escapar(patientName);
  const codi = PortalModel.escapar(patientCode);

  const bodyHtml = `
    <html>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f8fc;">
        <p>Estimado/a ${nom},</p>

        <p>Gracias por confiar en el equipo de la <strong>Clínica Dental Doctores Pi y Esteller</strong>. Para garantizar la máxima calidad y trazabilidad de su tratamiento, hemos generado su documentación técnica digital.</p>

        <p>A continuación encontrará su código de acceso personal. Con él podrá consultar en cualquier momento la marca, el modelo, el lote y la fecha de sus implantes.</p>
        <div style="background-color: #eef4fb; border-left: 5px solid #02234f; padding: 20px; margin: 30px 0; border-radius: 4px;">
          <p style="margin: 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Su código de acceso</p>
          <p style="margin: 5px 0 0 0; color: #02234f; font-size: 32px; font-weight: bold; letter-spacing: 2px;">${codi}</p>
        </div>

        <p style="margin-bottom: 25px;">Para ver y descargar su pasaporte (PDF), pulse el siguiente botón e introduzca el código:</p>

        <div style="text-align: center; margin-bottom: 30px;">
          <a href="${webAppUrl}" style="background-color: #02234f; color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
                Acceder a mi Pasaporte
          </a>
        </div>

        <p>Guarde este código en un lugar seguro. Si tiene alguna duda, puede responder a este correo.</p>

        <p>Atentamente,<br>
        El equipo de la Clínica Dental Doctores Pi y Esteller</p>
      </body>
    </html>
  `;
  const bodyText = `Estimado/a ${patientName}:\n\n` +
    'Hemos generado el Pasaporte Implantológico de su tratamiento en la Clínica Dental Doctores Pi y Esteller. ' +
    'Con él podrá consultar en cualquier momento la marca, el modelo, el lote y la fecha de sus implantes.\n\n' +
    `Su código de acceso: ${patientCode}\n` +
    `Entre aquí e introduzca el código: ${webAppUrl}\n\n` +
    'Guarde este código en un lugar seguro. Si tiene alguna duda, puede responder a este correo.\n\n' +
    'Atentamente,\nEl equipo de la Clínica Dental Doctores Pi y Esteller';

  return enviarEmail_('pasaport', patientCode, recipientEmail, subject, bodyText, bodyHtml);
}

/**
 * Paciente Sense email: avisa a la Secretària con quién es, el mensaje listo para
 * reenviar (botón de WhatsApp) y el pasaporte en PDF para imprimir.
 * @param {{codi_acces, nombre, cuenta_quartup, dni}} paciente
 */
function enviarAvisSecretaria_(paciente, destiProva) {
  const a = PortalModel.avisSecretaria({
    nombre: paciente.nombre,
    cuenta_quartup: paciente.cuenta_quartup,
    dni: paciente.dni,
    codi: paciente.codi_acces
  });
  let adjunts = [];
  try {
    adjunts = [generarPasaportePDF_(paciente.codi_acces)];
  } catch (e) {
    // Sin PDF el aviso sigue siendo útil: el codi y el enlace bastan.
    Logger.log('No s\'ha pogut generar el PDF per a ' + paciente.codi_acces + ': ' + e);
  }
  const desti = destiProva || EMAIL_SECRETARIA;
  const assumpte = destiProva ? '[PROVA] ' + a.assumpte : a.assumpte;
  return enviarEmail_(destiProva ? 'avís de prova' : 'avís secretària', paciente.codi_acces, desti, assumpte, a.text, a.html,
    { attachments: adjunts, replyTo: EMAIL_REMITENT });
}

/**
 * Envía el pasaporte de un paciente ya guardado (lo lee de la hoja). Con email: el email
 * del pasaporte si `email`; el avís a la Secretària si `avisSecretaria` (con o sin email)
 * o si `avisSiSenseEmail` y el paciente no tiene email.
 * Lo usan el alta, el panel "Completar i enviar" y, más adelante, los recordatorios (S6).
 * @param {{email?: boolean, avisSecretaria?: boolean, avisSiSenseEmail?: boolean}} opcions
 * @returns {{emailSent: boolean, emailError: string|null, avisSecretaria: {enviat, error}|null}}
 */
function enviarPasaport_(codi, opcions) {
  const o = opcions || {};
  const res = { emailSent: false, emailError: null, emailDesti: '', avisSecretaria: null };
  if (!o.email && !o.avisSecretaria && !o.avisSiSenseEmail) return res;
  const p = PacientModel.pacientsUnics(llegirPacientPerCodi_(codi).objetos)[0];
  if (!p) {
    res.emailError = "No trobo el pacient " + codi + '.';
    return res;
  }
  if (o.email && String(p.email).trim()) {
    const r = sendPassportEmail_(p.email, p.nombre, p.codi_acces);
    res.emailDesti = p.email;
    res.emailSent = r.ok;
    res.emailError = r.ok ? null : r.message;
  }
  if (o.avisSecretaria || (o.avisSiSenseEmail && !String(p.email).trim())) {
    const r = enviarAvisSecretaria_(p);
    res.avisSecretaria = { enviat: r.ok, error: r.ok ? null : r.message };
  }
  return res;
}

/**
 * Último pasaporte enviado a un paciente (email o avís a la Secretària), según el Registre
 * d'enviaments. Para que la Auxiliar decida si reenviarlo ("Últim enviament: fa N dies").
 * @returns {{ms: number, tipus: string}|null}
 */
function ultimEnviamentDe_(codi) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FULL_REGISTRE);
  if (!sheet || sheet.getLastRow() < 2) return null;
  let ultim = null;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues().forEach(f => {
    const tipus = String(f[1]).trim();
    if ((tipus !== 'pasaport' && tipus !== 'avís secretària') || String(f[4]).trim() !== 'OK') return;
    if (!mismoCodigo(f[2], codi)) return;
    const ms = f[0] instanceof Date ? f[0].getTime() : new Date(f[0]).getTime();
    if (!isNaN(ms) && (!ultim || ms > ultim.ms)) ultim = { ms: ms, tipus: tipus };
  });
  return ultim;
}

/**
 * Mantenimiento (desde el editor o la hoja): envía a una dirección de prueba el avís que
 * recibiría la Secretària para un paciente, para ver cómo llega (y si va a spam) sin
 * guardar nada ni molestar a la consulta. Desde el editor: DEMO2026 y la primera dirección
 * de la propiedad PROVA_EMAILS.
 */
function provarAvisSecretaria() {
  exigirUsuariIntern_();
  const titol = 'Avís de prova';
  const codi = demanar_(titol, "Codi d'accés del pacient (per exemple DEMO2026):", 'DEMO2026');
  if (codi === null) return;
  const r = llegirPacientPerCodi_(codi);
  const p = PacientModel.pacientsUnics(r.objetos)[0];
  if (!p) {
    avisar_(titol, "No trobo cap pacient amb aquest codi d'accés.");
    return;
  }
  const rEmail = demanar_(titol, "Email on vols rebre la prova (s'enviarà el mateix que rebria la consulta):", adrecesProva_()[0] || '');
  if (rEmail === null) return;
  const desti = String(rEmail || '').trim();
  if (!PacientModel.esEmail(desti)) {
    avisar_(titol, "L'email no és vàlid (des de l'editor, posa'l a la propietat PROVA_EMAILS).");
    return;
  }
  const res = enviarAvisSecretaria_(p, desti);
  avisar_(titol, res.ok
    ? `Enviat a ${desti}. Si no el veus en uns minuts, mira la carpeta de correu brossa (spam).`
    : `No s'ha pogut enviar: ${res.message}`);
}

/**
 * Mantenimiento (desde el editor): envía el email del pasaporte de DEMO2026, exactamente
 * como lo recibe un paciente, a cada dirección de la propiedad del script PROVA_EMAILS
 * (separadas por comas: una de mail-tester.com, una Hotmail, una Yahoo...). Sirve para
 * comprobar si llega a la bandeja de entrada o a spam.
 * @returns {string[]} una línea por dirección
 */
function provarEntregabilitat() {
  exigirUsuariIntern_();
  const adreces = adrecesProva_();
  if (!adreces.length) {
    avisar_("Prova d'entrega", 'Posa les adreces a la propietat del script PROVA_EMAILS (separades per comes).');
    return [];
  }
  const p = PacientModel.pacientsUnics(llegirPacientPerCodi_('DEMO2026').objetos)[0];
  if (!p) throw new Error('No trobo el pacient DEMO2026.');
  const linies = adreces.map(a => {
    const r = sendPassportEmail_(a, p.nombre, p.codi_acces);
    return a + ': ' + (r.ok ? 'enviat' : 'ERROR ' + r.message);
  });
  avisar_("Prova d'entrega", linies.join('\n'));
  return linies;
}

/**
 * Pasaporte en PDF generado en el servidor, con los mismos datos que ve el paciente en
 * el portal (lista blanca, DNI enmascarado). Mismo renderer que el portal y la vista previa.
 * @returns {Blob}
 */
function generarPasaportePDF_(codi) {
  const dades = getPatientDataVerbose_(codi);
  if (!dades.ok || !dades.found) throw new Error('No hi ha implants per al codi ' + codi);
  return pdfPasaport_(dades.implantes, dades.codi_acces);
}

/** Primera vez que salta el límite del portal: aviso al responsable (ALERT_EMAIL). */
function avisarLimitPortal_() {
  const desti = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  if (!desti) {
    Logger.log('Límit del portal assolit, però no hi ha ALERT_EMAIL a les propietats.');
    return;
  }
  const l = PortalModel.LIMIT;
  const text = `El portal del Pasaporte Implantológico ha recibido ${l.fallits} códigos incorrectos en menos de ` +
    `${l.finestraSegons / 60} minutos y se ha pausado ${l.pausaSegons / 60} minutos.\n\n` +
    'Puede ser alguien probando códigos al azar. Si se repite cada día, conviene revisarlo.\n' +
    `No se volverá a avisar en las próximas ${l.avisSegons / 3600} horas.`;
  enviarEmail_('alerta', '', desti, 'Aviso: intentos fallidos en el portal del Pasaporte', text,
    '<p>' + PortalModel.escapar(text).replace(/\n/g, '<br>') + '</p>');
}

// ==========================================
//  BÚSQUEDAS DE OPCIONES PARA SIDEBAR
// ==========================================

/**
 * Obtiene las opciones únicas de Marca, Modelo y Conexión del catálogo.
 */
function getImplantOptions() {
  exigirUsuariIntern_();
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CATALOG_SHEET_NAME);
    if (!sheet) {
      // Si la hoja no existe, devuelve un error específico
      return { ok: false, message: "No existeix la pestanya del catàleg d'implants." };
    }

    // Cada columna del catálogo es una lista independiente (updateCatalog_ las ordena por
    // separado): la fila NO empareja marca y modelo. Los pares salen de la hoja Pacientes.
    const data = sheet.getDataRange().getValues();
    const headers = (data[0] || []).map(h => PacientModel.normalitzar(h));
    const columna = nom => {
      const i = headers.indexOf(nom);
      return i === -1 ? [] : data.slice(1).map(r => r[i]);
    };
    const { objetos } = leerPacientes(hojaPacientes());
    const options = ComprovacioModel.opcionsImplant(
      { marques: columna('marca'), models: columna('modelo'), connexions: columna('conexion') }, objetos);
    return { ok: true, options: options };

  } catch (e) {
    Logger.log('Error en getImplantOptions: ' + e);
    return { ok: false, message: 'Error en carregar les opcions: ' + e.message };
  }
}

/**
 * Actualiza el catálogo manteniendo listas ÚNICAS e independientes por columna.
 * Si la Marca ya existe, no la añade, aunque el modelo sea nuevo.
 * Compacta las columnas para que no queden huecos vacíos.
 * Ojo: como cada columna se ordena aparte, una fila del catálogo no es un par marca-modelo
 * (getImplantOptions empareja desde la hoja Pacientes y descarta las erratas aprendidas).
 */
function updateCatalog_(newItem) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CATALOG_SHEET_NAME);
  
  // Si la hoja no existe, la crea
  if (!sheet) {
    sheet = ss.insertSheet(CATALOG_SHEET_NAME);
    sheet.appendRow(["Marca", "Modelo", "Conexión"]); // Cabeceras
    sheet.setFrozenRows(1);
  }

  // Función auxiliar para procesar una columna individualmente
  // colIndex: número de columna (1-based); value: el valor que queremos guardar
  function processColumn(colIndex, value) {
    if (!value || String(value).trim() === "") return; // No guardar vacíos

    const lastRow = Math.max(sheet.getLastRow(), 1);
    // Leemos toda la columna (hasta donde haya datos en la hoja)
    const range = sheet.getRange(2, colIndex, lastRow, 1);
    const currentValues = range.getValues().flat(); // Convertimos a lista simple: ["Dentsply", "Nobel", "", ""]

    // 1. Limpiamos: Quitamos vacíos existentes para tener una lista compacta
    const cleanList = currentValues.filter(item => String(item).trim() !== "");

    // 2. Normalizamos para comparar (ignoramos mayúsculas/minúsculas)
    const normalize = s => String(s).trim().toLowerCase();
    const target = normalize(value);

    // 3. Verificamos si YA existe en esta lista específica
    const exists = cleanList.some(item => normalize(item) === target);

    // 4. Si NO existe, lo añadimos y reescribimos la columna
    if (!exists) {
      cleanList.push(value); // Añadimos el nuevo valor al final de la lista limpia
      
      // Ordenamos alfabéticamente (Opcional, pero queda muy profesional para los desplegables)
      cleanList.sort(); 

      // Escribimos de vuelta la columna actualizada
      // Primero limpiamos la columna en la hoja para evitar restos viejos
      sheet.getRange(2, colIndex, lastRow + 1, 1).clearContent();
      
      // Preparamos el formato de matriz vertical para setValues: [[val1], [val2], ...]
      const writeValues = cleanList.map(v => [v]);
      sheet.getRange(2, colIndex, writeValues.length, 1).setValues(writeValues);
      
      Logger.log(`Valor añadido a columna ${colIndex}: ${value}`);
    }
  }

  // Procesamos las 3 columnas por separado, localizadas por su cabecera.
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(h => PacientModel.normalitzar(h));
  [['marca', newItem.marca], ['modelo', newItem.modelo], ['conexion', newItem.conexion]].forEach(([cab, valor]) => {
    const i = headers.indexOf(cab);
    if (i !== -1) processColumn(i + 1, valor);
  });
}

// ==========================================
//  PORTAL DEL PACIENTE (entrada solo con el Codi d'accés, ADR 0003)
// ==========================================

const MENSAJE_PAUSA = 'Demasiados intentos. Por favor, inténtelo de nuevo en unos minutos o contacte con la clínica.';

/**
 * Cuenta un intento fallido del portal y, si es la primera vez que salta el límite, avisa.
 * Con lock: sin él, peticiones en paralelo leerían el mismo contador y se perderían fallos.
 */
function contarIntentoFallido_() {
  const lock = LockService.getScriptLock();
  const bloquejat = lock.tryLock(3000);
  let r;
  try {
    r = PortalModel.registrarIntentFallit(CacheService.getScriptCache(), ahoraMs());
  } finally {
    if (bloquejat) lock.releaseLock();
  }
  if (r.nouAvis) avisarLimitPortal_();
  return r;
}

/**
 * Portal: envía el Codi d'accés al email indicado, si está registrado. Responde siempre
 * lo mismo, para no revelar qué emails existen. Cuenta para el límite de intentos: así
 * nadie puede gastar la cuota diaria de emails ni llenar el buzón de un paciente.
 * @param {string} patientEmail - El email introducido por el paciente.
 * @returns {object} Resultado de la operación (ok: boolean, message: string).
 */
function retrieveCodeByEmail(patientEmail) {
  if (!patientEmail || String(patientEmail).trim() === "") {
    return { ok: false, message: "Por favor, introduzca su dirección de correo." };
  }
  const RESPUESTA = { ok: true, message: "Si el email está registrado, en unos minutos recibirá su código. Revise también la carpeta de correo no deseado." };

  try {
    const cache = CacheService.getScriptCache();
    if (PortalModel.estaPausat(cache)) return { ok: false, message: MENSAJE_PAUSA };
    contarIntentoFallido_();

    const email = String(patientEmail).trim().toLowerCase();
    // Como mucho un envío cada 15 minutos a la misma dirección: nadie puede llenar el
    // buzón de un paciente ni gastar la cuota diaria de emails de la clínica.
    const clauEmail = 'RECUPERACIO_' + email.slice(0, 200);
    if (cache.get(clauEmail)) return RESPUESTA;
    cache.put(clauEmail, '1', 900);
    const { objetos } = leerPacientes(hojaPacientes());
    // Una familia puede compartir email: se envían todos sus códigos.
    const pacientes = PacientModel.pacientsUnics(objetos.filter(o => String(o.email).trim().toLowerCase() === email));
    if (!pacientes.length) return RESPUESTA;

    const lineasHtml = pacientes.map(p =>
      `<p style="margin:5px 0;">${PortalModel.escapar(p.nombre || 'Paciente')}: <strong style="font-size:22px;color:#02234f;letter-spacing:2px;">${PortalModel.escapar(p.codi_acces)}</strong></p>`).join('');
    const lineasText = pacientes.map(p => `${p.nombre || 'Paciente'}: ${p.codi_acces}`).join('\n');
    const html = `
        <p>Estimado/a paciente,</p>
        <p>Hemos recibido una solicitud para recuperar su código de acceso al Pasaporte Implantológico de la <strong>Clínica Dental Doctores Pi y Esteller</strong>.</p>
        <div style="background-color: #eef4fb; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 16px; font-weight: bold; color: #02234f; margin: 0 0 8px 0;">Su código de acceso:</p>
          ${lineasHtml}
        </div>
        <p>Puede consultar su pasaporte en <a href="${PortalModel.URL_PORTAL}">${PortalModel.URL_PORTAL}</a>.</p>
        <p>Si no ha solicitado este código, puede ignorar este correo.</p>
        <p>Atentamente,<br>El equipo de la Clínica Dental Doctores Pi y Esteller</p>`;
    const text = 'Hemos recibido una solicitud para recuperar su código de acceso al Pasaporte Implantológico de la Clínica Dental Doctores Pi y Esteller.\n\n' +
      lineasText + '\n\n' +
      'Puede consultar su pasaporte en ' + PortalModel.URL_PORTAL + '\n\n' +
      'Si no ha solicitado este código, puede ignorar este correo.';

    enviarEmail_('recuperació', pacientes.map(p => p.codi_acces).join(', '), email,
      'Su código de acceso al Pasaporte Implantológico - Clínica Dental Doctores Pi y Esteller', text, html);
    return RESPUESTA;

  } catch (e) {
    Logger.log("Error en retrieveCodeByEmail: " + e);
    return { ok: false, message: "No hemos podido procesar la solicitud. Inténtelo de nuevo más tarde o contacte con la clínica." };
  }
}

/**
 * Entrada al portal: con el Codi d'accés basta (sin PIN por email desde S1). El código
 * se acepta con O/0, I/L/1, minúsculas o espacios.
 * @returns {{ok, codi_acces?, implantes?, message?}}
 */
function initiateLogin(patientCode) {
  try {
    if (PortalModel.estaPausat(CacheService.getScriptCache())) return { ok: false, message: MENSAJE_PAUSA };

    const datos = getPatientDataVerbose_(patientCode);
    if (!datos.ok) return { ok: false, message: datos.message };
    if (datos.ambigu) {
      // También cuenta: si no, servir de pista gratis para quien prueba códigos.
      const r = contarIntentoFallido_();
      return { ok: false, message: r.pausat ? MENSAJE_PAUSA : datos.message };
    }
    if (!datos.found) {
      const r = contarIntentoFallido_();
      return { ok: false, message: r.pausat ? MENSAJE_PAUSA : 'Código no encontrado. Revise que esté bien escrito (son 6 caracteres).' };
    }
    const res = { ok: true, codi_acces: datos.codi_acces, implantes: datos.implantes };
    try {
      CacheService.getScriptCache().put(clauLogin_(patientCode), JSON.stringify(res), SEGONS_CACHE_LOGIN);
    } catch (e) {
      Logger.log('No es pot desar el login a la memòria cau: ' + e);
    }
    return res;

  } catch (e) {
    Logger.log("Error Login: " + e);
    return { ok: false, message: 'No hemos podido consultar el pasaporte. Inténtelo de nuevo más tarde.' };
  }
}

// ==========================================
//  LECTOR DE IMPLANTES: AUTO-DETECCIÓN DE MODELO
// ==========================================


const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
const OPENROUTER_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY');

/**
 * Synchronous httpFetch adapter ScanEngine's providers call instead of UrlFetchApp
 * directly, keeping ScanEngine.js itself GAS-agnostic.
 */
function gasHttpFetch_(url, options) {
  const params = { method: (options.method || 'get'), muteHttpExceptions: true };
  if (options.headers) {
    const headers = Object.assign({}, options.headers);
    if (headers['Content-Type']) {
      params.contentType = headers['Content-Type'];
      delete headers['Content-Type'];
    }
    if (Object.keys(headers).length > 0) {
      params.headers = headers;
    }
  }
  if (options.body !== undefined) {
    params.payload = options.body;
  }
  const res = UrlFetchApp.fetch(url, params);
  return { status: res.getResponseCode(), text: res.getContentText() };
}

function processImplantFile(data, filename) {
  exigirUsuariIntern_();
  try {
    const { mimeType, base64Data } = ScanEngine.parseDataUrl(data);

    return ScanEngine.scanPassport(base64Data, mimeType, {
      httpFetch: gasHttpFetch_,
      geminiApiKey: GEMINI_API_KEY,
      openRouterApiKey: OPENROUTER_API_KEY
    });

  } catch (e) {
    if (ScanEngine.isAuthError(e)) {
      return { ok: false, message: MENSAJE_REAUTORIZAR };
    }
    return { ok: false, message: "Error en interpretar el document: " + e.message };
  }
}

/**
 * S7: varios documentos del MISMO paciente (la ficha escaneada en archivos separados) en
 * una sola petición a la IA: una sola de la cuota gratuita. Si no cabe o falla, el sidebar
 * los manda uno a uno con processImplantFile y los junta él.
 * @param {string[]} dataUrls
 * @returns {{ok, data?, seguiment?, count?, provider?, nDocs?, message?, limit?}}
 */
function processImplantFiles(dataUrls) {
  exigirUsuariIntern_();
  try {
    const llista = Array.isArray(dataUrls) ? dataUrls.filter(Boolean) : [];
    if (!llista.length) return { ok: false, message: "No hi ha cap document per llegir." };
    if (llista.length > MAX_DOCS_PER_PETICIO) {
      return { ok: false, message: "Massa documents per a una sola lectura (" + llista.length + "; màxim " + MAX_DOCS_PER_PETICIO + ")." };
    }
    return ScanEngine.scanDocuments(llista.map(d => ScanEngine.parseDataUrl(d)), {
      httpFetch: gasHttpFetch_,
      geminiApiKey: GEMINI_API_KEY,
      openRouterApiKey: OPENROUTER_API_KEY
    });
  } catch (e) {
    if (ScanEngine.isAuthError(e)) {
      return { ok: false, message: MENSAJE_REAUTORIZAR };
    }
    return { ok: false, message: "Error en interpretar els documents: " + e.message };
  }
}

const MAX_DOCS_PER_PETICIO = 6;

const MENSAJE_REAUTORIZAR = "Aquest compte de Google encara no té autoritzats els permisos necessaris. Obre el menú 'Pasaport Implantològic 🦷', prem '🔑 Autoritzar el meu compte' i accepta els permisos que et demani Google. Després torna aquí i prova-ho de nou.";

/**
 * Autodiagnóstico del escáner, ejecutable desde el menú por cualquier usuario de la
 * hoja. Comprueba cada capa por separado (permisos del usuario actual, claves API,
 * Gemini, OpenRouter) para que un fallo diga exactamente QUÉ arreglar, en vez del
 * antiguo mensaje genérico de "límite alcanzado".
 */
function comprobarTodo() {
  exigirUsuariIntern_();
  const lineas = [];

  // Nota: aquí no se consulta ScriptApp.getAuthorizationInfo(). Llegar a ejecutar esta
  // función ya implica haber pasado el diálogo de consentimiento, así que siempre diría
  // "concedida": sería una línea que nunca puede fallar, es decir, ruido.

  // Capa 1: ¿se puede leer la base de datos?
  try {
    const hoja = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    lineas.push(hoja
      ? "✅ Base de dades: OK (" + leerPacientes(hoja).files.filter(f => !PacientModel.filaBuida(f)).length + " implants)"
      : "❌ Base de dades: no existeix la pestanya '" + SHEET_NAME + "'. Avisa en Gabriel.");
  } catch (e) {
    lineas.push("❌ Base de dades: no es pot llegir (" + e.message + ")");
  }

  let permisosOk = true;
  try {
    gasHttpFetch_('https://www.google.com', { method: 'get' });
    lineas.push("✅ Permisos d'aquest compte: OK");
  } catch (e) {
    permisosOk = false;
    lineas.push("❌ Permisos d'aquest compte: ERROR. " + MENSAJE_REAUTORIZAR);
  }

  lineas.push(GEMINI_API_KEY
    ? "✅ Clau Gemini: configurada"
    : "❌ Clau Gemini: FALTA a les Propietats de l'script. Avisa en Gabriel.");
  lineas.push(OPENROUTER_API_KEY
    ? "✅ Clau OpenRouter: configurada"
    : "❌ Clau OpenRouter: FALTA a les Propietats de l'script. Avisa en Gabriel.");

  if (permisosOk) {
    if (GEMINI_API_KEY) {
      try {
        const res = gasHttpFetch_('https://generativelanguage.googleapis.com/v1beta/models?key=' + GEMINI_API_KEY.trim(), { method: 'get' });
        if (res.status === 200) lineas.push("✅ Gemini: respon correctament");
        else if (res.status === 429) lineas.push("⚠️ Gemini: límit diari assolit (HTTP 429). L'escàner farà servir OpenRouter fins demà.");
        else lineas.push("❌ Gemini: error HTTP " + res.status + ". Avisa en Gabriel.");
      } catch (e) {
        lineas.push("❌ Gemini: sense connexió (" + e.message + ")");
      }
    }
    if (OPENROUTER_API_KEY) {
      try {
        const res = gasHttpFetch_('https://openrouter.ai/api/v1/key', {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY.trim() }
        });
        if (res.status === 200) lineas.push("✅ OpenRouter (reserva): respon correctament");
        else if (res.status === 429) lineas.push("⚠️ OpenRouter: límit diari assolit (HTTP 429).");
        else lineas.push("❌ OpenRouter: error HTTP " + res.status + ". Avisa en Gabriel.");
      } catch (e) {
        lineas.push("❌ OpenRouter: sense connexió (" + e.message + ")");
      }
    }
  } else {
    lineas.push("⏭️ Gemini i OpenRouter: no comprovats (primer arregla els permisos de dalt).");
  }

  lineas.push(diagnosticCodis_());
  lineas.push(diagnosticRebots_());

  avisar_("Diagnòstic", lineas.join("\n\n"));
}

/** Codis d'accés que el paciente no podría usar bien: convertidos a número, mal de largo o que chocan. */
function diagnosticCodis_() {
  try {
    const { objetos } = leerPacientes(hojaPacientes());
    const r = PortalModel.analitzarCodis(objetos.map(o => o.codi_acces), ['DEMO2026']);
    const problemes = [];
    if (r.numerics.length) problemes.push("convertits en número per Sheets (cal tornar a escriure'ls com a text): " + r.numerics.join(', '));
    if (r.llargadaRara.length) problemes.push('sense 6 caràcters: ' + r.llargadaRara.join(', '));
    if (r.xocs.length) problemes.push('es confonen entre ells (O/0, I/1): ' + r.xocs.map(x => x.join(' = ')).join('; ') + ". El portal no deixarà entrar amb cap d'aquests si no s'escriu exacte.");
    return problemes.length
      ? "⚠️ Codis d'accés a revisar:\n- " + problemes.join('\n- ')
      : "✅ Codis d'accés: tots correctes";
  } catch (e) {
    return "❌ Codis d'accés: no s'han pogut revisar (" + e.message + ')';
  }
}

/** Emails rebotados en los últimos 30 días, en el Gmail de la cuenta que ejecuta el diagnóstico. */
function diagnosticRebots_() {
  try {
    const fils = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:30d', 0, 50);
    const adreces = {};
    fils.forEach(f => f.getMessages().forEach(m => {
      const capcalera = String(m.getHeader('X-Failed-Recipients') || '').trim();
      let llista = capcalera ? capcalera.split(/[,\s]+/) : [];
      if (!llista.length) {
        const cos = String(m.getPlainBody() || '');
        const trobat = cos.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
        const propies = [EMAIL_REMITENT, EMAIL_SECRETARIA, emailUsuariActual_()].map(a => String(a).toLowerCase());
        llista = trobat.filter(a => !/mailer-daemon|postmaster|googlemail\.com$|google\.com$/i.test(a) && propies.indexOf(a.toLowerCase()) === -1);
      }
      llista.filter(Boolean).forEach(a => { adreces[a.toLowerCase()] = true; });
    }));
    const ll = Object.keys(adreces);
    return ll.length
      ? '⚠️ Emails que han rebotat (últims 30 dies, en aquest compte de Gmail): ' + ll.join(', ') + ". Comprova que estiguin ben escrits o fes-los arribar el codi d'una altra manera."
      : '✅ Emails rebotats: cap en els últims 30 dies (en aquest compte de Gmail)';
  } catch (e) {
    return "⏭️ Emails rebotats: no s'han pogut revisar (" + e.message + ')';
  }
}

/**
 * Contador de escaneos donde la IA dudó de alguna posición ("No especificado").
 * Sirve para decidir con datos reales si merece la pena que el modelo proponga
 * posiciones candidatas en el futuro. Llamado fire-and-forget desde el sidebar.
 */
function registrarDuda(n) {
  exigirUsuariIntern_();
  const props = PropertiesService.getScriptProperties();
  const actual = parseInt(props.getProperty('SCAN_DOUBT_COUNT'), 10) || 0;
  props.setProperty('SCAN_DOUBT_COUNT', String(actual + (parseInt(n, 10) || 1)));
}

/**
 * Punto único de autorización: toca los tres permisos que la herramienta usa de verdad,
 * de forma que una sola ejecución cubre todo. Se lanza desde el menú (no desde el panel)
 * porque solo los elementos de menú disparan el diálogo de consentimiento de Google;
 * las llamadas google.script.run del sidebar se limitan a devolver el error.
 */
function autorizarCuenta() {
  UrlFetchApp.fetch("https://www.google.com");              // script.external_request
  GmailApp.getAliases();                                    // https://mail.google.com/
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();        // spreadsheets

  SpreadsheetApp.getUi().alert(
    'Compte autoritzat ✅',
    'Aquest compte de Google ja té tots els permisos necessaris.\n\nSi el panell lateral estava obert, tanca\'l i torna\'l a obrir des del menú.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ==========================================
//  ADMINISTRACIÓN DE LA HOJA (menú)
// ==========================================

/**
 * Busca filas con Codi d'accés "undefined", "UNDEFINED" o vacío, y les asigna el código
 * correcto del paciente (si ya tiene uno en otras filas) o les genera uno nuevo.
 */
function arreglarCodigosUndefined() {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = hojaPacientes();
    const { headers, idx, files, objetos } = leerPacientes(sheet);
    
    if (idx.codi_acces === undefined) return;
    const colCodi = idx.codi_acces;
    
    let cambios = false;
    let arregladosExistentes = 0;
    let arregladosNuevos = 0;
    
    // Identificar códigos válidos por DNI o Cuenta
    const codigosPorCuenta = {};
    const codigosPorDNI = {};
    const codigosUsados = new Set();
    
    objetos.forEach(o => {
      const codi = String(o.codi_acces || '').trim().toUpperCase();
      if (codi && codi !== 'UNDEFINED' && codi !== 'NULL' && codi !== 'NAN') {
        codigosUsados.add(codi);
        const cuenta = String(o.cuenta_quartup || '').trim();
        if (cuenta) codigosPorCuenta[cuenta] = codi;
        
        const dni = o.dni ? PacientModel.netejarDocument(o.dni) : '';
        if (dni) codigosPorDNI[dni] = codi;
      }
    });
    
    // Recorrer las filas y arreglar
    files.forEach((f, indexFila) => {
      // Una fila vaciada a mano es un implante borrado, no un paciente sin código.
      if (PacientModel.filaBuida(f)) return;
      const o = objetos[indexFila];
      const codiActual = String(o.codi_acces || '').trim().toUpperCase();
      
      if (!codiActual || codiActual === 'UNDEFINED' || codiActual === 'NULL' || codiActual === 'NAN') {
        const cuenta = String(o.cuenta_quartup || '').trim();
        const dni = o.dni ? PacientModel.netejarDocument(o.dni) : '';
        
        let nuevoCodi = '';
        if (cuenta && codigosPorCuenta[cuenta]) {
          nuevoCodi = codigosPorCuenta[cuenta];
        } else if (dni && codigosPorDNI[dni]) {
          nuevoCodi = codigosPorDNI[dni];
        }
        
        if (nuevoCodi) {
          arregladosExistentes++;
        } else {
          // Generar uno nuevo si no hay ninguno
          nuevoCodi = generarCodigoUnico(Array.from(codigosUsados));
          codigosUsados.add(nuevoCodi);
          if (cuenta) codigosPorCuenta[cuenta] = nuevoCodi;
          if (dni) codigosPorDNI[dni] = nuevoCodi;
          arregladosNuevos++;
        }
        
        f[colCodi] = nuevoCodi;
        cambios = true;
      }
    });
    
    if (cambios) {
      // Escribir la columna entera de codi_acces
      ponerFormatoTexto(sheet, headers, 2, files.length);
      const aTexto = textoSiId(headers);
      const columnaCodi = files.map(f => [aTexto(f[colCodi], colCodi)]);
      sheet.getRange(2, colCodi + 1, files.length, 1).setValues(columnaCodi);
      
      avisar_('✨ Arreglo completado',
        'S\'han arreglat ' + (arregladosExistentes + arregladosNuevos) + ' codis:\n' +
        '- ' + arregladosExistentes + ' files han recuperat el codi que ja tenia el pacient.\n' +
        '- ' + arregladosNuevos + ' files de pacients sense cap codi n\'han rebut un de nou.');
    } else {
      avisar_('✅ Tot correcte', 'No s\'ha trobat cap codi "undefined" ni en blanc.');
    }
    
  } catch (e) {
    Logger.log('Error en arreglarCodigosUndefined: ' + e);
    avisar_('❌ Error intern', e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Elimina las filas 100% idénticas (mismo paciente, mismo implante, todo igual). No
 * depende de la posición de ninguna columna.
 */
function eliminarDuplicados() {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let eliminadas = 0;
  try {
    const sheet = hojaPacientes();
    const { files } = leerPacientes(sheet);
    // Las filas vaciadas a mano no son duplicados: se quedan donde están.
    const vistas = new Set();
    const repetides = [];
    files.forEach((f, i) => {
      if (PacientModel.filaBuida(f)) return;
      const clau = JSON.stringify(f.map(v => (v instanceof Date ? v.getTime() : v)));
      if (vistas.has(clau)) repetides.push(i + 2); else vistas.add(clau);
    });
    // De abajo arriba, para que los números de fila que quedan por borrar no cambien.
    repetides.reverse().forEach(n => sheet.deleteRow(n));
    eliminadas = repetides.length;
  } finally {
    lock.releaseLock();
  }
  avisar_('Neteja feta', `S'han eliminat ${eliminadas} files duplicades.`);
}

/**
 * Una sola vez (desde el editor): borra las filas vacías que sobran por debajo del margen.
 * Antes, la casilla "Pendent" llegaba hasta el final de la hoja (miles de filas), y Sheets
 * las cuenta todas al leer. Solo borra si de verdad están vacías (o con casillas sin marcar).
 */
function retallarFilesBuides() {
  exigirUsuariIntern_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let missatge;
  try {
    const sheet = hojaPacientes();
    const { headers, files } = leerPacientes(sheet);
    const finsA = files.length + 1 + MARGE_FILES; // última fila que se queda
    const maxFiles = sheet.getMaxRows();
    if (maxFiles <= finsA) {
      missatge = `No hi ha res a retallar: ${files.length} files amb dades i ${maxFiles - files.length - 1} de marge.`;
    } else {
      const sobrants = sheet.getRange(finsA + 1, 1, maxFiles - finsA, Math.max(sheet.getLastColumn(), 1)).getValues();
      const plena = sobrants.findIndex(f => !PacientModel.filaBuida(f));
      if (plena !== -1) {
        missatge = `No he retallat res: la fila ${finsA + 1 + plena} té dades. Revisa-la abans.`;
      } else {
        sheet.deleteRows(finsA + 1, maxFiles - finsA);
        assegurarMarge_(sheet, headers, files.length);
        missatge = `Fet: ${maxFiles - finsA} files buides esborrades. Queden ${files.length} files amb dades i ${MARGE_FILES} de marge.`;
      }
    }
  } finally {
    lock.releaseLock();
  }
  avisar_('Retallar files buides', missatge);
  return missatge;
}

/** Codi d'accés, Cuenta y DNI se escriben como texto (sin conversión a número). */
function textoSiId(headers) {
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const ids = [idx.codi_acces, idx.cuenta_quartup, idx.dni];
  return (v, i) => (ids.indexOf(i) !== -1 && v !== '' && v !== null && v !== undefined) ? String(v) : v;
}

/** Marcas del catálogo, para reconocerlas dentro del texto del pilar. */
function marquesCataleg_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CATALOG_SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const iMarca = (data[0] || []).map(h => String(h).trim()).indexOf('Marca');
  if (iMarca === -1) return [];
  return data.slice(1).map(f => String(f[iMarca] || '').trim()).filter((m, i, a) => m && a.indexOf(m) === i);
}

// ==========================================
//  PASAPORT: VISTA PRÈVIA I PDF (S5)
// ==========================================
// Un solo renderer (PortalModel.htmlPasaporte) para el portal, la vista previa y el PDF,
// que siempre convierte el servidor: así los tres son iguales por construcción (ADR 0004).

const LOGO_PASAPORT_URL = 'https://i.postimg.cc/tTX6JQ42/DR-PI-ESTELLER.png';

/** Incluye un archivo HTML (sin scriptlets) en una plantilla: <?!= include_('VistaPrevia') ?>. */
function include_(nom) {
  return HtmlService.createHtmlOutputFromFile(nom).getContent();
}

/**
 * Filas de un paciente -> lo que puede ver el paciente, ordenado por posición. Del estado
 * interno (casilla Pendent, S3) solo sale "pilar pendiente sí/no".
 */
function implantsPerAlPacient_(objetos) {
  return objetos
    .map(o => PortalModel.perAlPortal(o, { pilarPendiente: PacientModel.pilarPendent(o) }))
    .sort((a, b) => PacientModel.ordrePosicio(a.posicion) - PacientModel.ordrePosicio(b.posicion));
}

/**
 * El logo incrustado (data URI): el PDF no depende de que la URL externa responda en el
 * momento de convertir. En caché 6 h; si algo falla, la URL.
 */
function logoPasaport_() {
  const cache = CacheService.getScriptCache();
  try {
    const desat = cache.get('LOGO_PASAPORT');
    if (desat) return desat;
    const r = UrlFetchApp.fetch(LOGO_PASAPORT_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return LOGO_PASAPORT_URL;
    const uri = 'data:image/png;base64,' + Utilities.base64Encode(r.getContent());
    try { cache.put('LOGO_PASAPORT', uri, 21600); } catch (e) { /* más de 100 KB: sin caché */ }
    return uri;
  } catch (e) {
    return LOGO_PASAPORT_URL;
  }
}

function htmlPasaport_(implants, codi, opcions) {
  const avui = Utilities.formatDate(new Date(ahoraMs()), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return PortalModel.htmlPasaporte(implants[0] || {}, implants, codi, avui,
    Object.assign({ logo: logoPasaport_() }, opcions));
}

function pdfPasaport_(implants, codi) {
  const nom = 'Pasaporte_' + String((implants[0] && implants[0].nombre) || 'Paciente').trim().replace(/\s+/g, '_') + '.pdf';
  return Utilities.newBlob(htmlPasaport_(implants, codi), 'text/html', nom).getAs('application/pdf').setName(nom);
}

/**
 * El pasaporte que saldría al guardar este formulario y los avisos de la comprobación.
 * Sin escribir nada en la hoja. Las filas salen de PacientModel.planificarDesat, la misma
 * función que usa el guardado (S3): la vista previa y lo guardado no pueden ser distintos.
 * @returns {{ok, errors?, avisos?, implants?, codi?}}
 */
function calcularVistaPrevia_(formData) {
  const { headers, files, objetos } = leerPacientes(hojaPacientes());
  const pla = PacientModel.planificarDesat(headers, files, formData || {});
  if (pla.errors && pla.errors.length) return { ok: false, errors: pla.errors, message: pla.errors.join('\n') };
  // Las filas del propio paciente no cuentan como "conocidas": un error no se daría por bueno.
  const historic = pla.codi ? objetos.filter(o => !mismoCodigo(o.codi_acces, pla.codi)) : objetos;
  const avisos = (pla.avisos || []).concat(
    ComprovacioModel.comprovarPasaport(pla.totes, historic, { avui: new Date(ahoraMs()) }));
  return { ok: true, avisos: avisos, implants: implantsPerAlPacient_(pla.totes), codi: pla.codi || "es generarà en desar" };
}

/**
 * Panel: abre (o actualiza) la ventana de la vista previa, no modal, para poder seguir
 * corrigiendo en el panel con ella abierta. Solo mirar, imprimir y descargar: se guarda
 * desde el panel.
 * @returns {{ok, avisos?, errors?, message?}}
 */
function vistaPreviaPasaport(formData) {
  exigirUsuariIntern_();
  try {
    const r = calcularVistaPrevia_(formData);
    if (!r.ok) return r;
    const t = HtmlService.createTemplateFromFile('VistaPreviaFinestra');
    t.pasaport = htmlPasaport_(r.implants, r.codi, { nomesCos: true });
    t.avisos = r.avisos;
    // Dentro de un <script>: sin "<" literal, un "</script>" en un campo no cierra nada.
    t.formDataJson = JSON.stringify(formData || {}).replace(/</g, '\\u003c');
    SpreadsheetApp.getUi().showModelessDialog(t.evaluate().setWidth(1000).setHeight(720), 'Vista prèvia del pasaport');
    return { ok: true, avisos: r.avisos };
  } catch (e) {
    Logger.log('Error en vistaPreviaPasaport: ' + e);
    return { ok: false, message: 'No s\'ha pogut preparar la vista prèvia: ' + e.message };
  }
}

/** Ventana de la vista previa: el PDF de lo que se está viendo, para descargarlo. */
function pdfVistaPreviaPasaport(formData) {
  exigirUsuariIntern_();
  const r = calcularVistaPrevia_(formData);
  if (!r.ok) return r;
  const b = pdfPasaport_(r.implants, r.codi);
  return { ok: true, nom: b.getName(), base64: Utilities.base64Encode(b.getBytes()) };
}

/**
 * Portal: el PDF del pasaporte, que la página pide en segundo plano al entrar. Mismas
 * protecciones que la entrada (límite de intentos, lista blanca): pasa por initiateLogin.
 */
function pdfPortal_(code) {
  // El portal pide el PDF justo después de entrar: el login de hace un momento sirve.
  let r = null;
  try {
    const cache = CacheService.getScriptCache();
    const desat = PortalModel.estaPausat(cache) ? null : cache.get(clauLogin_(code));
    if (desat) r = Object.assign(JSON.parse(desat), { _deCache: true });
  } catch (e) {
    Logger.log('Memòria cau del login il·legible: ' + e);
  }
  if (!r) r = initiateLogin(code);
  if (!r.ok) return r;
  marca_(r._deCache ? 'loginDeCache' : 'login');
  const b = pdfPasaport_(r.implantes, r.codi_acces);
  marca_('pdf');
  return { ok: true, nom: b.getName(), base64: Utilities.base64Encode(b.getBytes()) };
}

// =================================================================
// NUEVA API PARA CONECTAR EL PASAPORTE CON NETLIFY
// =================================================================
function doPost(e) {
  try {
    // 1. Leemos el mensaje que nos envía Netlify
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result;
    if (params.diag === true) DIAG_ = { inici: Date.now(), passos: [] };

    // 2. Ejecutamos la función correspondiente según lo que pida Netlify
    if (action === 'retrieveCodeByEmail') {
      result = retrieveCodeByEmail(params.email);
      
    } else if (action === 'initiateLogin') {
      result = initiateLogin(params.code);

    } else if (action === 'pdfPasaporte') {
      result = pdfPortal_(params.code);

    } else {
      result = { ok: false, message: 'Acción no reconocida por el servidor.' };
    }

    // Solo tiempos, nunca datos: el portal es público.
    if (DIAG_) result = Object.assign({}, result, { _diag: { carrega_ms: DIAG_.inici - T_INICI_SCRIPT_, passos: DIAG_.passos } });
    // 3. Devolvemos la respuesta a Netlify en formato JSON
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Si hay un fallo, le avisamos a Netlify (sin detalles internos: el portal es público)
    Logger.log('Error en doPost: ' + error);
    return ContentService.createTextOutput(JSON.stringify({ok: false, message: 'No hemos podido procesar la solicitud. Inténtelo de nuevo más tarde.'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

