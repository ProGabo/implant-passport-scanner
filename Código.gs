// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = "1z3o3y1jos1vcMEVrj-xTrvzK046qZbgBHIuBBMAuy-E"; 
const SHEET_NAME = "Pacientes"; 
const CATALOG_SHEET_NAME = "Catálogo de Implantes"; // <-- NUEVA CONSTANTE

/**
 * Sirve la página principal de la aplicación web (la interfaz de búsqueda del paciente).
 * Esta función es el punto de entrada de la aplicación web publicada.
 */
function doGet() {
  const htmlOutput = HtmlService.createTemplateFromFile('Index')
      .evaluate();
      
  // *** CAMBIO CLAVE: Eliminar la barra de Apps Script ***
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
      .setTitle('Gestión Rápida de Implantes'));
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
 * Busca paciente por DNI y devuelve datos comunes para autocompletado (Usado por el Sidebar).
 * @param {string} dni El DNI a buscar.
 */
function getPatientByDNI(dni) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, message: 'Hoja no encontrada.' };

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: true, found: false, message: 'Hoja vacía.' };

    const headersLower = data[0].map(h => String(h).trim().toLowerCase());
    
    // Asumimos DNI es Columna B (índice 1). AJUSTA SI ES DIFERENTE
    let idxDNI = headersLower.indexOf('dni');
    if (idxDNI === -1) idxDNI = 1; 

    const searchNorm = _normalize(dni);
    let patientData = null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const dniVal = (idxDNI >= 0 && row[idxDNI]) ? String(row[idxDNI]) : '';
      
      if (searchNorm && _normalize(dniVal) === searchNorm) {
        const headersTrim = data[0].map(h => String(h).trim());
        
        patientData = {};
        for (let c = 0; c < headersTrim.length; c++) {
          const key = _cleanKey(headersTrim[c]);
          if (key === 'codigo' || key === 'dni' || key === 'nombre' || key === 'email') {
            patientData[key] = String(row[c]);
          }
        }
        break; 
      }
    }
    
    if (patientData) {
      return { ok: true, found: true, data: patientData };
    } else {
      return { ok: true, found: false, message: 'DNI no encontrado.' };
    }

  } catch (e) {
    Logger.log('Error en getPatientByDNI: ' + e);
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
 * * @param {object} formData - Objeto que contiene datos del paciente (dni, nombre, email, etc.) 
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
        formData.dni,           // Columna B: DNI
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
  const subject = `Pasaporte Implantológico y Código de Acceso - Clínica Dental`;
  
  // URL de la aplicación web donde el paciente puede consultar (Usamos el script ID de doGet)
  // IMPORTANTE: Debes reemplazar esta URL con la URL pública de tu implementación de doGet.
  // Por ahora, usamos un placeholder, pero es crucial que lo cambies.
  const webAppUrl = "https://script.google.com/a/tudominio.com/s/XXXXXXXXX/exec"; 
  
  const bodyHtml = `
    <html>
      <body>
        <p>Estimado/a ${patientName},</p>
        
        <p>Le escribimos desde Clínica Dental para confirmarle la colocación de su implante.</p>
        
        <p>A partir de ahora, puede acceder a su **Pasaporte Implantológico digital** donde encontrará todos los detalles técnicos y de trazabilidad de su implante.</p>
        
        <p style="padding: 15px; border: 1px solid #ddd; background-color: #f9f9f9;">
          Su **Código de Paciente** es: 
          <strong style="color: #02234f; font-size: 1.2em;">${patientCode}</strong>
        </p>
        
        <p>Puede consultar la información en el siguiente enlace:</p>
        <p><a href="${webAppUrl}">Acceder al Pasaporte Implantológico</a></p>
        
        <p>Guarde este código en un lugar seguro. Si tiene alguna duda, no dude en contactarnos.</p>
        
        <p>Atentamente,<br>
        El equipo de la Clínica Dental</p>
      </body>
    </html>
  `;
  // ------------------------------------

  try {
    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      htmlBody: bodyHtml
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
 * Revisa si la Marca, Modelo y Conexión existen en el catálogo. Si no existen, los añade.
 * @param {object} implantData - Un objeto con { marca, modelo, conexion }.
 */
function updateCatalog(implantData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CATALOG_SHEET_NAME);
    
    // Si la hoja no existe (debería existir, pero por seguridad)
    if (!sheet) {
      Logger.log('Error: Hoja de Catálogo de Implantes no encontrada para actualización.');
      return; 
    }

    const marca = implantData.marca ? String(implantData.marca).trim() : null;
    const modelo = implantData.modelo ? String(implantData.modelo).trim() : null;
    const conexion = implantData.conexion ? String(implantData.conexion).trim() : null;
    
    // Si no hay datos críticos para guardar en el catálogo, salir.
    if (!marca && !modelo && !conexion) return; 

    // Obtener los datos existentes para evitar duplicados
    const data = sheet.getDataRange().getValues();
    const existingEntries = new Set();
    
    if (data.length > 1) {
      const headers = data[0].map(h => String(h).trim());
      const idxMarca = headers.indexOf('Marca');
      const idxModelo = headers.indexOf('Modelo');
      const idxConexion = headers.indexOf('Conexión');

      // Crear claves únicas para la combinación Marca-Modelo-Conexión
      for (let i = 1; i < data.length; i++) {
        const key = `${data[i][idxMarca] || ''}|${data[i][idxModelo] || ''}|${data[i][idxConexion] || ''}`;
        existingEntries.add(key.trim());
      }
    } else if (data.length === 0) {
        // Si la hoja está totalmente vacía, añadir las cabeceras
        sheet.appendRow(['Marca', 'Modelo', 'Conexión']);
    }

    // Comprobar si la nueva entrada ya existe
    const newKey = `${marca || ''}|${modelo || ''}|${conexion || ''}`;
    
    if (!existingEntries.has(newKey)) {
      // Si es una entrada totalmente nueva, la añadimos.
      sheet.appendRow([marca, modelo, conexion]);
      Logger.log(`Añadido nuevo al catálogo: ${marca} - ${modelo} - ${conexion}`);
    }

  } catch (e) {
    Logger.log('Error en updateCatalog: ' + e.message);
  }
}

/**
 * Busca un paciente por DNI o Email y le envía su Código de Paciente por correo.
 * @param {string} dniOrEmail - El DNI o Email proporcionado por la secretaria.
 */
function sendCodeRecoveryEmail(dniOrEmail) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Hoja de Pacientes no encontrada: ' + SHEET_NAME);

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { ok: false, message: 'Catálogo de pacientes vacío.' };
    }

    const dniIndex = 1;  // Columna B: DNI
    const emailIndex = 3; // Columna D: Email
    const codeIndex = 0; // Columna A: Código Paciente

    const searchTerm = dniOrEmail.trim().toUpperCase();
    let patientFound = null;

    // Buscar en todas las filas (desde la fila 2)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowDNI = row[dniIndex] ? String(row[dniIndex]).trim().toUpperCase() : null;
      const rowEmail = row[emailIndex] ? String(row[emailIndex]).trim().toUpperCase() : null;

      if (rowDNI === searchTerm || rowEmail === searchTerm) {
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
    MailApp.sendEmail({
      to: patientFound.email,
      subject: `Recuperación de Código - Pasaporte Implantológico: ${patientFound.code}`,
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
