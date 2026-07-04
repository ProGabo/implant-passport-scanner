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
//  MENÚ Y SIDEBAR (Interfaz para la Secretaria)
// ==========================================

/**
 * Crea un menú personalizado en la interfaz de Google Sheets al abrir la hoja.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Pasaporte Implantológico 🦷')
      .addItem('➕ Añadir Implante / Paciente', 'showSidebar')
      .addSeparator()
      .addItem('🧹 Limpiar Pacientes Duplicados', 'eliminarDuplicados')
      .addToUi();
}

/**
 * Función que abre una barra lateral (Sidebar) con el formulario.
 * Necesita el archivo HTML: SidebarForm.html
 */
function showSidebar() {
  const html = HtmlService.createTemplateFromFile('SidebarForm');
  SpreadsheetApp.getUi()
      .showSidebar(html.evaluate()
      .setTitle('Escáner de Implantes'));
}


// ==========================================
//  UTILIDADES
// ==========================================

/**
 * Normaliza strings para comparaciones (quita espacios, acentos, mayúsculas)
 */
function _normalize(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]/gi, '');
}

/**
 * Limpia las cabeceras de Excel para usarlas como claves de código (ej: "Cod. Implante" -> "cod_implante")
 */
function _cleanKey(str) {
  return str.toString().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[á]/g, 'a').replace(/[é]/g, 'e').replace(/[í]/g, 'i').replace(/[ó]/g, 'o').replace(/[ú]/g, 'u')
    .replace(/\./g, '') 
    .replace(/[^a-z0-9_]/g, ''); 
}

/**
 * Función que genera código único de paciente (usa la hoja para comprobar duplicados)
 */
function generarCodigoUnico(hoja) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  const last = Math.max(hoja.getLastRow() - 1, 0);
  const existing = last > 0 ? hoja.getRange(2, 1, last, 1).getValues().flat().map(String) : [];

  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (existing.includes(code));
  return code;
}


// ==========================================
//  BÚSQUEDAS (Backend para Sidebar y Web)
// ==========================================

/**
 * Busca paciente por id_quartup y devuelve datos comunes para autocompletado (Usado por el Sidebar).
 * @param {string} id_quartup El id_quartup a buscar.
 */
function getPatientByid_quartup(id_quartup) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, message: 'Hoja no encontrada.' };

    const searchNorm = String(id_quartup).trim().toLowerCase();
    if (!searchNorm) return { ok: true, found: false, message: 'ID vacío.' };

    // 1. Usamos TextFinder: El buscador nativo ultra rápido de Google
    // Busca en toda la hoja esa coincidencia exacta
    const finder = sheet.createTextFinder(searchNorm).matchEntireCell(true).matchCase(false);
    const coincidencias = finder.findAll();

    if (coincidencias.length === 0) {
      return { ok: true, found: false, message: 'ID_Quartup no encontrado.' };
    }

    // 2. Si lo encuentra, sacamos solo los encabezados (Fila 1) 
    // y solo la fila donde se encontró el paciente (Fila X)
    const ultimaColumna = sheet.getLastColumn();
    const headersRaw = sheet.getRange(1, 1, 1, ultimaColumna).getValues()[0];
    
    // Obtenemos el número de fila del primer resultado encontrado
    const filaPaciente = coincidencias[0].getRow(); 
    const rowRaw = sheet.getRange(filaPaciente, 1, 1, ultimaColumna).getValues()[0];

    // 3. Emparejamos los datos igual que antes, pero a la velocidad de la luz
    let patientData = {};
    for (let c = 0; c < headersRaw.length; c++) {
      const headerOriginal = String(headersRaw[c]).trim();
      
      // Asumo que tienes una función _cleanKey en tu código para limpiar las cabeceras.
      // Si no, esto emula el comportamiento de tu versión anterior:
      let key = headerOriginal.toLowerCase().replace(/[^a-z0-9]/g, ''); 
      
      if (key === 'codigo' || key === 'id_quartup' || key === 'nombre' || key === 'email') {
        patientData[key] = String(rowRaw[c]);
      }
    }
    
    return { ok: true, found: true, data: patientData };

  } catch (e) {
    Logger.log('Error en getPatientByid_quartup OPTIMIZADO: ' + e);
    return { ok: false, message: 'Error interno: ' + e.message };
  }
}

