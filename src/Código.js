// --- CONFIGURACIÓN ---
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
      .addSeparator()
      .addItem('✨ Arreglar codis undefined o en blanc', 'arreglarCodigosUndefined')
      .addItem('🧹 Eliminar files duplicades', 'eliminarDuplicados')
      .addItem('🩺 Comprovar-ho tot', 'comprobarTodo')
      .addItem('✉️ Enviar un avís de prova', 'provarAvisSecretaria')
      .addSubMenu(ui.createMenu('🗂️ Migració de dades')
          .addItem('1. Migrar la fulla (una sola vegada)', 'migrarDadesS2')
          .addItem('2. Aplicar les Cuentes de la revisió', 'aplicarCuentesRevisio')
          .addItem('3. Marcar "Sense DNI" als pacients sense DNI', 'marcarSenseDniMenu')
          .addItem('4. Posar al dia els pilars ("NO" -> "Sin pilar")', 'migrarPilarsMenu'))
      .addItem('🔑 Autoritzar el meu compte', 'autorizarCuenta')
      .addToUi();
}

/**
 * Abre el sidebar. Le inyecta el código de PacientModel para que el formulario valide
 * con las mismas reglas que el servidor, sin duplicarlas.
 */
function showSidebar() {
  const html = HtmlService.createTemplateFromFile('SidebarForm');
  html.pacientModelJs = crearPacientModel.toString();
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
  const files = data.slice(1);
  return { headers, idx, files, objetos: files.map(f => PacientModel.filaAObjecte(f, idx)) };
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
        n_implants: p.n_implants
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
    const { objetos } = leerPacientes(hojaPacientes());
    const r = PortalModel.resoldreCodi(code, objetos.map(o => o.codi_acces));
    if (r.ambigu) {
      Logger.log('Codi ambigu al portal: ' + code);
      return { ok: true, found: false, ambigu: true, message: 'No podemos identificar este código. Por favor, contacte con la clínica.' };
    }
    if (!r.codi) return { ok: true, found: false, message: 'No se encontraron implantes para este código.' };

    const implantes = objetos
      .filter(o => mismoCodigo(o.codi_acces, r.codi))
      .map(o => PortalModel.perAlPortal(o));
    return { ok: true, found: true, codi_acces: String(r.codi).trim().toUpperCase(), implantes: implantes };

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
  try {
    const sheet = hojaPacientes();
    const headers = asegurarColumnas(sheet);
    const { objetos } = leerPacientes(sheet);

    const senseEmail = PacientModel.esCert(formData.sense_email);
    const senseDni = PacientModel.esCert(formData.sense_dni);
    const esNuevo = !formData.codi_acces || formData.codi_acces === 'GENERAR';
    const paciente = {
      codi_acces: esNuevo ? '' : String(formData.codi_acces).trim().toUpperCase(),
      cuenta_quartup: String(formData.cuenta_quartup || '').trim(),
      nombre: String(formData.nombre || '').trim(),
      email: senseEmail ? '' : String(formData.email || '').trim(),
      sense_email: senseEmail,
      dni: senseDni ? '' : PacientModel.netejarDocument(formData.dni),
      sense_dni: senseDni
    };

    if (!esNuevo && !objetos.some(o => mismoCodigo(o.codi_acces, paciente.codi_acces))) {
      return { ok: false, message: "El codi d'accés " + paciente.codi_acces + " no existeix. Torna a cercar el pacient." };
    }

    const { errors, avisos } = PacientModel.validarPacient(paciente, PacientModel.pacientsUnics(objetos));
    if (errors.length) {
      return { ok: false, message: errors.join('\n'), errors: errors };
    }

    if (esNuevo) {
      paciente.codi_acces = generarCodigoUnico(objetos.map(o => o.codi_acces));
    } else {
      completarDatosPaciente(sheet, headers, paciente);
    }

    const filas = (formData.implantes || []).map(imp =>
      PacientModel.objecteAFila(Object.assign({}, imp, paciente), headers));
    if (filas.length === 0) {
      return { ok: false, message: 'No hi ha cap implant per desar.' };
    }

    const primera = sheet.getLastRow() + 1;
    ponerFormatoTexto(sheet, headers, primera, filas.length);
    sheet.getRange(primera, 1, filas.length, headers.length).setValues(filas);
    ponerCasillas(sheet, headers, primera, filas.length);

    (formData.implantes || []).forEach(imp => {
      updateCatalog_({ marca: imp.marca, modelo: imp.modelo, conexion: imp.conexion });
    });

    let emailStatus = { ok: true };
    const enviar = formData.sendEmail === 'true' && !senseEmail;
    if (enviar) {
      emailStatus = sendPassportEmail_(paciente.email, paciente.nombre, paciente.codi_acces);
    }

    // Sin email, la Secretària hace llegar el codi (casilla marcada por defecto en el panel).
    let avisSecretaria = null;
    if (senseEmail && formData.avisSecretaria === 'true') {
      const r = enviarAvisSecretaria_(paciente);
      avisSecretaria = { enviat: r.ok, error: r.ok ? null : r.message };
    }

    return {
      ok: true,
      newCode: paciente.codi_acces,
      implantsCount: filas.length,
      emailSent: enviar && emailStatus.ok,
      emailError: emailStatus.ok ? null : emailStatus.message,
      avisSecretaria: avisSecretaria,
      avisos: avisos
    };

  } catch (e) {
    Logger.log('Error en saveNewImplant: ' + e.message);
    return { ok: false, message: 'Error en desar: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Paciente existente: rellena en TODAS sus filas los datos de identidad que estaban
 * vacíos (p. ej. la Cuenta Quartup de un paciente antiguo dado de alta con el DNI).
 * Nunca sobrescribe un dato ya guardado; editar datos existentes es cosa de S3.
 */
function completarDatosPaciente(sheet, headers, paciente) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const rango = sheet.getRange(2, 1, lastRow - 1, headers.length);
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
//  ENVÍOS DE EMAIL (pasaporte, recuperación, avís secretària, alerta)
// ==========================================

const EMAIL_REMITENT = 'clinicapiesteller@gmail.com';
const NOM_REMITENT = 'Drs. Pi y Esteller';
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

  const subject = 'Su Pasaporte Implantológico - Clínica Drs. Pi y Esteller';
  const webAppUrl = PortalModel.URL_PORTAL;
  const nom = PortalModel.escapar(patientName);
  const codi = PortalModel.escapar(patientCode);

  const bodyHtml = `
    <html>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f8fc;">
        <p>Estimado/a ${nom},</p>

        <p>Gracias por confiar en el equipo de la <strong>Clínica Dental Drs. Pi y Esteller</strong>. Para garantizar la máxima calidad y trazabilidad de su tratamiento, hemos generado su documentación técnica digital.</p>

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
        El equipo de la Clínica Drs. Pi y Esteller</p>
      </body>
    </html>
  `;
  const bodyText = `Estimado/a ${patientName}:\n\n` +
    'Hemos generado el Pasaporte Implantológico de su tratamiento en la Clínica Dental Drs. Pi y Esteller. ' +
    'Con él podrá consultar en cualquier momento la marca, el modelo, el lote y la fecha de sus implantes.\n\n' +
    `Su código de acceso: ${patientCode}\n` +
    `Entre aquí e introduzca el código: ${webAppUrl}\n\n` +
    'Guarde este código en un lugar seguro. Si tiene alguna duda, puede responder a este correo.\n\n' +
    'Atentamente,\nEl equipo de la Clínica Drs. Pi y Esteller';

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
 * Menú: envía a la dirección que se indique el avís que recibiría la Secretària para un
 * paciente, para ver cómo llega (y si va a spam) sin guardar nada ni molestar a la consulta.
 */
function provarAvisSecretaria() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const rCodi = ui.prompt('Avís de prova', "Codi d'accés del pacient (per exemple DEMO2026):", ui.ButtonSet.OK_CANCEL);
  if (rCodi.getSelectedButton() !== ui.Button.OK) return;
  const { objetos } = leerPacientes(hojaPacientes());
  const r = PortalModel.resoldreCodi(rCodi.getResponseText(), objetos.map(o => o.codi_acces));
  if (!r.codi) {
    ui.alert('Avís de prova', "No trobo cap pacient amb aquest codi d'accés.", ui.ButtonSet.OK);
    return;
  }
  const p = PacientModel.pacientsUnics(objetos.filter(o => mismoCodigo(o.codi_acces, r.codi)))[0];
  const rEmail = ui.prompt('Avís de prova', "Email on vols rebre la prova (s'enviarà el mateix que rebria la consulta):", ui.ButtonSet.OK_CANCEL);
  if (rEmail.getSelectedButton() !== ui.Button.OK) return;
  const desti = String(rEmail.getResponseText() || '').trim();
  if (!PacientModel.esEmail(desti)) {
    ui.alert('Avís de prova', "L'email no és vàlid.", ui.ButtonSet.OK);
    return;
  }
  const res = enviarAvisSecretaria_(p, desti);
  ui.alert('Avís de prova', res.ok
    ? `Enviat a ${desti}. Si no el veus en uns minuts, mira la carpeta de correu brossa (spam).`
    : `No s'ha pogut enviar: ${res.message}`, ui.ButtonSet.OK);
}

/**
 * Pasaporte en PDF generado en el servidor, con los mismos datos que ve el paciente en
 * el portal (lista blanca, DNI enmascarado). S5 lo convertirá en el renderer único.
 * @returns {Blob}
 */
function generarPasaportePDF_(codi) {
  const dades = getPatientDataVerbose_(codi);
  if (!dades.ok || !dades.found) throw new Error('No hi ha implants per al codi ' + codi);
  const pacient = dades.implantes[0];
  const avui = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const html = PortalModel.htmlPasaporte(pacient, dades.implantes, dades.codi_acces, avui);
  const nom = 'Pasaporte_' + String(pacient.nombre || 'Paciente').trim().replace(/\s+/g, '_') + '.pdf';
  return Utilities.newBlob(html, 'text/html', nom).getAs('application/pdf').setName(nom);
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

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      // Si solo tiene cabeceras, devuelve listas vacías
      return { ok: true, options: { brands: [], modelsByBrand: {}, allConnections: [] } };
    }

    const headers = data[0].map(h => String(h).trim());
    const dataRows = data.slice(1);
    
    // Obtener los índices de las columnas importantes
    const idxMarca = headers.indexOf('Marca');
    const idxModelo = headers.indexOf('Modelo');
    const idxConexion = headers.indexOf('Conexión');
    
    // Estructuras para almacenar las opciones
    const options = {
      brands: new Set(),
      modelsByBrand: {}, // { 'MarcaA': [ModeloX, ModeloY], ... }
      allConnections: new Set()
    };
    
    // Recorrer los datos y construir las listas
    dataRows.forEach(row => {
      const marca = row[idxMarca] ? String(row[idxMarca]).trim() : null;
      const modelo = row[idxModelo] ? String(row[idxModelo]).trim() : null;
      const conexion = row[idxConexion] ? String(row[idxConexion]).trim() : null;

      if (marca) {
        options.brands.add(marca);
        
        if (!options.modelsByBrand[marca]) {
          options.modelsByBrand[marca] = new Set();
        }
        if (modelo) {
          options.modelsByBrand[marca].add(modelo);
        }
      }
      
      if (conexion) {
        options.allConnections.add(conexion);
      }
    });

    // Convertir Sets a Arrays ordenados
    const result = {
      brands: Array.from(options.brands).sort(),
      allConnections: Array.from(options.allConnections).sort(),
      modelsByBrand: {}
    };
    
    for (const brand in options.modelsByBrand) {
      result.modelsByBrand[brand] = Array.from(options.modelsByBrand[brand]).sort();
    }

    return { ok: true, options: result };

  } catch (e) {
    Logger.log('Error en getImplantOptions: ' + e);
    return { ok: false, message: 'Error en carregar les opcions: ' + e.message };
  }
}

