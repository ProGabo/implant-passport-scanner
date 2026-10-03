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
      .addItem('🧹 Eliminar files duplicades', 'eliminarDuplicados')
      .addItem('🩺 Comprovar-ho tot', 'comprobarTodo')
      .addSubMenu(ui.createMenu('🗂️ Migració de dades')
          .addItem('1. Migrar la fulla (una sola vegada)', 'migrarDadesS2')
          .addItem('2. Aplicar les Cuentes de la revisió', 'aplicarCuentesRevisio')
          .addItem('3. Marcar "Sense DNI" als pacients sense DNI', 'marcarSenseDniMenu'))
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

function hojaPacientes() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
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

/** Columnas que se guardan como texto, para que Sheets no convierta 012345 o 4300... en número. */
function ponerFormatoTexto(sheet, headers, filaInicio, numFilas) {
  if (numFilas <= 0) return;
  const { idx } = PacientModel.indexarCapcaleres(headers);
  ['codi_acces', 'cuenta_quartup', 'dni'].forEach(k => {
    if (idx[k] !== undefined) sheet.getRange(filaInicio, idx[k] + 1, numFilas, 1).setNumberFormat('@');
  });
}

/**
 * Genera un Codi d'accés de 6 caracteres que no exista ya.
 * @param {string[]} existentes códigos ya usados
 */