/**
 * Busca TODAS las filas que coincidan con el código (usado por el Pasaporte Web para el paciente)
 */
function getPatientDataVerbose(code) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, message: 'No se encontró la hoja: ' + SHEET_NAME };

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: false, message: 'La base de datos está vacía' };

    const headersRaw = data[0];
    const headersTrim = headersRaw.map(h => String(h).trim());
    const headersLower = headersTrim.map(h => h.toLowerCase());

    let idxCodigo = headersLower.indexOf('código');
    if (idxCodigo === -1) idxCodigo = headersLower.indexOf('codigo');
    
    const rawSearch = (code === undefined || code === null) ? '' : String(code);
    const searchNorm = _normalize(rawSearch);
    const implantesEncontrados = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rawVal = (idxCodigo >= 0 && row[idxCodigo]) ? String(row[idxCodigo]) : '';
      const n = _normalize(rawVal);

      if (searchNorm && n === searchNorm) {
        const implantData = {};
        
        for (let c = 0; c < headersTrim.length; c++) {
          const hdr = headersTrim[c] || ('col_' + c);
          const key = _cleanKey(hdr); 
          const val = (row[c] !== undefined && row[c] !== null) ? row[c] : '';
          
          if (val instanceof Date) {
            implantData[key] = val.toLocaleDateString('es-ES');
          } else {
            implantData[key] = String(val);
          }
        }
        implantesEncontrados.push(implantData);
      }
    }

    if (implantesEncontrados.length > 0) {
      return { ok: true, found: true, implantes: implantesEncontrados };
    } else {
      return { ok: true, found: false, message: 'No se encontraron implantes para este código.' };
    }

  } catch (err) {
    Logger.log('ERROR: ' + err);
    return { ok: false, message: 'Error del sistema: ' + err };
  }
}


// ==========================================
//  GUARDADO DE DATOS
// ==========================================


/**
 * Guarda MÚLTIPLES implantes de una vez, crea código de paciente si no es necesario.
 * @param {object} formData - Objeto que contiene datos del paciente y el array de implantes.
 */
/**
 * Guarda MÚLTIPLES implantes de una vez, crea código de paciente si no es necesario,
 * envía el email de pasaporte y actualiza el catálogo.
 * * @param {object} formData - Objeto que contiene datos del paciente (id_quartup, nombre, email, etc.) 
 * y el array de implantes (implantes: []).
 */
function saveNewImplant(formData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Hoja de Pacientes no encontrada: ' + SHEET_NAME);
    
    // 1. Asignar/Generar Código de Paciente
    let patientCode = formData.codigo_paciente;
    if (!patientCode || patientCode === 'GENERAR') {
      patientCode = generarCodigoUnico(sheet); 
    }

    const implantsArray = formData.implantes;
    const rowsToAppend = [];
    
    // 2. Iterar sobre la lista de implantes recibida
    implantsArray.forEach(imp => {
      // Prepara la fila para la hoja de Pacientes (A-N)
      const newRow = [
        patientCode,            // Columna A: Código
        formData.id_quartup,           // Columna B: id_quartup
        formData.nombre,        // Columna C: Nombre
        formData.email,         // Columna D: Email
        imp.posicion,           // Columna E: Posición
        imp.fecha_colocacion,   // Columna F: Fecha
        imp.marca,              // Columna G: Marca
        imp.modelo,             // Columna H: Modelo
        imp.dimensiones,        // Columna I: Dimensiones
        imp.plataforma,         // Columna J: Plataforma
        imp.conexion,           // Columna K: Conexión
        imp.pilar,              // Columna L: Pilar
        imp.cod_implante,       // Columna M: Código de implante
        imp.lote                // Columna N: Lote
      ];
      rowsToAppend.push(newRow);
      
      // *** Llama a la función de actualización del catálogo (NUEVO) ***
      updateCatalog({
        marca: imp.marca, 
        modelo: imp.modelo, 
        conexion: imp.conexion
      });
      // ***************************************************************
    });

    // 3. Escribir TODAS las filas en la hoja de Pacientes (más eficiente)
    const ultimaFila = sheet.getLastRow() + 1;
    sheet.getRange(ultimaFila, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    
    // 4. Envío Opcional del Correo
    let emailStatus = { ok: true };
    if (formData.sendEmail === 'true') { 
      emailStatus = sendPassportEmail(
        formData.email, 
        formData.nombre, 
        patientCode
      );
    }
    
    return { 
      ok: true, 
      message: `${rowsToAppend.length} implante(s) añadido(s) al Código: ${patientCode}.`,
      newCode: patientCode,
      implantsCount: rowsToAppend.length,
      emailSent: (formData.sendEmail === 'true'),
      emailError: emailStatus.ok ? null : emailStatus.message
    };

  } catch (e) {
    Logger.log('Error en saveNewImplant: ' + e.message);
    return { ok: false, message: 'Error al guardar: ' + e.message };
  }
}