/**
 * Actualiza el catálogo manteniendo listas ÚNICAS e independientes por columna.
 * Si la Marca ya existe, no la añade, aunque el modelo sea nuevo.
 * Compacta las columnas para que no queden huecos vacíos.
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
        <p>Hemos recibido una solicitud para recuperar su código de acceso al Pasaporte Implantológico de la <strong>Clínica Dental Drs. Pi y Esteller</strong>.</p>
        <div style="background-color: #eef4fb; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 16px; font-weight: bold; color: #02234f; margin: 0 0 8px 0;">Su código de acceso:</p>
          ${lineasHtml}
        </div>
        <p>Puede consultar su pasaporte en <a href="${PortalModel.URL_PORTAL}">${PortalModel.URL_PORTAL}</a>.</p>
        <p>Si no ha solicitado este código, puede ignorar este correo.</p>
        <p>Atentamente,<br>El equipo de la Clínica Dental Drs. Pi y Esteller</p>`;
    const text = 'Hemos recibido una solicitud para recuperar su código de acceso al Pasaporte Implantológico de la Clínica Dental Drs. Pi y Esteller.\n\n' +
      lineasText + '\n\n' +
      'Puede consultar su pasaporte en ' + PortalModel.URL_PORTAL + '\n\n' +
      'Si no ha solicitado este código, puede ignorar este correo.';

    enviarEmail_('recuperació', pacientes.map(p => p.codi_acces).join(', '), email,
      'Recuperación de su código de acceso al Pasaporte Implantológico', text, html);
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
    return { ok: true, codi_acces: datos.codi_acces, implantes: datos.implantes };

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
      ? "✅ Base de dades: OK (" + Math.max(hoja.getLastRow() - 1, 0) + " files)"
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

  SpreadsheetApp.getUi().alert("Diagnòstic", lineas.join("\n\n"), SpreadsheetApp.getUi().ButtonSet.OK);
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

// Alias de compatibilidad con el nombre anterior del diagnóstico.
function comprobarEscaner() {
  comprobarTodo();
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

// Alias de compatibilidad: hay instrucciones antiguas (WhatsApp, sessions/2026-07-09-resume.md)
// que nombran estas dos funciones.
function forzarPermisosGmail() {
  autorizarCuenta();
}
function forzarPermisosPDF() {
  autorizarCuenta();
}

// ==========================================
//  ADMINISTRACIÓN DE LA HOJA (menú)
// ==========================================

/**
 * Elimina las filas 100% idénticas (mismo paciente, mismo implante, todo igual). No
 * depende de la posición de ninguna columna.
 */
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
      
      SpreadsheetApp.getUi().alert('✨ Arreglo completado\n\n' +
        'S\'han arreglat ' + (arregladosExistentes + arregladosNuevos) + ' codis:\n' +
        '- ' + arregladosExistentes + ' files han recuperat el codi que ja tenia el pacient.\n' +
        '- ' + arregladosNuevos + ' files de pacients sense cap codi n\'han rebut un de nou.');
    } else {
      SpreadsheetApp.getUi().alert('✅ Tot correcte. No s\'ha trobat cap codi "undefined" ni en blanc.');
    }
    
  } catch (e) {
    Logger.log('Error en arreglarCodigosUndefined: ' + e);
    SpreadsheetApp.getUi().alert('❌ Error intern: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

function eliminarDuplicados() {
  exigirUsuariIntern_();
  const sheet = hojaPacientes();
  const range = sheet.getDataRange();
  const filasAntes = range.getNumRows();

  range.removeDuplicates();

  const eliminadas = filasAntes - sheet.getDataRange().getNumRows();
  SpreadsheetApp.getUi().alert('Neteja feta', `S'han eliminat ${eliminadas} files duplicades.`, SpreadsheetApp.getUi().ButtonSet.OK);
}

const HOJA_REVISION = 'Revisió migració';
const CAB_REVISION = ["Codi d'accés", 'Nom', 'DNI', 'Nº implants', 'Valor antic', 'Motiu', 'Cuenta Quartup (a omplir)', 'Resultat', 'Unir'];
const NOTA_UNIR = "Si la Cuenta ja és d'una altra fitxa i és la MATEIXA persona, escriu SÍ: s'uneixen les dues fitxes i es queda el codi d'accés d'aquesta fila.";

/**
 * Migración S2 (una sola vez, idempotente): reordena la hoja al formato nuevo con
 * cabeceras en catalán, separa los DNIs que estaban en la columna del identificador,
 * marca "Sense email" a quien no tiene email y crea la pestaña "Revisió migració" con
 * los pacientes que necesitan su Cuenta Quartup. Antes hace una copia de la pestaña.
 */
function migrarDadesS2() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = hojaPacientes();
  const data = sheet.getDataRange().getValues();

  let plan;
  try {
    plan = PacientModel.planificarMigracio(data[0] || [], data.slice(1));
  } catch (e) {
    ui.alert('No es pot migrar', e.message, ui.ButtonSet.OK);
    return;
  }

  const r = plan.recompte;
  const lineas = [
    `Files d'implants: ${r.files} (${r.pacients} pacients)`,
    `DNIs que passen de la columna de l'identificador a la columna DNI: ${r.mogutsADni} files`,
    `Files sense email (es marcaran "Sense email"): ${r.senseEmail}`,
    `Pacients sense Cuenta Quartup (aniran a la pestanya "${HOJA_REVISION}"): ${r.senseCuenta}`,
    `Pacients amb dades a revisar: ${r.revisar}`
  ];
  if (r.columnesDesconegudes.length) {
    lineas.push(`Columnes no reconegudes (es conserven al final): ${r.columnesDesconegudes.join(', ')}`);
  }
  lineas.push('', "Abans de canviar res es farà una còpia de la pestanya. Vols continuar?");
  const resumen = lineas.join('\n');

  if (ui.alert('Migració de dades', resumen, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
    sheet.copyTo(ss).setName('Còpia abans S2 ' + stamp);

    const numFilas = plan.files.length;
    const numCols = plan.capcaleres.length;

    // Se vacía todo (valores, formatos y validaciones de la disposición antigua: las
    // columnas cambian de sitio y un formato viejo caería sobre otro dato) y se reescribe.
    const todo = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
    todo.clearContent();
    todo.clearFormat();
    todo.clearDataValidations();

    if (sheet.getMaxColumns() < numCols) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, numCols).setValues([plan.capcaleres]).setFontWeight('bold');
    if (numFilas > 0) {
      ponerFormatoTexto(sheet, plan.capcaleres, 2, numFilas);
      const { idx } = PacientModel.indexarCapcaleres(plan.capcaleres);
      sheet.getRange(2, idx.fecha_colocacion + 1, numFilas, 1).setNumberFormat('dd/mm/yyyy');
      sheet.getRange(2, 1, numFilas, numCols).setValues(plan.files.map(f => f.map(textoSiId(plan.capcaleres))));
      ponerCasillas(sheet, plan.capcaleres, 2, numFilas);
    }
    sheet.setFrozenRows(1);

    crearHojaRevision(ss, plan.revisio);
  } finally {
    lock.releaseLock();
  }

  ui.alert('Migració feta ✅',
    plan.revisio.length
      ? `Ara omple la columna "Cuenta Quartup (a omplir)" de la pestanya "${HOJA_REVISION}" (${plan.revisio.length} pacients) i després prem:\n${NOM_MENU} → 🗂️ Migració de dades → 2. Aplicar les Cuentes de la revisió.`
      : 'Tots els pacients tenen la seva Cuenta Quartup. No cal revisar res.',
    ui.ButtonSet.OK);
}

/** Codi d'accés, Cuenta y DNI se escriben como texto (sin conversión a número). */
function textoSiId(headers) {
  const { idx } = PacientModel.indexarCapcaleres(headers);
  const ids = [idx.codi_acces, idx.cuenta_quartup, idx.dni];
  return (v, i) => (ids.indexOf(i) !== -1 && v !== '' && v !== null && v !== undefined) ? String(v) : v;
}

function crearHojaRevision(ss, revisio) {
  let hoja = ss.getSheetByName(HOJA_REVISION);
  if (hoja) ss.deleteSheet(hoja);
  if (!revisio.length) return;

  hoja = ss.insertSheet(HOJA_REVISION);
  const filas = revisio.map(r => [r.codi_acces, r.nombre, r.dni, r.n_implants, r.valor_antic, r.motiu, '', '', '']);
  hoja.getRange(1, 1, 1, CAB_REVISION.length).setValues([CAB_REVISION]).setFontWeight('bold');
  hoja.getRange(2, 7, filas.length, 1).setNumberFormat('@');
  hoja.getRange(2, 1, filas.length, CAB_REVISION.length).setValues(filas);
  hoja.getRange(2, 7, filas.length, 1).setBackground('#fef9c3');
  hoja.getRange(1, 7).setNote("Busca el pacient a Quartup (pel DNI o pel nom) i copia aquí el número de 'Cuenta'. Només xifres.");
  hoja.getRange(1, 9).setNote(NOTA_UNIR);
  hoja.setFrozenRows(1);
  hoja.autoResizeColumns(1, CAB_REVISION.length);
}

/**
 * Escribe las Cuentes rellenadas en "Revisió migració" en todas las filas de cada
 * paciente. Valida formato y unicidad, y deja el resultado en la columna "Resultat".
 */
function aplicarCuentesRevisio() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const hojaRev = ss.getSheetByName(HOJA_REVISION);
  if (!hojaRev) {
    ui.alert('Res a aplicar', `No existeix la pestanya "${HOJA_REVISION}".`, ui.ButtonSet.OK);
    return;
  }

  // Las pestañas de revisión creadas antes de existir la fusión no tienen la columna "Unir".
  if (String(hojaRev.getRange(1, CAB_REVISION.length).getValue()).trim() !== CAB_REVISION[8]) {
    hojaRev.getRange(1, CAB_REVISION.length).setValue(CAB_REVISION[8]).setFontWeight('bold').setNote(NOTA_UNIR);
  }

  const rev = hojaRev.getDataRange().getValues();
  const cab = rev[0].map(h => String(h).trim());
  const iCodi = cab.indexOf(CAB_REVISION[0]);
  const iCuenta = cab.indexOf(CAB_REVISION[6]);
  const iRes = cab.indexOf(CAB_REVISION[7]);
  const iUnir = cab.indexOf(CAB_REVISION[8]);
  if (iCodi === -1 || iCuenta === -1 || iRes === -1 || iUnir === -1) {
    ui.alert('Error', `La pestanya "${HOJA_REVISION}" no té les columnes esperades. Torna a executar la migració.`, ui.ButtonSet.OK);
    return;
  }
  const esSi = v => ['SI', 'SÍ', 'S', 'YES', 'TRUE', 'VERDADERO'].indexOf(String(v).trim().toUpperCase()) !== -1;
  const revisions = rev.slice(1).map(f => ({ codi_acces: f[iCodi], cuenta_quartup: f[iCuenta], unir: esSi(f[iUnir]) }));

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let resultado;
  try {
    const sheet = hojaPacientes();
    const { headers, files } = leerPacientes(sheet);
    resultado = PacientModel.aplicarRevisio(headers, files, revisions);
    if (resultado.aplicats.length) escribirColumnasPaciente(sheet, headers, resultado.files);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
    return;
  } finally {
    lock.releaseLock();
  }

  const porCodigo = {};
  resultado.aplicats.forEach(a => {
    porCodigo[a.codi_acces] = a.unitAmb
      ? `✅ Aplicada i unida amb la fitxa de ${a.unitAmb.nombre} (el codi ${a.unitAmb.codi_acces} ja no existeix)`
      : '✅ Aplicada';
  });
  resultado.errors.forEach(e => { porCodigo[e.codi_acces] = '❌ ' + e.motiu; });
  const columnaRes = rev.slice(1).map((f, i) => {
    const codi = String(f[iCodi] || '').trim().toUpperCase();
    return [porCodigo[codi] !== undefined ? porCodigo[codi] : rev[i + 1][iRes]];
  });
  if (columnaRes.length) hojaRev.getRange(2, iRes + 1, columnaRes.length, 1).setValues(columnaRes);

  const pendientes = revisions.filter(r => String(r.cuenta_quartup || '').trim() === '').length;
  ui.alert('Cuentes aplicades',
    `Pacients actualitzats: ${resultado.aplicats.length} (${resultado.filesTocades} files d'implants)\n` +
    `Amb error (mira la columna "Resultat"): ${resultado.errors.length}\n` +
    `Encara per omplir: ${pendientes}`,
    ui.ButtonSet.OK);
}

