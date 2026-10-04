// ==========================================
//  PacientModel - modelo de datos de la hoja "Pacientes"
// ==========================================
// JS puro, sin SpreadsheetApp ni nada de Apps Script. Funciona como global de GAS
// (Código.js lo usa para todo acceso a la hoja), como módulo de Node (tests) y dentro
// del sidebar: showSidebar() inyecta el código de crearPacientModel en el HTML, de modo
// que las reglas de validación existen en un solo sitio.
//
// Regla de oro: la hoja se lee y se escribe SIEMPRE por cabecera, nunca por índice.
// El código usa claves estables (`cuenta_quartup`, `posicion`...); la cabecera visible
// es solo una etiqueta y puede cambiar sin romper nada. Los alias permiten leer tanto
// las cabeceras antiguas (castellano, `id_quartup`) como las nuevas (catalán).

function crearPacientModel() {

  // Orden canónico de la hoja: primero los datos del paciente, juntos; después los del
  // implante. Cada fila de la hoja es un implante y repite los datos del paciente.
  const COLUMNES = [
    { clau: 'codi_acces', capcalera: "Codi d'accés", grup: 'pacient', text: true, alies: ['Código', 'Codigo', 'Código Paciente', 'Código de paciente'] },
    { clau: 'cuenta_quartup', capcalera: 'Cuenta Quartup', grup: 'pacient', text: true, alies: ['id_quartup', 'ID Quartup', 'Cuenta'] },
    { clau: 'nombre', capcalera: 'Nom', grup: 'pacient', alies: ['Nombre', 'Nombre Completo'] },
    { clau: 'email', capcalera: 'Email', grup: 'pacient', alies: ['Correo', 'E-mail', 'Correo electrónico'] },
    { clau: 'sense_email', capcalera: 'Sense email', grup: 'pacient', casella: true, alies: [] },
    { clau: 'dni', capcalera: 'DNI', grup: 'pacient', text: true, alies: ['NIF', 'DNI/NIE'] },
    { clau: 'sense_dni', capcalera: 'Sense DNI', grup: 'pacient', casella: true, alies: [] },
    { clau: 'posicion', capcalera: 'Posició', grup: 'implant', alies: ['Posición', 'Posición diente', 'Diente'] },
    { clau: 'fecha_colocacion', capcalera: 'Data de col·locació', grup: 'implant', alies: ['Fecha', 'Fecha de colocación', 'Fecha colocación', 'Data'] },
    { clau: 'marca', capcalera: 'Marca', grup: 'implant', alies: [] },
    { clau: 'modelo', capcalera: 'Model', grup: 'implant', alies: ['Modelo'] },
    { clau: 'dimensiones', capcalera: 'Dimensions', grup: 'implant', alies: ['Dimensiones'] },
    { clau: 'plataforma', capcalera: 'Plataforma', grup: 'implant', alies: [] },
    { clau: 'conexion', capcalera: 'Connexió', grup: 'implant', alies: ['Conexión'] },
    { clau: 'pilar', capcalera: 'Pilar', grup: 'implant', alies: ['Pilar transepitelial', 'Aditamentos'] },
    // Detalles del pilar (S4): opcionales. Como texto, para que Sheets no convierta
    // "0196" en 196 ni "1.5" en una fecha.
    { clau: 'pilar_altura', capcalera: 'Pilar alçada (mm)', grup: 'implant', text: true, alies: ['Pilar alçada', 'Pilar altura', 'Altura pilar'] },
    { clau: 'pilar_angulacion', capcalera: 'Pilar angulació (º)', grup: 'implant', text: true, alies: ['Pilar angulació', 'Pilar angulación', 'Angulación pilar'] },
    { clau: 'pilar_marca', capcalera: 'Pilar marca', grup: 'implant', alies: ['Marca pilar'] },
    { clau: 'pilar_conexion', capcalera: 'Pilar connexió', grup: 'implant', alies: ['Pilar conexión', 'Conexión pilar'] },
    { clau: 'pilar_ref', capcalera: 'Pilar ref', grup: 'implant', text: true, alies: ['Pilar referència', 'Pilar referencia', 'Ref pilar'] },
    { clau: 'cod_implante', capcalera: 'Codi implant', grup: 'implant', alies: ['Código de implante', 'Cod. Implante', 'Código implante', 'Referencia'] },
    { clau: 'lote', capcalera: 'Lot', grup: 'implant', alies: ['Lote'] },
    // Ciclo de vida (S3): a este implante aún le falta algo. Lo marca la Auxiliar; es
    // interno y nunca sale hacia el paciente.
    { clau: 'pendent', capcalera: 'Pendent', grup: 'implant', casella: true, alies: ['Pendiente'] },
    { clau: 'que_falta', capcalera: 'Què falta', grup: 'implant', text: true, alies: ['Que falta', 'Qué falta'] }
  ];

  const CAPCALERES = COLUMNES.map(c => c.capcalera);
  const CLAUS_PACIENT = COLUMNES.filter(c => c.grup === 'pacient').map(c => c.clau);

  // "Codi d'accés" -> "codidacces"; "Posición" -> "posicion". Solo para emparejar.
  function normalitzar(s) {
    return String(s === undefined || s === null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const PER_NOM = {};
  COLUMNES.forEach(c => {
    [c.clau, c.capcalera].concat(c.alies).forEach(nom => { PER_NOM[normalitzar(nom)] = c.clau; });
  });

  /**
   * @returns {{ idx: Object<string, number>, desconegudes: number[] }} clave -> índice de
   *   columna, y los índices de las cabeceras que no son de ninguna columna conocida.
   */
  function indexarCapcaleres(headers) {
    const idx = {};
    const desconegudes = [];
    headers.forEach((h, i) => {
      const clau = PER_NOM[normalitzar(h)];
      if (clau && idx[clau] === undefined) idx[clau] = i;
      else if (String(h).trim() !== '') desconegudes.push(i);
    });
    return { idx, desconegudes };
  }

  function filaAObjecte(fila, idx) {
    const obj = {};
    COLUMNES.forEach(c => {
      const i = idx[c.clau];
      const v = i === undefined ? '' : fila[i];
      obj[c.clau] = c.casella ? esCert(v) : (v === undefined || v === null ? '' : v);
    });
    return obj;
  }

  /** Fila alineada con `headers`; las columnas que no son del registro quedan vacías. */
  function objecteAFila(obj, headers) {
    return headers.map(h => {
      const clau = PER_NOM[normalitzar(h)];
      if (!clau) return '';
      const v = obj[clau];
      return v === undefined || v === null ? '' : v;
    });
  }

  function esCert(v) {
    return v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim().toUpperCase() === 'VERDADERO';
  }

  /**
   * Cuántas filas de datos (sin cabecera) hay hasta la última con algo escrito. Una casilla
   * vacía vale FALSE, y "Pendent" tiene casillas hasta el final de la hoja: getLastRow()
   * daría la última fila de la hoja y lo nuevo se guardaría allí abajo.
   */
  function filesAmbDades(files) {
    for (let i = files.length - 1; i >= 0; i--) {
      if (files[i].some(v => v !== '' && v !== null && v !== undefined && v !== false)) return i + 1;
    }
    return 0;
  }

  // --- Identificadores ---

  // DNI: 8 dígitos + letra. NIE: X/Y/Z + 7 dígitos + letra. Se toleran espacios y guiones.
  const RE_DNI = /^[XYZ]?\d{7,8}[A-Z]$/;

  function netejarDocument(v) {
    return String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');
  }

  function esDni(v) {
    return RE_DNI.test(netejarDocument(v));
  }

  /** @returns {'cuenta'|'dni'|'buit'|'revisar'} */
  function classificarIdentificador(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') return 'buit';
    if (/^\d+$/.test(s)) return 'cuenta';
    if (esDni(s)) return 'dni';
    return 'revisar';
  }

  function esEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  }

  // --- Validación al guardar ---

  /**
   * Reglas del alta de un paciente (sidebar y servidor). Los errores bloquean el guardado;
   * los avisos no.
   * @param {object} p { cuenta_quartup, nombre, email, sense_email, dni, sense_dni, codi_acces }
   *   `codi_acces` vacío o 'GENERAR' = paciente nuevo.
   * @param {object[]} [existents] pacientes ya guardados ({ cuenta_quartup, codi_acces, nombre }).
   *   Sin él no se comprueba la unicidad (el sidebar no tiene la hoja; el servidor sí).
   */
  function validarPacient(p, existents) {
    const errors = [];
    const avisos = [];
    const cuenta = String(p.cuenta_quartup || '').trim();
    const tipus = classificarIdentificador(cuenta);

    if (tipus === 'buit') {
      errors.push("Falta la Cuenta Quartup. És el número de 'Cuenta' del pacient a Quartup.");
    } else if (tipus === 'dni') {
      errors.push("A la Cuenta Quartup hi ha un DNI. El DNI va al seu camp; aquí va el número de 'Cuenta' de Quartup (només xifres).");
    } else if (tipus === 'revisar') {
      errors.push("La Cuenta Quartup només pot tenir xifres (ex: 43001234).");
    } else {
      if (cuenta.indexOf('430') !== 0) {
        avisos.push("Les Cuentes de Quartup solen començar per 430. Comprova que sigui correcta.");
      }
      const codiPropi = String(p.codi_acces || '').trim().toUpperCase();
      const altre = (existents || []).find(e =>
        String(e.cuenta_quartup || '').trim() === cuenta &&
        String(e.codi_acces || '').trim().toUpperCase() !== codiPropi);
      if (altre) {
        errors.push(`Aquesta Cuenta Quartup ja és de ${altre.nombre || 'un altre pacient'} (codi ${altre.codi_acces}). Cerca'l primer per afegir-hi implants o, si és la mateixa persona, uneix les fitxes.`);
      }
    }

    if (!String(p.nombre || '').trim()) errors.push('Falta el nom del pacient.');

    if (!esCert(p.sense_email)) {
      const email = String(p.email || '').trim();
      if (!email) errors.push("Falta l'email. Si el pacient no en té, marca 'Sense email'.");
      else if (!esEmail(email)) errors.push("L'email no és vàlid.");
    }

    if (!esCert(p.sense_dni)) {
      const dni = String(p.dni || '').trim();
      if (!dni) errors.push("Falta el DNI. Si el pacient no en té, marca 'Sense DNI'.");
      else if (!esDni(dni)) errors.push('El DNI no és vàlid (ha d\'acabar en lletra, ex: 12345678A o X1234567L).');
    }

    return { errors, avisos };
  }

  /** Un registro por paciente (por Codi d'accés), a partir de las filas-implante. */
  function pacientsUnics(objectes) {
    const perCodi = {};
    const ordre = [];
    objectes.forEach(o => {
      const codi = String(o.codi_acces || '').trim().toUpperCase();
      if (!codi) return;
      if (!perCodi[codi]) {
        perCodi[codi] = { codi_acces: codi, cuenta_quartup: '', nombre: '', email: '', dni: '', n_implants: 0 };
        ordre.push(codi);
      }
      const p = perCodi[codi];
      p.n_implants++;
      ['cuenta_quartup', 'nombre', 'email', 'dni'].forEach(k => {
        if (!p[k] && String(o[k] || '').trim()) p[k] = String(o[k]).trim();
      });
    });
    return ordre.map(c => perCodi[c]);
  }

  // --- Filas ---

  /**
   * Fila sin nada escrito: celdas vacías o casillas sin marcar. Así queda una fila cuando la
   * Auxiliar borra su contenido, que es la forma de borrar un implante: hay que saltársela.
   */
  function filaBuida(fila) {
    return fila.every(v => v === '' || v === null || v === undefined || v === false);
  }

  // --- Fusión de dos fichas de la misma persona ---

  /**
   * Plan puro para unir dos fichas que son la misma persona (p. ej. la auxiliar la dio de
   * alta con el DNI y ya estaba importada con su Cuenta). Todas las filas-implante pasan
   * al `codiQueQueda` (el que el paciente ha recibido por email) y los datos de paciente se
   * completan entre las dos fichas. Si las dos tienen Cuenta o DNI distintos, no son la
   * misma persona: error y no se toca nada.
   * @returns {{ files: any[][], errors: string[], avisos: string[], pacient: object, filesMogudes: number }}
   */
  function planificarFusio(headers, files, codiQueQueda, codiQueMarxa) {
    const { idx } = indexarCapcaleres(headers);
    const queda = String(codiQueQueda || '').trim().toUpperCase();
    const marxa = String(codiQueMarxa || '').trim().toUpperCase();
    const errors = [];
    const avisos = [];
    const objectes = files.map(f => filaAObjecte(f, idx));
    const codiDe = o => String(o.codi_acces || '').trim().toUpperCase();
    const pQueda = pacientsUnics(objectes.filter(o => codiDe(o) === queda))[0];
    const pMarxa = pacientsUnics(objectes.filter(o => codiDe(o) === marxa))[0];

    if (!queda || !marxa || queda === marxa) errors.push('Cal indicar dues fitxes diferents.');
    if (!pQueda) errors.push(`No trobo la fitxa ${queda}.`);
    if (!pMarxa) errors.push(`No trobo la fitxa ${marxa}.`);
    if (errors.length) return { files, errors, avisos, pacient: null, filesMogudes: 0 };

    const ambDades = (a, b) => (String(a || '').trim() ? a : b);
    const cuentaA = String(pQueda.cuenta_quartup).trim();
    const cuentaB = String(pMarxa.cuenta_quartup).trim();
    if (cuentaA && cuentaB && cuentaA !== cuentaB) errors.push(`Tenen Cuentes diferents (${cuentaA} i ${cuentaB}).`);
    const dniA = netejarDocument(pQueda.dni);
    const dniB = netejarDocument(pMarxa.dni);
    if (dniA && dniB && dniA !== dniB) errors.push(`Tenen DNIs diferents (${dniA} i ${dniB}).`);
    if (errors.length) return { files, errors, avisos, pacient: null, filesMogudes: 0 };

    const emailA = String(pQueda.email).trim();
    const emailB = String(pMarxa.email).trim();
    if (emailA && emailB && emailA.toLowerCase() !== emailB.toLowerCase()) {
      avisos.push(`Tenen emails diferents: es queda ${emailA}.`);
    }

    const filesDe = codi => objectes.filter(o => codiDe(o) === codi);
    const senseEmail = filesDe(queda).concat(filesDe(marxa)).some(o => o.sense_email);
    const senseDni = filesDe(queda).concat(filesDe(marxa)).some(o => o.sense_dni);
    const pacient = {
      codi_acces: queda,
      cuenta_quartup: ambDades(cuentaA, cuentaB),
      nombre: ambDades(pQueda.nombre, pMarxa.nombre),
      email: ambDades(emailA, emailB),
      dni: ambDades(dniA, dniB)
    };
    pacient.sense_email = !pacient.email && senseEmail;
    pacient.sense_dni = !pacient.dni && senseDni;

    let filesMogudes = 0;
    const novesFiles = files.map((f, i) => {
      const codi = codiDe(objectes[i]);
      if (codi !== queda && codi !== marxa) return f;
      if (codi === marxa) filesMogudes++;
      const copia = f.slice();
      CLAUS_PACIENT.forEach(k => { if (idx[k] !== undefined) copia[idx[k]] = pacient[k]; });
      return copia;
    });

    return { files: novesFiles, errors, avisos, pacient, filesMogudes };
  }

  /**
   * Corrige la Cuenta Quartup de una ficha (caso raro: chocaba con otra persona porque
   * estaba mal puesta). `novaCuenta` vacía = se quita y la ficha queda sin Cuenta.
   * @returns {{ files: any[][], errors: string[], filesTocades: number }}
   */
  function planificarCanviCuenta(headers, files, codi, novaCuenta) {
    const { idx } = indexarCapcaleres(headers);
    const c = String(codi || '').trim().toUpperCase();
    const nova = String(novaCuenta === undefined || novaCuenta === null ? '' : novaCuenta).trim();
    const errors = [];
    const objectes = files.map(f => filaAObjecte(f, idx));
    const codiDe = o => String(o.codi_acces || '').trim().toUpperCase();
    if (!objectes.some(o => codiDe(o) === c)) errors.push(`No trobo la fitxa ${c}.`);
    if (nova) {
      const tipus = classificarIdentificador(nova);
      if (tipus === 'dni') errors.push('Hi has posat un DNI, no la Cuenta.');
      else if (tipus !== 'cuenta') errors.push('La Cuenta només pot tenir xifres.');
      else {
        const altre = pacientsUnics(objectes).find(p => p.codi_acces !== c && String(p.cuenta_quartup).trim() === nova);
        if (altre) errors.push(`La Cuenta ${nova} també és de ${altre.nombre} (codi ${altre.codi_acces}).`);
      }
    }
    if (errors.length) return { files, errors, filesTocades: 0 };
    let filesTocades = 0;
    const novesFiles = files.map((f, i) => {
      if (codiDe(objectes[i]) !== c) return f;
      const copia = f.slice();
      copia[idx.cuenta_quartup] = nova;
      filesTocades++;
      return copia;
    });
    return { files: novesFiles, errors, filesTocades };
  }

  // --- Posición dental (S4) ---
  //
  // Una posición es un diente FDI (11-48) o una de las dos fisuras pterigoideas, que van
  // por detrás del 18 / 28 y por eso NO se guardan como 18 / 28. El texto está en
  // castellano porque lo ve el paciente en el portal y en el PDF.

  const PTERIGOIDEA = {
    1: 'Fisura pterigoidea (cuadrante 1)',
    2: 'Fisura pterigoidea (cuadrante 2)'
  };
  const POSICIONS_PTERIGOIDEES = [PTERIGOIDEA[1], PTERIGOIDEA[2]];
  const SENSE_POSICIO = 'No especificado';
  const RE_FDI = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8])$/;

  function esPterigoidea(v) {
    return /p?\s*t\s*e\s*r\s*i\s*[gsj]|pterig|ptg/i.test(String(v === undefined || v === null ? '' : v));
  }

  /**
   * Lleva a la forma canónica lo que escriba la IA o la persona: "25" -> "25",
   * "pterigo 2n Q" -> "Fisura pterigoidea (cuadrante 2)". Una pterigoidea sin cuadrante
   * claro (ninguno o los dos) -> "No especificado", para que se elija a mano.
   * Lo que no se reconoce se devuelve tal cual (recortado).
   */
  function normalitzarPosicio(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (RE_FDI.test(s)) return s;
    if (!esPterigoidea(s)) return s;
    // El cuadrante es un 1 o un 2 suelto ("2n Q", "Q1", "1r quadrant", "cuadrante 2").
    // Fechas y números de dos o más cifras (un diente "16", "12mm") no cuentan: de ahí
    // NO se deduce el cuadrante, se elige a mano.
    const net = s.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, ' ').replace(/\d{2,}/g, ' ');
    const quadrants = unics(net.match(/(?<!\d)[12](?!\d)/g) || []);
    return quadrants.length === 1 ? PTERIGOIDEA[quadrants[0]] : SENSE_POSICIO;
  }

  function esPosicioValida(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    return RE_FDI.test(s) || POSICIONS_PTERIGOIDEES.indexOf(s) !== -1;
  }

  /** Número para ordenar: el diente FDI; la pterigoidea justo después del 18 / 28. */
  function ordrePosicio(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (s === PTERIGOIDEA[1]) return 18.5;
    if (s === PTERIGOIDEA[2]) return 28.5;
    return parseInt(s.replace(/\D/g, ''), 10) || 0;
  }

  // --- Pilar (S4) ---
  //
  // `pilar` es el TIPO (obligatorio); el resto de campos del pilar son detalles opcionales.
  // Los valores del tipo van en castellano: los ve el paciente.

  const TIPUS_PILAR = ['Multi-unit', 'A cabeza de implante', 'Sin pilar'];
  const CAMPS_PILAR = ['pilar', 'pilar_altura', 'pilar_angulacion', 'pilar_marca', 'pilar_conexion', 'pilar_ref'];

  // Marcas que se reconocen en el texto de Quartup aunque no estén aún en el catálogo.
  // Sin nombres de 3 letras (MIS): se buscan dentro del texto y saldrían en cualquier palabra.
  const MARQUES_CONEGUDES = ['Avinent', 'Ticare', 'Southern Implants', 'Straumann', 'Nobel Biocare', 'Zimmer', 'Klockner', 'Mozo-Grau', 'BioHorizons', 'Neodent', 'Osstem', 'Elité Medica'];

  /**
   * "NO" / "No" / "sin pilar" -> "Sin pilar"; "Mt-U", "multi unit"... -> "Multi-unit";
   * "+PC" (pilar de cicatrización) o "a cabeza" -> "A cabeza de implante".
   * Vacío se queda vacío (no sabemos). Otro texto se devuelve tal cual.
   */
  function normalitzarTipusPilar(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (!s) return '';
    const n = normalitzar(s);
    if (n === 'no' || n === 'sinpilar' || n === 'sensepilar' || n === 'nohaypilar') return 'Sin pilar';
    if (/^(no|sin|sense|sense\s+de)\b/i.test(s)) return s; // "no multi unit": negación, no se adivina
    if (/mult[iy]?\s*[-.]?\s*u|\bmt\s*[-.]?\s*u\b|\bmiu\b|\bmi\.?\s*u\b/i.test(s)) return 'Multi-unit';
    if (/cabeza|cap\s+d.?implant|\bpc\s*\d|^\+?\s*pc\b|cicatriz/i.test(s)) return 'A cabeza de implante';
    return s;
  }

  function numero(s) {
    return String(s).replace(',', '.');
  }

  /**
   * Analiza el texto de pilar que la Auxiliar copia de Quartup, p. ej.
   * "0196, mult-unit 3mm avinent hexagon externo : 2.00, 25,26" o "Multi-unit 30x5 mm HE48865".
   * Tolerante: lo que reconoce lo devuelve; lo que no, no rellena nada.
   * @param {string} text
   * @param {string[]} [marques] marcas del catálogo, para reconocer la marca
   * @returns {{ camps: object, posicions: string[], quantitat: number|null, reconegut: boolean }}
   *   `camps` solo lleva las claves reconocidas (de CAMPS_PILAR).
   */
  function analitzarTextPilar(text, marques) {
    let resta = ' ' + String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ') + ' ';
    const camps = {};
    const treure = re => { resta = resta.replace(re, ' '); };

    // Fechas fuera: no son ni REF ni posiciones.
    treure(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g);

    // Cantidad de Quartup (": 2.00"), antes que nada para no confundirla con medidas.
    let quantitat = null;
    const mQ = resta.match(/:\s*(\d+)[.,]\d{2}\b/);
    if (mQ) { quantitat = parseInt(mQ[1], 10); treure(mQ[0]); }

    // Angulado: "30x5 mm", "30º 5mm", "30° x 5 mm".
    const mAng = resta.match(/\b(\d{1,2})\s*(?:º|°|x|×)\s*(?:x\s*)?(\d+(?:[.,]\d+)?)\s*mm\b/i);
    if (mAng && parseInt(mAng[1], 10) >= 10 && parseInt(mAng[1], 10) <= 60) {
      camps.pilar_angulacion = mAng[1];
      camps.pilar_altura = numero(mAng[2]);
      treure(mAng[0]);
    } else {
      const mGraus = resta.match(/\b(\d{1,2})\s*(?:º|°|graus|grados)/i);
      if (mGraus) { camps.pilar_angulacion = mGraus[1]; treure(mGraus[0]); }
    }
    if (!camps.pilar_altura) {
      const mMm = resta.match(/\b(\d+(?:[.,]\d+)?)\s*mm\b/i);
      if (mMm) { camps.pilar_altura = numero(mMm[1]); treure(mMm[0]); }
    }
    // "recto" = sin angulación.
    if (/\brect[oa]\b/i.test(resta)) {
      if (!camps.pilar_angulacion) camps.pilar_angulacion = '0';
      treure(/\brect[oa]\b/ig);
    }
    // "Inhex" es la conexión hexagonal interna de Ticare.
    if (/\binhex\b/i.test(resta)) {
      camps.pilar_conexion = 'Interna';
      camps.pilar_marca = 'Ticare';
      treure(/\binhex\b/ig);
    }

    const tipus = normalitzarTipusPilar(resta);
    // "+PC 4 (HE41404)" es el pilar de cicatrización (provisional): su REF no es la del pilar.
    const esPC = tipus === 'A cabeza de implante' && /\bpc\b|cicatriz/i.test(resta);
    if (tipus === 'Multi-unit' || tipus === 'A cabeza de implante') {
      camps.pilar = tipus;
      treure(/mult[iy]?\s*[-.]?\s*unit|mult[iy]?\s*[-.]?\s*u\b|\bmt\s*[-.]?\s*u\b|\bmiu\b|a cabeza( de implante)?|\+?\s*\bpc\b/ig);
    }

    // Conexión: "hexagon externo", "hexágono interno", "conexión externa", "externa"...
    const mCon = resta.match(/(?:\b(?:hex[a-záàé]*|con+exi[oó]n?)\.?\s*)?\b(extern|intern)[oa]?\b/i);
    if (mCon && !camps.pilar_conexion) {
      camps.pilar_conexion = /extern/i.test(mCon[1]) ? 'Externa' : 'Interna';
      treure(mCon[0]);
    }

    const llistaMarques = (marques || []).concat(MARQUES_CONEGUDES);
    const nResta = normalitzar(resta);
    const marca = llistaMarques.find(m => {
      const nm = normalitzar(m).replace(/implants?$/, '');
      return nm.length >= 4 && nResta.indexOf(nm) !== -1;
    });
    if (marca) {
      camps.pilar_marca = camps.pilar_marca || marca;
      const primera = String(marca).split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      treure(new RegExp(primera + '\\w*', 'i'));
    }

    // Referencia: "0196", "HE48865", "HE 41404", "TWADBT2-RP" (la primera que quede). Las
    // letras sueltas separadas por espacio ("MU 0196") no son parte de la REF.
    const mRef = resta.match(/\b(HE\s?\d{3,}[A-Z0-9-]*|[A-Z]{1,6}\d[A-Z0-9]*-[A-Z0-9-]+|[A-Z]{1,4}\d{3,}[A-Z0-9-]*|\d{4,}[A-Z0-9-]*)\b/i);
    if (mRef && !esPC) { camps.pilar_ref = mRef[1].replace(/\s+/g, '').toUpperCase(); treure(mRef[0]); }
    // El PC es provisional: ni su altura ni su REF son las del pilar.
    const descartatPC = esPC && camps.pilar_altura !== undefined;
    if (esPC) delete camps.pilar_altura;

    // Posiciones: los dientes FDI que quedan sueltos ("25,26").
    const posicions = unics((resta.match(/\b[1-4][1-8]\b/g) || []).filter(p => RE_FDI.test(p)));

    // Lo que no se ha entendido (sin palabras de relleno ni puntuación). `complet` = todo
    // el texto ha ido a algún campo y no se ha tirado nada: la migración solo toca esos.
    // "alt." / "altura" (la cifra ya está en pilar_altura) y "std" (estándar) no añaden nada.
    const sobrant = resta.replace(/\b(de|del|pilar|ref|alt|altura|alçada|std|standard|estándar|estandar)\b\.?/gi, ' ').replace(/[\s+,.;:()\/#-]+/g, ' ').trim();
    const complet = Object.keys(camps).length > 0 && !sobrant && !descartatPC && quantitat === null;

    return { camps, posicions, quantitat, reconegut: Object.keys(camps).length > 0, sobrant, complet };
  }

  function textCela(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }

  // --- Ciclo de vida de la ficha (S3) ---
  //
  // Un implante "Pendent" es uno al que aún le falta algo (típicamente el pilar definitivo de
  // la 2ª visita). Lo decide la Auxiliar: las reglas de aquí solo proponen.

  const CLAUS_IMPLANT = COLUMNES.filter(c => c.grup === 'implant').map(c => c.clau);

  /** Objeto con todas las claves del registro vacías, como una fila en blanco. */
  function objecteBuit() {
    return filaAObjecte([], {});
  }

  /** Pendiente y todavía sin pilar: el pasaporte dice "Pilar: pendiente de colocar". */
  function pilarPendent(fila) {
    return !!fila && esCert(fila.pendent) && textCela(fila.pilar) === '';
  }

  /** Datos de paciente del formulario, normalizados como se guardan. */
  function pacientDelFormulari(fd) {
    const senseEmail = esCert(fd.sense_email);
    const senseDni = esCert(fd.sense_dni);
    const codi = textCela(fd.codi_acces).toUpperCase();
    return {
      codi_acces: !codi || codi === 'GENERAR' ? '' : codi,
      cuenta_quartup: textCela(fd.cuenta_quartup),
      nombre: textCela(fd.nombre),
      email: senseEmail ? '' : textCela(fd.email),
      sense_email: senseEmail,
      dni: senseDni ? '' : netejarDocument(fd.dni),
      sense_dni: senseDni
    };
  }

  /** Claves del implante del formulario, con las casillas como booleano. */
  function campsImplant(imp) {
    const out = {};
    CLAUS_IMPLANT.forEach(k => {
      if (!(k in imp)) return;
      const col = COLUMNES.find(c => c.clau === k);
      out[k] = col.casella ? esCert(imp[k]) : (imp[k] === undefined || imp[k] === null ? '' : imp[k]);
    });
    return out;
  }

  /**
   * Lo que tenía vacío un paciente existente y ahora llega (como completarDatosPaciente en
   * el servidor): nunca se sobrescribe un dato guardado.
   */
  function omplirBuits(fila, pacient) {
    const o = Object.assign({}, fila);
    ['cuenta_quartup', 'email', 'sense_email', 'dni', 'sense_dni'].forEach(k => {
      const actual = o[k];
      const buit = actual === '' || actual === null || actual === undefined || actual === false;
      if (buit && pacient[k] !== '' && pacient[k] !== false && pacient[k] !== undefined) o[k] = pacient[k];
    });
    if (textCela(o.email)) o.sense_email = false;
    if (textCela(o.dni)) o.sense_dni = false;
    return o;
  }

  /**
   * Plan puro de un guardado del panel lateral. No toca la hoja ni genera el Codi d'accés:
   * lo usan el servidor para escribir y la vista previa (S5) para enseñar el pasaporte tal
   * como quedará, así las dos cosas salen siempre de aquí.
   *
   * - mode 'afegir' (por defecto; sidebar de escanear): `formData.implantes` son filas nuevas.
   * - mode 'completar' (panel "Completar i enviar"): cada implante lleva `fila` (nº de fila
   *   de la hoja) y `posicion_esperada`; solo se cambian las claves de implante que traiga.
   *   Los datos de paciente que traiga solo rellenan los que estaban vacíos.
   *
   * @param {any[]} headers  fila 1 de la hoja (leerPacientes().headers)
   * @param {any[][]} files  el resto de filas, crudas (leerPacientes().files)
   * @returns {{ errors: string[], avisos: string[], mode: string, codi: string, paciente: object,
   *   filas: object[], totes: object[], files_hoja: number[], claus_tocades: string[],
   *   claus_per_fila: string[][] }}
   *   `filas`: las nuevas (afegir) o las reescritas (completar). `totes`: todas las filas
   *   del paciente tal como quedarán. `codi` vacío = paciente nuevo. `claus_per_fila`
   *   (completar): las claves que cambia cada fila, para escribir solo esas celdas.
   */
  function planificarDesat(headers, files, formData) {
    const fd = formData || {};
    const mode = fd.mode === 'completar' ? 'completar' : 'afegir';
    const { idx } = indexarCapcaleres(headers);
    const objectes = files.map(f => filaAObjecte(f, idx));
    const codiDe = o => textCela(o.codi_acces).toUpperCase();
    const implants = fd.implantes || [];
    const errors = [];
    const avisos = [];
    const resultat = extra => Object.assign({ errors, avisos, mode, codi: '', paciente: null,
      filas: [], totes: [], files_hoja: [], claus_tocades: [], claus_per_fila: [] }, extra);

    if (mode === 'afegir') {
      const paciente = pacientDelFormulari(fd);
      const codi = paciente.codi_acces;
      if (codi && !objectes.some(o => codiDe(o) === codi)) {
        errors.push("El codi d'accés " + codi + " no existeix. Torna a cercar el pacient.");
        return resultat({ codi, paciente });
      }
      const v = validarPacient(paciente, pacientsUnics(objectes));
      errors.push(...v.errors);
      avisos.push(...v.avisos);
      if (!errors.length && !implants.length) errors.push('No hi ha cap implant per desar.');
      if (errors.length) return resultat({ codi, paciente });
      const filas = implants.map(imp => Object.assign(objecteBuit(), campsImplant(imp), paciente));
      const existents = codi ? objectes.filter(o => codiDe(o) === codi).map(o => omplirBuits(o, paciente)) : [];
      return resultat({ codi, paciente, filas, totes: existents.concat(filas) });
    }

    // --- completar ---
    const codi = textCela(fd.codi_acces).toUpperCase();
    const delPacient = objectes.filter(o => codiDe(o) === codi);
    if (!codi || !delPacient.length) {
      errors.push("No trobo el pacient " + (codi || '(sense codi)') + '. Torna a obrir el panell.');
      return resultat({ codi });
    }
    if (!implants.length) {
      errors.push('No hi ha cap implant per desar.');
      return resultat({ codi });
    }

    // Datos de paciente que llegan: solo los que faltaban, y validados uno a uno (una ficha
    // antigua incompleta no debe impedir completar su pilar).
    const actual = pacientsUnics(delPacient)[0];
    const nou = {};
    const dada = k => textCela(fd[k]);
    if (dada('cuenta_quartup') && !textCela(actual.cuenta_quartup)) {
      const c = dada('cuenta_quartup');
      if (classificarIdentificador(c) !== 'cuenta') errors.push('La Cuenta Quartup només pot tenir xifres (ex: 43001234).');
      else {
        const altre = pacientsUnics(objectes).find(p => p.codi_acces !== codi && textCela(p.cuenta_quartup) === c);
        if (altre) errors.push(`Aquesta Cuenta Quartup ja és de ${altre.nombre || 'un altre pacient'} (codi ${altre.codi_acces}).`);
        else nou.cuenta_quartup = c;
      }
    }
    if (dada('email') && !textCela(actual.email)) {
      if (!esEmail(dada('email'))) errors.push("L'email no és vàlid.");
      else nou.email = dada('email');
    }
    if (dada('dni') && !textCela(actual.dni)) {
      if (!esDni(dada('dni'))) errors.push("El DNI no és vàlid (ha d'acabar en lletra, ex: 12345678A o X1234567L).");
      else nou.dni = netejarDocument(dada('dni'));
    }

    const vistes = {};
    const filesHoja = [];
    const filas = [];
    const clausPerFila = [];
    const tocades = {};
    implants.forEach(imp => {
      const n = parseInt(imp.fila, 10);
      const o = n >= 2 ? objectes[n - 2] : undefined;
      if (!o || filaBuida(files[n - 2])) { errors.push(`La fila ${imp.fila} ja no existeix. Torna a obrir el panell.`); return; }
      if (vistes[n]) { errors.push(`La fila ${n} hi és dues vegades.`); return; }
      vistes[n] = true;
      if (codiDe(o) !== codi) { errors.push(`La fila ${n} ja no és d'aquest pacient. Torna a obrir el panell.`); return; }
      if ('posicion_esperada' in imp && textCela(o.posicion) !== textCela(imp.posicion_esperada)) {
        errors.push(`La fila ${n} ha canviat (posició ${textCela(o.posicion) || 'buida'}). Torna a obrir el panell.`);
        return;
      }
      const canvis = campsImplant(imp);
      Object.keys(canvis).forEach(k => { tocades[k] = true; });
      clausPerFila.push(CLAUS_IMPLANT.filter(k => k in canvis));
      filesHoja.push(n);
      filas.push(Object.assign({}, o, canvis));
    });
    if (errors.length) return resultat({ codi });

    const paciente = Object.assign({}, actual, nou, {
      codi_acces: codi,
      sense_email: delPacient.some(o => o.sense_email) && !textCela(nou.email || actual.email),
      sense_dni: delPacient.some(o => o.sense_dni) && !textCela(nou.dni || actual.dni)
    });
    delete paciente.n_implants;
    const perFila = {};
    filesHoja.forEach((n, i) => { perFila[n] = filas[i]; });
    const totes = [];
    objectes.forEach((o, i) => {
      if (codiDe(o) !== codi) return;
      totes.push(omplirBuits(perFila[i + 2] || o, nou));
    });
    return resultat({ codi, paciente, filas: filas.map(f => omplirBuits(f, nou)), totes,
      files_hoja: filesHoja, claus_tocades: CLAUS_IMPLANT.filter(k => tocades[k]), claus_per_fila: clausPerFila });
  }

  function unics(llista) {
    return llista.filter((v, i) => llista.indexOf(v) === i);
  }

  return {
    COLUMNES,
    CAPCALERES,
    CLAUS_PACIENT,
    normalitzar,
    indexarCapcaleres,
    filaAObjecte,
    objecteAFila,
    esCert,
    filesAmbDades,
    filaBuida,
    esDni,
    esEmail,
    netejarDocument,
    classificarIdentificador,
    validarPacient,
    pacientsUnics,
    planificarFusio,
    planificarCanviCuenta,
    POSICIONS_PTERIGOIDEES,
    SENSE_POSICIO,
    normalitzarPosicio,
    esPosicioValida,
    ordrePosicio,
    TIPUS_PILAR,
    CAMPS_PILAR,
    normalitzarTipusPilar,
    analitzarTextPilar,
    CLAUS_IMPLANT,
    pilarPendent,
    planificarDesat
  };
}

var PacientModel = crearPacientModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PacientModel;
}