// === FUNCIONES DE ADMINISTRACIÓN ANTERIORES (Mantenidas) ===

function generarPasaportePDF() { 
  // Implementación original o placeholder
  const ui = SpreadsheetApp.getUi();
  ui.alert("Función PDF mantenida (versión anterior).");
}
function añadirPaciente() { 
  // Implementación original o placeholder
  const ui = SpreadsheetApp.getUi();
  ui.alert("Función 'añadirPaciente' manual anterior, ahora usa el menú 'Pasaporte Implantológico'.");
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
    return { ok: false, message: 'Email no válido.' };
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
    return { ok: false, message: 'Error al enviar el correo.' };
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
      return { ok: false, message: 'La hoja de Catálogo de Implantes no existe.' };
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
    return { ok: false, message: 'Error al obtener opciones: ' + e.message };
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
  // colIndex: 1=Marca, 2=Modelo, 3=Conexión
  // value: El valor que queremos guardar
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

  // Procesamos las 3 columnas por separado
  processColumn(1, newItem.marca);    // Columna A
  processColumn(2, newItem.modelo);   // Columna B
  processColumn(3, newItem.conexion); // Columna C
}

/**
 * Busca un paciente por id_quartup o Email y le envía su Código de Paciente por correo.
 * @param {string} id_quartupOrEmail - El id_quartup o Email proporcionado por la secretaria.
 */
function sendCodeRecoveryEmail(id_quartupOrEmail) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Hoja de Pacientes no encontrada: ' + SHEET_NAME);

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { ok: false, message: 'Catálogo de pacientes vacío.' };
    }

    const id_quartupIndex = 1;  // Columna B: id_quartup
    const emailIndex = 3; // Columna D: Email
    const codeIndex = 0; // Columna A: Código Paciente

    const searchTerm = id_quartupOrEmail.trim().toUpperCase();
    let patientFound = null;

    // Buscar en todas las filas (desde la fila 2)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowid_quartup = row[id_quartupIndex] ? String(row[id_quartupIndex]).trim().toUpperCase() : null;
      const rowEmail = row[emailIndex] ? String(row[emailIndex]).trim().toUpperCase() : null;

      if (rowid_quartup === searchTerm || rowEmail === searchTerm) {
        patientFound = {
          code: row[codeIndex],
          name: row[2], // Columna C: Nombre
          email: row[emailIndex]
        };
        // Un paciente puede tener múltiples filas de implantes, pero el código/email será el mismo
        break; 
      }
    }

    if (!patientFound) {
      return { ok: false, message: 'Paciente no encontrado o datos incorrectos.' };
    }
    
    // 3. Verificar si el paciente tiene un email válido registrado
    if (!patientFound.email || patientFound.email.indexOf('@') === -1) {
      return { ok: false, message: `Paciente encontrado, pero no tiene un email válido registrado (${patientFound.name}).` };
    }
    
    // 4. Enviar el correo con el código (usando la función de Apps Script)
    GmailApp.sendEmail(patientFound.email, `Recuperación de Código - Pasaporte Implantológico: ${patientFound.code}`, "", {
      from: "clinicapiesteller@gmail.com",
      name: "Drs. Pi y Esteller",
      body: `Estimado(a) ${patientFound.name},\n\n` +
            `Su código de paciente para el Pasaporte Implantológico es: ${patientFound.code}\n\n` +
            `Utilice este código para acceder a sus registros.\n\n` +
            `Atentamente,\n[Nombre de la Clínica]`
    });

    return { 
      ok: true, 
      message: `Código de paciente (${patientFound.code}) enviado a ${patientFound.email}.`
    };

  } catch (e) {
    Logger.log('Error en sendCodeRecoveryEmail: ' + e.message);
    return { ok: false, message: 'Error del servidor al enviar el correo: ' + e.message };
  }
}