/**
 * Marca "Sense DNI" a todos los pacientes sin DNI: no lo tenemos, y así el panel no lo
 * pide. Si más adelante llega (p. ej. de Quartup), al ponerlo se desmarca.
 */
function marcarSenseDniMenu() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const sheet = hojaPacientes();
  let previa;
  try {
    const { headers, files } = leerPacientes(sheet);
    previa = PacientModel.marcarSenseDni(headers, files);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
    return;
  }
  if (!previa.pacients) {
    ui.alert('Res a marcar', 'Tots els pacients ja tenen DNI o "Sense DNI".', ui.ButtonSet.OK);
    return;
  }
  const ok = ui.alert('Marcar "Sense DNI"',
    `Es marcarà "Sense DNI" a ${previa.pacients} pacients (${previa.filesTocades} files d'implants) que no tenen DNI. Vols continuar?`,
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // Se recalcula dentro del lock: mientras el diálogo estaba abierto el panel pudo guardar.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let r;
  try {
    const { headers, idx, files } = leerPacientes(sheet);
    r = PacientModel.marcarSenseDni(headers, files);
    if (r.pacients) {
      sheet.getRange(2, idx.sense_dni + 1, r.files.length, 1).setValues(r.files.map(f => [PacientModel.esCert(f[idx.sense_dni])]));
      ponerCasillas(sheet, headers, 2, r.files.length);
    }
  } finally {
    lock.releaseLock();
  }
  ui.alert('Fet ✅', `"Sense DNI" marcat a ${r.pacients} pacients.`, ui.ButtonSet.OK);
}