function generarCodigoUnico(existentes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const usados = existentes.map(c => String(c).trim().toUpperCase());
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (usados.includes(code));
  return code;
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
 * Busca TODAS las filas-implante de un Codi d'accés (portal del paciente). Devuelve las
 * claves estables del registro, independientes del texto de las cabeceras.
 */
function getPatientDataVerbose(code) {
  try {
    const { objetos } = leerPacientes(hojaPacientes());
    const busca = String(code === undefined || code === null ? '' : code).trim();
    if (!busca) return { ok: true, found: false, message: 'No se encontraron implantes para este código.' };

    const implantes = objetos
      .filter(o => mismoCodigo(o.codi_acces, busca))
      .map(o => {
        const out = {};
        PacientModel.COLUMNES.forEach(c => {
          const v = o[c.clau];
          out[c.clau] = v instanceof Date ? v.toLocaleDateString('es-ES') : String(v);
        });
        return out;
      });

    if (implantes.length > 0) {
      return { ok: true, found: true, implantes: implantes };
    }
    return { ok: true, found: false, message: 'No se encontraron implantes para este código.' };

  } catch (err) {
    Logger.log('ERROR: ' + err);
    return { ok: false, message: 'Error del sistema: ' + err };
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
      updateCatalog({ marca: imp.marca, modelo: imp.modelo, conexion: imp.conexion });
    });

    let emailStatus = { ok: true };
    const enviar = formData.sendEmail === 'true' && !senseEmail;
    if (enviar) {
      emailStatus = sendPassportEmail(paciente.email, paciente.nombre, paciente.codi_acces);
    }

    return {
      ok: true,
      newCode: paciente.codi_acces,
      implantsCount: filas.length,
      emailSent: enviar && emailStatus.ok,
      emailError: emailStatus.ok ? null : emailStatus.message,
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

/**
 * Envía un correo electrónico al paciente con su código de acceso.
 * @param {string} recipientEmail - El correo electrónico del paciente.
 * @param {string} patientName - El nombre del paciente.
 * @param {string} patientCode - El código único del paciente.
 */
function sendPassportEmail(recipientEmail, patientName, patientCode) {
  if (!recipientEmail || recipientEmail.indexOf('@') === -1) {
    Logger.log("Error: No se puede enviar el correo. Email no válido: " + recipientEmail);
    // Puedes devolver un error, pero lo manejamos de forma silenciosa si es un error de formato.
    return { ok: false, message: 'Email no vàlid.' };
  }

  // --- CONFIGURACIÓN DEL MENSAJE ---
  const subject = `Código de Acceso de Pasaporte Implantológico - Drs. Pi y Esteller `;
  
  // URL de la aplicación web donde el paciente puede consultar (Usamos el script ID de doGet)
  // IMPORTANTE: Debes reemplazar esta URL con la URL pública de tu implementación de doGet.
  // Por ahora, usamos un placeholder, pero es crucial que lo cambies.
  const webAppUrl = "https://clinicapiestellercom.netlify.app/"; 
  
  const bodyHtml = `
    <html>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f8fc;">
        <p>Estimado/a ${patientName},</p>
        
        <p>Gracias por confiar en el equipo de la <strong>Clínica Dental Dr. Pi Esteller</strong>. Para garantizar la máxima calidad y trazabilidad de su tratamiento, hemos generado su documentación técnica digital.</p>
        
        <p>A continuación encontrará su clave de acceso personal. Con ella podrá consultar en cualquier momento la marca, modelo, lote y fecha de sus implantes.</p>
        <div style="background-color: #eef4fb; border-left: 5px solid #02234f; padding: 20px; margin: 30px 0; border-radius: 4px;">
          <p style="margin: 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Su Código de Paciente</p>
          <p style="margin: 5px 0 0 0; color: #02234f; font-size: 32px; font-weight: bold; letter-spacing: 2px;">${patientCode}</p>
        </div>
        
        <p style="margin-bottom: 25px;">Para ver y descargar su certificado oficial (PDF), haga clic en el siguiente botón:</p>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <a href="${webAppUrl}" style="background-color: #02234f; color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
                Acceder a mi Pasaporte
          </a>
        </div>
        
        <p>Guarde este código en un lugar seguro. Si tiene alguna duda, no dude en contactarnos.</p>
        
        <p>Atentamente,<br>
        El equipo de la Clínica Drs. Pi y Esteller</p>
      </body>
    </html>
  `;
  // ------------------------------------

  try {
    GmailApp.sendEmail(recipientEmail, subject, "", {
      htmlBody: bodyHtml,
      name: "Drs. Pi y Esteller", // Nombre que verá el paciente
      from: "clinicapiesteller@gmail.com"  // Tu dirección específica
    });
    Logger.log('Email de pasaporte enviado con éxito a: %s', recipientEmail);
    return { ok: true };

  } catch (e) {
    Logger.log('ERROR al enviar correo a %s: %s', recipientEmail, e);
    return { ok: false, message: "No s'ha pogut enviar el correu." };
  }
}

// ==========================================
//  BÚSQUEDAS DE OPCIONES PARA SIDEBAR
// ==========================================

/**
 * Obtiene las opciones únicas de Marca, Modelo y Conexión del catálogo.
 */
function getImplantOptions() {
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
function updateCatalog(newItem) {
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

/**
 * Portal: busca el Codi d'accés asociado a un email y lo envía por correo al paciente.
 * @param {string} patientEmail - El email introducido por el paciente.
 * @returns {object} Resultado de la operación (ok: boolean, message: string).
 */
function retrieveCodeByEmail(patientEmail) {
  if (!patientEmail || patientEmail.trim() === "") {
    return { ok: false, message: "Por favor, introduce tu dirección de correo." };
  }

  const EMAIL_ADDRESS = patientEmail.trim().toLowerCase();

  try {
    const { objetos } = leerPacientes(hojaPacientes());
    const paciente = objetos.find(o => String(o.email).trim().toLowerCase() === EMAIL_ADDRESS);

    if (!paciente) {
      return { ok: false, message: "El email introducido no se encuentra registrado en nuestra base de datos." };
    }

    const code = paciente.codi_acces;
    const name = paciente.nombre || 'Paciente';

    GmailApp.sendEmail(EMAIL_ADDRESS, "Recuperación de Código de Pasaporte de Implantes", "", {
      from: "clinicapiesteller@gmail.com",
      name: "Drs. Pi i Esteller",
      htmlBody: `
        <p>Estimado/a ${name},</p>
        <p>Hemos recibido una solicitud para recuperar tu código de paciente para el Pasaporte de Implantes de la <strong>Clínica Dental Dr. Pi Esteller</strong>.</p>

        <div style="background-color: #eef4fb; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 18px; font-weight: bold; color: #02234f; margin: 0;">Tu Código de Paciente es:</p>
          <h2 style="font-size: 28px; color: #02234f; margin: 5px 0;">${code}</h2>
        </div>

        <p>Puedes usar este código para acceder a todos los detalles técnicos de tus implantes en nuestra web.</p>
        <p>Atentamente,<br>Equipo de la Clínica Dental Dr. Pi Esteller</p>
      `
    });

    return { ok: true, message: "El código ha sido enviado con éxito a tu correo electrónico." };

  } catch (e) {
    Logger.log("Error en retrieveCodeByEmail: " + e.toString());
    // Mensaje genérico hacia el paciente; el detalle queda en el log.
    return { ok: false, message: "Error en la ejecución del script. Contacte con la clínica." };
  }
}

// ==========================================
//  SEGURIDAD Y AUTENTICACIÓN (2FA)
// ==========================================

/**
 * PASO 1: Iniciar sesión.
 * Verifica si el código existe y envía un OTP al email asociado.
 */
function initiateLogin(patientCode) {
  try {
    const { objetos } = leerPacientes(hojaPacientes());
    const paciente = objetos.find(o => mismoCodigo(o.codi_acces, patientCode));

    // 1. Si no existe en la base de datos:
    if (!paciente) {
      return { ok: false, message: 'Código de paciente no encontrado.' };
    }

    const targetEmail = String(paciente.email || '').trim();
    const targetName = paciente.nombre;

    // 2. "Sense email" o sin email válido: acceso directo, sin PIN (comportamiento
    //    previo a S2; quitar o no el 2FA se decide en S1).
    if (paciente.sense_email || !targetEmail || targetEmail.indexOf('@') === -1) {
      // Obtenemos los datos del paciente directamente
      const dataResponse = getPatientDataVerbose(patientCode); 
      return { 
        ok: true, 
        skipOTP: true, 
        message: 'Acceso directo (sin email).',
        implantes: dataResponse.implantes // Enviamos los implantes para mostrar el pasaporte
      };
    }

    // 3. Si existe y SÍ tiene email, hacemos el OTP (tu código original intacto):
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const cache = CacheService.getScriptCache();
    cache.put('OTP_' + patientCode.toUpperCase(), pin, 600);
    
    // Enviar Email
    GmailApp.sendEmail(targetEmail, `Su código de seguridad: ${pin}`, "", {
      from: "clinicapiesteller@gmail.com",
      name: "Drs. Pi i Esteller",
      htmlBody: `
        <div style="font-family: sans-serif; padding: 20px; color: #02234f;">
          <h3>Verificación de Seguridad</h3>
          <p>Hola ${targetName},</p>
          <p>Para acceder a su Pasaporte Implantológico, introduzca el siguiente código de seguridad en la web:</p>
          <div style="background: #eef4fb; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; border-radius: 8px;">
            ${pin}
          </div>
          <p style="font-size: 12px; color: #666;">Este código expira en 10 minutos.</p>
        </div>
      `
    });

    const maskedEmail = targetEmail.replace(/^(.)(.*)(.@.*)$/, (match, a, b, c) => a + '***' + c);

    return { 
      ok: true, 
      requiresOTP: true, 
      skipOTP: false,
      maskedEmail: maskedEmail, 
      message: 'Código encontrado. Verificación enviada.' 
    };

  } catch (e) {
    Logger.log("Error Login: " + e);
    return { ok: false, message: 'Error real: ' + e.message };
  }
}

function verifyOTPAndGetData(patientCode, inputPin) {
  try {
    const cache = CacheService.getScriptCache();
    const storedPin = cache.get('OTP_' + patientCode.toUpperCase());
    
    if (!storedPin) {
      return { ok: false, message: 'El código de seguridad ha caducado. Vuelve a empezar.' };
    }
    
    if (storedPin !== inputPin) {
      return { ok: false, message: 'Código de seguridad incorrecto.' };
    }
    
    // ¡ÉXITO! Borramos el PIN para que no se pueda reusar (opcional, pero buena práctica)
    cache.remove('OTP_' + patientCode.toUpperCase());
    
    // AHORA sí llamamos a la función que busca los datos (la que ya tenías)
    // Reutilizamos tu función getPatientDataVerbose existente
    const dataResponse = getPatientDataVerbose(patientCode);
    
    return dataResponse; // Devuelve { ok: true, implantes: [...] }

  } catch (e) {
    return { ok: false, message: 'Error verificando credenciales.' };
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
function gasHttpFetch(url, options) {
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
  try {
    const { mimeType, base64Data } = ScanEngine.parseDataUrl(data);

    return ScanEngine.scanPassport(base64Data, mimeType, {
      httpFetch: gasHttpFetch,
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
    gasHttpFetch('https://www.google.com', { method: 'get' });
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
        const res = gasHttpFetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + GEMINI_API_KEY.trim(), { method: 'get' });
        if (res.status === 200) lineas.push("✅ Gemini: respon correctament");
        else if (res.status === 429) lineas.push("⚠️ Gemini: límit diari assolit (HTTP 429). L'escàner farà servir OpenRouter fins demà.");
        else lineas.push("❌ Gemini: error HTTP " + res.status + ". Avisa en Gabriel.");
      } catch (e) {
        lineas.push("❌ Gemini: sense connexió (" + e.message + ")");
      }
    }
    if (OPENROUTER_API_KEY) {
      try {
        const res = gasHttpFetch('https://openrouter.ai/api/v1/key', {
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

  SpreadsheetApp.getUi().alert("Diagnòstic", lineas.join("\n\n"), SpreadsheetApp.getUi().ButtonSet.OK);
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
function eliminarDuplicados() {
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
 * Cruce de emails desde un export de Quartup pegado en la pestaña "EmailsQuartup"
 * (columnas "Cuenta contable" y "Email"). Rellena el email por Cuenta Quartup y desmarca
 * "Sense email" de quien lo recibe. Base del futuro cruce automático de Cuentes.
 */
function actualizarEmailsDesdeQuartup() {
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
      
    } else if (action === 'verifyOTPAndGetData') {
      result = verifyOTPAndGetData(params.currentPatientCode, params.pin);
      
    } else {
      result = { ok: false, message: 'Acción no reconocida por el servidor.' };
    }

    // 3. Devolvemos la respuesta a Netlify en formato JSON
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Si hay un fallo, le avisamos a Netlify
    return ContentService.createTextOutput(JSON.stringify({ok: false, message: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