/**
 * Busca el código de paciente asociado a un email y lo envía por correo.
 * @param {string} patientEmail - El email introducido por el paciente.
 * @returns {object} Resultado de la operación (ok: boolean, message: string).
 */
/**
 * Busca el código de paciente asociado a un email y lo envía por correo.
 * @param {string} patientEmail - El email introducido por el paciente.
 * @returns {object} Resultado de la operación (ok: boolean, message: string).
 */
function retrieveCodeByEmail(patientEmail) {
  const SHEET_NAME = 'Pacientes'; // <--- ¡Ajusta este nombre a tu hoja de datos real!
  
  if (!patientEmail || patientEmail.trim() === "") {
    return { ok: false, message: "Por favor, introduce tu dirección de correo." };
  }

  const EMAIL_ADDRESS = patientEmail.trim().toLowerCase();
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      return { ok: false, message: "Error interno: Hoja de datos no encontrada." }; 
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { ok: false, message: "Error interno: La hoja de datos está vacía." };
    }
    
    const headers = data[0].map(h => String(h).trim()); // Mantiene mayúsculas para la búsqueda

    // Buscamos los índices exactos de las cabeceras (case-sensitive, por eso usamos String(h).trim())
    const EMAIL_COL = headers.findIndex(h => h === 'Email');
    const CODIGO_COL = headers.findIndex(h => h === 'Código');
    const NAME_COL = headers.findIndex(h => h === 'Nombre');

    if (EMAIL_COL === -1 || CODIGO_COL === -1 || NAME_COL === -1) {
       // Si esto falla, revisa si hay acentos o espacios extras en tus cabeceras
       return { ok: false, message: "Error interno: Columnas 'Email', 'Código' o 'Nombre' no encontradas." }; 
    }

    // --- Búsqueda y Envío ---
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const emailEnHoja = row[EMAIL_COL] ? String(row[EMAIL_COL]).trim().toLowerCase() : '';
      
      if (emailEnHoja === EMAIL_ADDRESS) {
        const code = row[CODIGO_COL];
        const name = row[NAME_COL] || 'Paciente';
        
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

        // Este mensaje se envía si el script tuvo éxito en su ejecución
        return { ok: true, message: "El código ha sido enviado con éxito a tu correo electrónico." };
      }
    }

    // Si el bucle termina sin encontrar el email
    return { ok: false, message: "El email introducido no se encuentra registrado en nuestra base de datos." };

  } catch (e) {
    // Si ocurre cualquier error no previsto, lo reportamos al cliente (o al log)
    Logger.log("Error en retrieveCodeByEmail: " + e.toString());
    // Devolvemos un error genérico por seguridad
    return { ok: false, message: "Error en la ejecución del script. Contacte con la clínica." };
  }
}

/**
 * Procesa la hoja "CargaMasiva" e importa los pacientes al sistema.
 * Agrupa implantes por id_quartup para hacer una sola carga por paciente.
 */