/**
 * S4: pone el pilar de las filas antiguas en el vocabulario nuevo ("NO" -> "Sin pilar",
 * "Multi-unit 3 mm" -> "Multi-unit" + alçada 3) y crea las columnas de detalles del pilar.
 * Idempotente: se puede volver a lanzar sin cambiar nada.
 */
function migrarPilarsMenu() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const sheet = hojaPacientes();
  let previa;
  try {
    asegurarColumnas(sheet);
    const { headers, files } = leerPacientes(sheet);
    previa = PacientModel.planificarMigracioPilars(headers, files);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
    return;
  }
  const altres = previa.altres.length
    ? `\n\nAquests valors no es toquen (revisa'ls a mà si cal): ${previa.altres.slice(0, 15).join(' | ')}${previa.altres.length > 15 ? '...' : ''}`
    : '';
  if (!previa.filesTocades) {
    ui.alert('Res a canviar', 'Els pilars ja estan al dia.' + altres, ui.ButtonSet.OK);
    return;
  }
  const ok = ui.alert('Posar al dia els pilars',
    `Es canviaran ${previa.filesTocades} files d'implants:\n` +
    `- ${previa.sensePilar} amb "NO" passen a "Sin pilar"\n` +
    `- ${previa.multiUnit} Multi-unit passen a tipus + alçada (mm) a la seva columna` +
    altres + '\n\nVols continuar?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // Se recalcula dentro del lock: mientras el diálogo estaba abierto el panel pudo guardar.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let r;
  try {
    const { headers, idx, files } = leerPacientes(sheet);
    r = PacientModel.planificarMigracioPilars(headers, files);
    if (r.filesTocades) {
      ponerFormatoTexto(sheet, headers, 2, r.files.length);
      sheet.getRange(2, idx.pilar + 1, r.files.length, 1).setValues(r.files.map(f => [f[idx.pilar]]));
      sheet.getRange(2, idx.pilar_altura + 1, r.files.length, 1).setValues(r.files.map(f => [f[idx.pilar_altura]]));
    }
  } finally {
    lock.releaseLock();
  }
  ui.alert('Fet ✅', `${r.filesTocades} files d'implants actualitzades.`, ui.ButtonSet.OK);
}