function procesarCargaMasiva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CargaMasiva");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("No se encontró la hoja 'CargaMasiva'. Créala primero.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return; // Solo cabeceras

  // Asumimos orden de columnas en CargaMasiva:
  // 0:id_quartup, 1:Nombre, 2:Email, 3:Posicion, 4:Fecha, 5:Marca, 6:Modelo, 
  // 7:Dimensiones, 8:Plataforma, 9:Conexion, 10:Pilar, 11:Cod_Implante, 12:Lote, 13:ESTADO
  
  const headers = data[0];
  const rows = data.slice(1);
  const patientsMap = {};

  // 1. Agrupar filas por id_quartup
  rows.forEach((row, index) => {
    const status = row[13]; // Columna de Estado
    if (status === "OK") return; // Saltar ya procesados

    const id_quartup = String(row[0]).trim();
    if (!id_quartup) return;

    if (!patientsMap[id_quartup]) {
      patientsMap[id_quartup] = {
        id_quartup: id_quartup,
        nombre: row[1],
        email: row[2],
        codigo_paciente: "GENERAR", // Dejar que el sistema lo genere o busque
        sendEmail: "false", // No enviar emails masivos históricos para no hacer spam
        implantes: [],
        rowIndexes: [] // Guardamos qué filas de Excel son para marcar OK luego
      };
    }

    // Añadir el implante al paciente
    patientsMap[id_quartup].implantes.push({
      posicion: row[3],
      fecha_colocacion: row[4],
      marca: row[5],
      modelo: row[6],
      dimensiones: row[7],
      plataforma: row[8],
      conexion: row[9],
      pilar: row[10],
      cod_implante: row[11],
      lote: row[12]
    });
    
    patientsMap[id_quartup].rowIndexes.push(index + 2); // +2 porque data empieza en fila 1 y slice quita cabecera
  });

  // 2. Procesar cada paciente agrupado
  let successCount = 0;
  const entryList = Object.values(patientsMap);

  entryList.forEach(patientData => {
    try {
      // Usamos tu función existente saveNewImplant para mantener la lógica de negocio
      // PERO primero verificamos si el paciente ya existe para no duplicar códigos
      const existing = getPatientByid_quartup(patientData.id_quartup);
      if (existing.ok && existing.found) {
        patientData.codigo_paciente = existing.data.codigo; // Usar código existente
      }

      const result = saveNewImplant(patientData);
      
      if (result.ok) {
        // Marcar filas como OK en el Excel
        patientData.rowIndexes.forEach(rowIndex => {
          sheet.getRange(rowIndex, 14).setValue("OK"); // Columna 14 es Estado
        });
        successCount++;
      } else {
         patientData.rowIndexes.forEach(rowIndex => {
          sheet.getRange(rowIndex, 14).setValue("ERROR: " + result.message);
        });
      }

    } catch (e) {
      Logger.log("Error importando " + patientData.id_quartup + ": " + e.message);
    }
  });

  SpreadsheetApp.getUi().alert(`Proceso finalizado. ${successCount} pacientes importados/actualizados.`);
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
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    let targetEmail = null;
    let targetName = "";
    let patientFound = false; // NUEVO: variable para saber si el paciente existe
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === String(patientCode).trim().toUpperCase()) {
        // Guardamos los datos y marcamos que lo hemos encontrado
        targetEmail = data[i][3] ? String(data[i][3]).trim() : ""; // Columna D
        targetName = data[i][2];  // Columna C
        patientFound = true;
        break;
      }
    }
    
    // 1. Si no existe en la base de datos:
    if (!patientFound) {
      return { ok: false, message: 'Código de paciente no encontrado.' };
    }

    // 2. Si existe, pero NO tiene email válido:
    if (!targetEmail || targetEmail.indexOf('@') === -1) {
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
      apiKey: GEMINI_API_KEY
    });

  } catch (e) {
    if (e.message && e.message.indexOf('script.external_request') !== -1) {
      return {
        ok: false,
        message: "Esta cuenta de Google todavía no tiene autorizados los permisos necesarios. Ve a Extensiones > Apps Script, selecciona la función 'forzarPermisosGmail' en el desplegable de arriba, pulsa el botón ▶ Ejecutar y acepta los permisos que te pida Google. Después vuelve aquí y prueba de nuevo."
      };
    }
    return { ok: false, message: "Error al interpretar: " + e.message };
  }
}

function forzarPermisosGmail() {
  // Esta línea no hace nada malo, solo obliga a Google a pedirte permisos de Gmail
  GmailApp.getAliases(); 
  Logger.log("Permisos concedidos con éxito.");
}
function forzarPermisosPDF() {
  // Esta línea obliga a Google a pedirte el permiso de "script.external_request"
  UrlFetchApp.fetch("https://www.google.com"); 
}

// Añade esta nueva función al final de tu Código.js
function eliminarDuplicados() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME); // Usa tu constante
  const range = sheet.getDataRange();
  
  // Guardamos cuántas filas había antes
  const filasAntes = range.getNumRows();
  
  // IMPORTANTE: Esto elimina las filas donde TODOS los campos coinciden exactamente.
  // Si quieres que elimine basándose SOLO en el id_quartup (ej: columna B, que es la 2), 
  // cambiarías el código a: range.removeDuplicates([2]);
  range.removeDuplicates(); 
  
  // Comprobamos cuántas quedaron
  const filasDespues = sheet.getDataRange().getNumRows();
  const eliminadas = filasAntes - filasDespues;
  
  // Mostramos un mensaje a la secretaria
  SpreadsheetApp.getUi().alert('Limpieza Completada', `Se han eliminado ${eliminadas} registros duplicados.`, SpreadsheetApp.getUi().ButtonSet.OK);
}

function normalizarPosicionesDientes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const newData = [];
  
  // ¡OJO AQUÍ! Recuerda cambiar el 5 por tu columna real (A=0, B=1, C=2...)
  const COL_POSICION = 5; 

  // Guardamos los encabezados intactos
  newData.push(data[0]);

  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    let posicion = String(row[COL_POSICION]).trim();
    
    // Pasamos el texto a minúsculas para atrapar "Posible", "posible" o "POSIBLE"
    let posicionMinusculas = posicion.toLowerCase();

    // La magia está aquí: Si tiene coma Y además NO incluye la palabra "posible"
    if (posicion.includes(',') && !posicionMinusculas.includes('posible')) {
      let multiplesDientes = posicion.split(',');
      
      // Desdoblamos la fila
      multiplesDientes.forEach(diente => {
        let filaClonada = [...row]; 
        filaClonada[COL_POSICION] = diente.trim(); 
        newData.push(filaClonada);
      });
    } else {
      // Si no tiene coma, o si dice "posible", la dejamos exactamente como estaba
      newData.push(row);
    }
  }

  // Borramos los datos viejos y pegamos los nuevos
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearContent();
  sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
  
  SpreadsheetApp.getUi().alert('Éxito', 'Filas desdobladas correctamente (se ignoraron los casos "posibles").', SpreadsheetApp.getUi().ButtonSet.OK);
}