/**
 * Cruce de emails desde un export de Quartup pegado en la pestaña "EmailsQuartup"
 * (columnas "Cuenta contable" y "Email"). Rellena el email por Cuenta Quartup y desmarca
 * "Sense email" de quien lo recibe. Base del futuro cruce automático de Cuentes.
 */
function actualizarEmailsDesdeQuartup() {
  exigirUsuariIntern_();
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetQuartup = ss.getSheetByName("EmailsQuartup");
  if (!sheetQuartup) {
    ui.alert('Error ❌', 'Crea una pestanya anomenada "EmailsQuartup" i enganxa-hi les dades de Quartup.', ui.ButtonSet.OK);
    return;
  }

  const dataQuartup = sheetQuartup.getDataRange().getValues();
  const cabQ = dataQuartup[0].map(h => PacientModel.normalitzar(h));
  const colCuenta = cabQ.indexOf('cuentacontable') !== -1 ? cabQ.indexOf('cuentacontable') : cabQ.indexOf('cuenta');
  const colEmail = cabQ.indexOf('email');
  if (colCuenta === -1 || colEmail === -1) {
    ui.alert('Error ❌', 'La pestanya "EmailsQuartup" ha de tenir les columnes "Cuenta contable" (o "Cuenta") i "Email".', ui.ButtonSet.OK);
    return;
  }

  const emailsPorCuenta = {};
  dataQuartup.slice(1).forEach(f => {
    const cuenta = String(f[colCuenta]).trim();
    const email = String(f[colEmail]).trim();
    if (cuenta && PacientModel.esEmail(email)) emailsPorCuenta[cuenta] = email;
  });

  const sheet = hojaPacientes();
  const { idx, files } = leerPacientes(sheet);
  if (idx.cuenta_quartup === undefined || idx.email === undefined) {
    ui.alert('Error ❌', 'No trobo les columnes "Cuenta Quartup" i "Email" a la fulla de pacients.', ui.ButtonSet.OK);
    return;
  }

  let actualizados = 0;
  files.forEach(f => {
    const email = emailsPorCuenta[String(f[idx.cuenta_quartup]).trim()];
    if (email && String(f[idx.email]).trim() !== email) {
      f[idx.email] = email;
      if (idx.sense_email !== undefined) f[idx.sense_email] = false;
      actualizados++;
    }
  });

  if (actualizados > 0) {
    sheet.getRange(2, idx.email + 1, files.length, 1).setValues(files.map(f => [f[idx.email]]));
    if (idx.sense_email !== undefined) {
      sheet.getRange(2, idx.sense_email + 1, files.length, 1).setValues(files.map(f => [PacientModel.esCert(f[idx.sense_email])]));
    }
    ui.alert('Creuament fet ✨', `S'han actualitzat ${actualizados} emails.`, ui.ButtonSet.OK);
  } else {
    ui.alert('Avís', "No s'ha trobat cap email nou per actualitzar.", ui.ButtonSet.OK);
  }
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

    // 2. Ejecutamos la función correspondiente según lo que pida Netlify
    if (action === 'retrieveCodeByEmail') {
      result = retrieveCodeByEmail(params.email);
      
    } else if (action === 'initiateLogin') {
      result = initiateLogin(params.code);

    } else {
      result = { ok: false, message: 'Acción no reconocida por el servidor.' };
    }

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