function corregirDientesAntiguos() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  // ¡AJUSTA ESTOS NÚMEROS A TUS COLUMNAS REALES! (A=0, B=1, C=2...)
  const COL_FECHA = 5; // <-- Cambia esto por la columna donde está la Fecha de Colocación
  const COL_POSICION = 4; // <-- Cambia esto por la columna donde está el Diente/Posición

  // En JavaScript, los meses empiezan en 0 (Enero = 0, Febrero = 1... Mayo = 4)
  // Por lo tanto, 17/05/2007 se escribe: new Date(2007, 4, 17)
  const fechaLimite = new Date(2007, 4, 17);
  
  let cambiosRealizados = 0;

  // Empezamos en i = 1 para no tocar la fila de los títulos
  for (let i = 1; i < data.length; i++) {
    let fechaCelda = data[i][COL_FECHA];
    
    // Verificamos que la celda contenga una fecha válida
    if (fechaCelda instanceof Date) {
      // Si la fecha es ESTRICTAMENTE anterior al 17 de mayo de 2007
      if (fechaCelda < fechaLimite) {
        data[i][COL_POSICION] = "No especificado";
        cambiosRealizados++;
      }
    }
  }

  // Si hicimos cambios, sobrescribimos la hoja con los datos corregidos
  if (cambiosRealizados > 0) {
    // Pegamos toda la matriz de datos de vuelta a la hoja
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    SpreadsheetApp.getUi().alert(
      'Limpieza Exitosa ✨', 
      `Se han corregido ${cambiosRealizados} implantes anteriores al 17/05/2007 dejándolos como "No especificado".`, 
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else {
    SpreadsheetApp.getUi().alert('Aviso', 'No se encontraron implantes anteriores a esa fecha o ya están corregidos.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function limpiarFilasConComasResiduales() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const newData = [];
  
  // ⚠️ CAMBIA EL 5 POR TU COLUMNA REAL DE LOS DIENTES:
  // A=0 | B=1 | C=2 | D=3 | E=4 | F=5 | G=6 | H=7
  const COL_POSICION = 4; 
  
  let eliminadas = 0;

  // 1. Guardamos la fila de los títulos (encabezados) intacta
  newData.push(data[0]);

  // 2. Revisamos el resto de filas una por una
  for (let i = 1; i < data.length; i++) {
    let fila = data[i];
    let posicion = String(fila[COL_POSICION]).trim();
    let posicionMinusculas = posicion.toLowerCase();
    
    // Si la celda TIENE una coma Y NO tiene la palabra "posible"
    if (posicion.includes(',') && !posicionMinusculas.includes('posible')) {
      // NO la guardamos en newData (es decir, la eliminamos virtualmente)
      eliminadas++;
    } else {
      // Si está todo bien, la guardamos en nuestra nueva lista
      newData.push(fila);
    }
  }

  // 3. Si hemos detectado filas para eliminar, actualizamos la hoja
  if (eliminadas > 0) {
    // Borramos todo el contenido de la hoja de golpe
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearContent();
    
    // Pegamos nuestra nueva lista limpia
    sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
    
    SpreadsheetApp.getUi().alert(
      'Limpieza Exitosa 🧹', 
      `Se han eliminado ${eliminadas} filas originales con comas que ya no servían.`, 
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else {
    // Si sale este mensaje, significa que el código no está encontrando las comas,
    // ¡probablemente porque el número COL_POSICION no apunta a la columna correcta!
    SpreadsheetApp.getUi().alert(
      'Aviso', 
      'No se encontró ninguna fila que borrar. Revisa que COL_POSICION sea el número de columna correcto.', 
      SpreadsheetApp.getUi().ButtonSet.WARNING
    );
  }
}
function actualizarEmailsDesdeQuartup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetPacientes = ss.getSheetByName(SHEET_NAME); // Tu hoja "Pacientes"
  const sheetQuartup = ss.getSheetByName("EmailsQuartup"); 
  
  if (!sheetQuartup) {
    SpreadsheetApp.getUi().alert('Error ❌', 'Por favor, crea una pestaña llamada "EmailsQuartup" y pega ahí los datos.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  
  // 1. Leer datos de Quartup y crear un "Diccionario en memoria"
  const dataQuartup = sheetQuartup.getDataRange().getValues();
  const diccionarioEmails = {};
  
  // Buscar en qué columnas están "Cuenta contable" y "Email" (por si cambian de orden)
  let colCuenta = 0; 
  let colEmail = 3;  
  
  const headersQuartup = dataQuartup[0].map(h => String(h).trim().toLowerCase());
  const idxCuenta = headersQuartup.indexOf('cuenta contable');
  const idxEmail = headersQuartup.indexOf('email');
  
  if (idxCuenta !== -1) colCuenta = idxCuenta;
  if (idxEmail !== -1) colEmail = idxEmail;
  
  // Llenar el diccionario
  for (let i = 1; i < dataQuartup.length; i++) {
    let cuenta = String(dataQuartup[i][colCuenta]).trim().toUpperCase();
    let email = String(dataQuartup[i][colEmail]).trim();
    
    // Solo guardamos si hay una cuenta y el email tiene formato válido (contiene @)
    if (cuenta && email.includes('@')) {
      diccionarioEmails[cuenta] = email;
    }
  }
  
  // 2. Leer la hoja principal de Pacientes
  const dataPacientes = sheetPacientes.getDataRange().getValues();
  
  // Índices en tu hoja de Pacientes: B=1 (ID_Quartup), D=3 (Email)
  const COL_ID = 1; 
  const COL_EMAIL = 3; 
  
  let actualizados = 0;
  
  // 3. Cruzar los datos
  for (let i = 1; i < dataPacientes.length; i++) {
    let idPaciente = String(dataPacientes[i][COL_ID]).trim().toUpperCase();
    
    // Si el paciente existe en nuestro diccionario de Quartup, le actualizamos el email
    if (idPaciente && diccionarioEmails[idPaciente]) {
      // Opcional: Si quieres que no sobreescriba emails que TÚ ya tenías, descomenta la siguiente línea:
      // if (String(dataPacientes[i][COL_EMAIL]).trim() !== '') continue;
      
      dataPacientes[i][COL_EMAIL] = diccionarioEmails[idPaciente];
      actualizados++;
    }
  }
  
  // 4. Guardar los datos actualizados de golpe
  if (actualizados > 0) {
    sheetPacientes.getRange(1, 1, dataPacientes.length, dataPacientes[0].length).setValues(dataPacientes);
    SpreadsheetApp.getUi().alert('Cruce Exitoso ✨', `Se han actualizado ${actualizados} emails correctamente en la base de datos.`, SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    SpreadsheetApp.getUi().alert('Aviso', 'El script se ejecutó, pero no se encontró ninguna cuenta contable nueva con email para actualizar.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function eliminarImplantesDuplicadosPorPosicion() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const newData = [];
  
  // ⚠️ VERIFICA QUE LAS COLUMNAS SEAN CORRECTAS (A=0, B=1, C=2... F=5)
  const COL_ID_QUARTUP = 1; // Columna B
  const COL_POSICION = 5;   // Columna F

  // Set es una colección ultrarrápida que nos permite saber si ya hemos visto algo antes
  const combinacionesVistas = new Set();
  let eliminadas = 0;

  // 1. Guardamos la fila de los encabezados intacta
  newData.push(data[0]);

  // 2. Revisamos cada fila
  for (let i = 1; i < data.length; i++) {
    let fila = data[i];
    let idQuartup = String(fila[COL_ID_QUARTUP]).trim().toLowerCase();
    let posicion = String(fila[COL_POSICION]).trim().toLowerCase();

    // EXCEPCIÓN MÉDICA: Si la posición es dudosa o no especificada, 
    // SIEMPRE la guardamos (no queremos borrar datos dudosos que requieren revisión manual)
    if (posicion === 'no especificado' || posicion.includes('posible') || !posicion) {
      newData.push(fila);
      continue;
    }

    // Creamos nuestra "Clave Compuesta" (Ejemplo: "q-12345_14")
    let claveCompuesta = idQuartup + "_" + posicion;

    // Si YA hemos visto a este paciente con este mismo diente...
    if (combinacionesVistas.has(claveCompuesta)) {
      // Es un duplicado: NO lo guardamos en newData, lo ignoramos.
      eliminadas++;
    } else {
      // Es la primera vez que vemos este implante en este paciente: Lo guardamos
      combinacionesVistas.add(claveCompuesta);
      newData.push(fila);
    }
  }

  // 3. Escribir los datos limpios en la hoja
  if (eliminadas > 0) {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearContent();
    sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
    
    SpreadsheetApp.getUi().alert(
      'Limpieza Avanzada Exitosa ✨', 
      `Se han eliminado ${eliminadas} filas duplicadas (Mismo paciente, mismo diente).`, 
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else {
    SpreadsheetApp.getUi().alert(
      'Todo Perfecto', 
      'No se encontraron implantes repetidos en la misma posición para ningún paciente.', 
      SpreadsheetApp.getUi().ButtonSet.OK
    );
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

