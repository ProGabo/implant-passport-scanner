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
    { clau: 'lote', capcalera: 'Lot', grup: 'implant', alies: ['Lote'] }
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

  // --- Migración S2 ---

  function filaBuida(fila) {
    return fila.every(v => v === '' || v === null || v === undefined || v === false);
  }

  /**
   * Plan puro de la migración: no toca la hoja, devuelve lo que hay que escribir.
   * Es idempotente: aplicada sobre una hoja ya migrada no cambia nada.
   * @returns {{ capcaleres: string[], files: any[][], revisio: object[], recompte: object }}
   */
  function planificarMigracio(headers, files) {
    const { idx, desconegudes } = indexarCapcaleres(headers);
    const obligatories = ['codi_acces', 'cuenta_quartup', 'nombre', 'email'];
    const falten = obligatories.filter(k => idx[k] === undefined);
    if (falten.length) {
      throw new Error('No trobo les columnes: ' + falten.join(', ') +
        '. Capçaleres actuals: ' + headers.map(h => String(h)).join(' | '));
    }

    // Columnas desconocidas: se conservan al final, con su cabecera, sin perder datos.
    const extres = desconegudes.map(i => ({ i, capcalera: headers[i] }));
    const capcaleres = CAPCALERES.concat(extres.map(e => e.capcalera));

    const objectes = [];
    files.forEach(fila => {
      if (filaBuida(fila)) return;
      const o = filaAObjecte(fila, idx);
      o._extres = extres.map(e => fila[e.i]);
      o._valorAntic = String(o.cuenta_quartup).trim();
      objectes.push(o);
    });

    const recompte = { files: objectes.length, pacients: 0, mogutsADni: 0, senseCuenta: 0, senseEmail: 0, revisar: 0, columnesDesconegudes: extres.map(e => String(e.capcalera)) };

    // 1. Fila a fila: separar el DNI que estaba en la columna del identificador.
    objectes.forEach(o => {
      const tipus = classificarIdentificador(o.cuenta_quartup);
      if (tipus === 'cuenta') {
        o.cuenta_quartup = String(o.cuenta_quartup).trim();
      } else if (tipus === 'dni') {
        if (!String(o.dni).trim()) o.dni = netejarDocument(o.cuenta_quartup);
        o.cuenta_quartup = '';
        recompte.mogutsADni++;
      }
      // 'revisar': se deja tal cual (visible) y va a la pestaña de revisión.
      if (idx.sense_email === undefined && !String(o.email).trim()) o.sense_email = true;
      if (o.sense_email && !String(o.email).trim()) recompte.senseEmail++;
    });

    // 2. Por paciente: los datos de paciente se repiten en cada fila; si una fila tiene la
    //    Cuenta o el DNI y otra no, se completa. Si hay dos Cuentes distintas, a revisar.
    const perCodi = {};
    objectes.forEach(o => {
      const codi = String(o.codi_acces).trim().toUpperCase();
      (perCodi[codi] = perCodi[codi] || []).push(o);
    });

    const revisio = [];
    Object.keys(perCodi).forEach(codi => {
      const filesPacient = perCodi[codi];
      const cuentes = unics(filesPacient.map(o => o.cuenta_quartup).filter(v => classificarIdentificador(v) === 'cuenta'));
      const dnis = unics(filesPacient.map(o => netejarDocument(o.dni)).filter(Boolean));
      const raros = unics(filesPacient.map(o => o.cuenta_quartup).filter(v => classificarIdentificador(v) === 'revisar').map(String));

      if (cuentes.length === 1 && raros.length === 0) filesPacient.forEach(o => { o.cuenta_quartup = cuentes[0]; });
      if (dnis.length === 1) filesPacient.forEach(o => { o.dni = dnis[0]; });

      let motiu = '';
      if (cuentes.length > 1) motiu = 'Té més d\'una Cuenta Quartup: ' + cuentes.join(', ');
      else if (raros.length) motiu = 'Valor estrany a la Cuenta: ' + raros.join(', ');
      else if (cuentes.length === 0) motiu = 'Falta la Cuenta Quartup';

      if (motiu) {
        const p = filesPacient[0];
        revisio.push({
          codi_acces: codi,
          nombre: String(p.nombre || '').trim(),
          dni: dnis.join(', '),
          n_implants: filesPacient.length,
          valor_antic: unics(filesPacient.map(o => o._valorAntic).filter(Boolean)).join(', '),
          motiu: motiu
        });
        if (cuentes.length === 0 && raros.length === 0) recompte.senseCuenta++;
        else recompte.revisar++;
      }
    });
    recompte.pacients = Object.keys(perCodi).length;

    const novesFiles = objectes.map(o => objecteAFila(o, CAPCALERES).concat(o._extres));
    return { capcaleres, files: novesFiles, revisio, recompte };
  }

  /**
   * Escribe las Cuentes rellenadas en la pestaña "Revisió migració" en todas las filas
   * de cada paciente. Valida formato y unicidad; lo que no pasa se devuelve como error.
   * Si la Cuenta ya es de otro paciente y la revisión dice `unir`, son la misma persona:
   * se fusionan las dos fichas y se queda el codi de la revisión (ver planificarFusio).
   * @param {string[]} headers cabeceras de la hoja Pacientes
   * @param {any[][]} files filas (sin cabecera)
   * @param {{codi_acces: string, cuenta_quartup: any, unir?: boolean}[]} revisions
   * @returns {{ files, aplicats, errors, filesTocades }} cada aplicat lleva `unitAmb`
   *   ({codi_acces, nombre}) si hubo fusión.
   */
  function aplicarRevisio(headers, files, revisions) {
    const { idx } = indexarCapcaleres(headers);
    if (idx.codi_acces === undefined || idx.cuenta_quartup === undefined) {
      throw new Error("No trobo les columnes \"Codi d'accés\" i \"Cuenta Quartup\". Has executat la migració?");
    }
    let actuals = files;
    const pacientsActuals = () => pacientsUnics(actuals.map(f => filaAObjecte(f, idx)));

    const errors = [];
    const aplicats = [];
    const assignades = {};
    const tocats = {};
    revisions.forEach(r => {
      const codi = String(r.codi_acces || '').trim().toUpperCase();
      const cuenta = String(r.cuenta_quartup === undefined || r.cuenta_quartup === null ? '' : r.cuenta_quartup).trim();
      if (!codi || !cuenta) return; // fila aún sin rellenar: se ignora sin error
      const tipus = classificarIdentificador(cuenta);
      if (tipus !== 'cuenta') {
        errors.push({ codi_acces: codi, motiu: tipus === 'dni' ? 'Hi has posat un DNI, no la Cuenta.' : 'La Cuenta només pot tenir xifres.' });
        return;
      }
      const pacients = pacientsActuals();
      if (!pacients.some(p => p.codi_acces === codi)) {
        errors.push({ codi_acces: codi, motiu: "Aquest codi d'accés ja no és al full de Pacients." });
        return;
      }
      if (assignades[cuenta] && assignades[cuenta] !== codi) {
        errors.push({ codi_acces: codi, motiu: `La Cuenta ${cuenta} ja l'has posada a un altre pacient de la revisió (${assignades[cuenta]}).` });
        return;
      }
      const altre = pacients.find(p => p.codi_acces !== codi && String(p.cuenta_quartup).trim() === cuenta);
      let unitAmb = null;
      if (altre) {
        if (!r.unir) {
          errors.push({ codi_acces: codi, motiu: `La Cuenta ${cuenta} ja és de ${altre.nombre} (codi ${altre.codi_acces}). Si és la mateixa persona, escriu SÍ a la columna "Unir" i torna a aplicar.` });
          return;
        }
        const fusio = planificarFusio(headers, actuals, codi, altre.codi_acces);
        if (fusio.errors.length) {
          errors.push({ codi_acces: codi, motiu: 'No es poden unir: ' + fusio.errors.join(' ') });
          return;
        }
        actuals = fusio.files;
        tocats[codi] = true;
        unitAmb = { codi_acces: altre.codi_acces, nombre: altre.nombre };
      }
      assignades[cuenta] = codi;
      tocats[codi] = true;
      aplicats.push({ codi_acces: codi, cuenta_quartup: cuenta, unitAmb });
    });

    const perCodi = {};
    aplicats.forEach(a => { perCodi[a.codi_acces] = a.cuenta_quartup; });
    const iCuenta = idx.cuenta_quartup;
    const iCodi = idx.codi_acces;
    let filesTocades = 0;
    const novesFiles = actuals.map(f => {
      const codi = String(f[iCodi] || '').trim().toUpperCase();
      if (!tocats[codi]) return f;
      const copia = f.slice();
      copia[iCuenta] = perCodi[codi];
      filesTocades++;
      return copia;
    });

    return { files: novesFiles, aplicats, errors, filesTocades };
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

  /**
   * Marca "Sense DNI" a todos los pacientes que no tienen DNI (no lo tenemos y no se va a
   * pedir en el panel). Si más adelante llega el DNI, al ponerlo se desmarca.
   * @returns {{ files: any[][], pacients: number, filesTocades: number }}
   */
  function marcarSenseDni(headers, files) {
    const { idx } = indexarCapcaleres(headers);
    if (idx.dni === undefined || idx.sense_dni === undefined || idx.codi_acces === undefined) {
      throw new Error('No trobo les columnes "DNI" i "Sense DNI". Has executat la migració?');
    }
    const objectes = files.map(f => filaAObjecte(f, idx));
    const ambDni = {};
    objectes.forEach(o => {
      if (String(o.dni).trim()) ambDni[String(o.codi_acces).trim().toUpperCase()] = true;
    });
    const pacients = {};
    let filesTocades = 0;
    const novesFiles = files.map((f, i) => {
      const o = objectes[i];
      const codi = String(o.codi_acces).trim().toUpperCase();
      if (!codi || ambDni[codi] || o.sense_dni) return f;
      const copia = f.slice();
      copia[idx.sense_dni] = true;
      pacients[codi] = true;
      filesTocades++;
      return copia;
    });
    return { files: novesFiles, pacients: Object.keys(pacients).length, filesTocades };
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

    const tipus = normalitzarTipusPilar(resta);
    // "+PC 4 (HE41404)" es el pilar de cicatrización (provisional): su REF no es la del pilar.
    const esPC = tipus === 'A cabeza de implante' && /\bpc\b|cicatriz/i.test(resta);
    if (tipus === 'Multi-unit' || tipus === 'A cabeza de implante') {
      camps.pilar = tipus;
      treure(/mult[iy]?\s*[-.]?\s*unit|mult[iy]?\s*[-.]?\s*u\b|\bmt\s*[-.]?\s*u\b|\bmiu\b|a cabeza( de implante)?|\+?\s*\bpc\b/ig);
    }

    // Conexión: "hexagon externo", "hexágono interno", "conexión externa", "externa"...
    const mCon = resta.match(/(?:\b(?:hex[a-záàé]*|con+exi[oó]n?)\.?\s*)?\b(extern|intern)[oa]?\b/i);
    if (mCon) {
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
      camps.pilar_marca = marca;
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
    const sobrant = resta.replace(/\b(de|del|pilar|ref)\b\.?/gi, ' ').replace(/[\s+,.;:()\/#-]+/g, ' ').trim();
    const complet = Object.keys(camps).length > 0 && !sobrant && !descartatPC && quantitat === null;

    return { camps, posicions, quantitat, reconegut: Object.keys(camps).length > 0, sobrant, complet };
  }

  /** "Multi-unit · 30º · 5 mm · Avinent · Externa · REF HE48865", para los resúmenes. */
  function descriurePilar(camps) {
    const c = camps || {};
    return [c.pilar, c.pilar_angulacion && c.pilar_angulacion + 'º', c.pilar_altura && c.pilar_altura + ' mm',
      c.pilar_marca, c.pilar_conexion, c.pilar_ref && 'REF ' + c.pilar_ref].filter(Boolean).join(' · ');
  }

  function textCela(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }

  /**
   * Plan puro de la migración del pilar (S4). NUNCA tira información:
   * - "NO" / "No" / "sin pilar" -> "Sin pilar".
   * - Un texto antiguo ("Multi-unit 3 mm Avinent hexagon externo") se reparte en tipo +
   *   detalles SOLO si se ha entendido entero (`analitzarTextPilar(...).complet`) y no pisa
   *   un detalle ya escrito con otro valor. Si no, la fila se queda tal cual y el texto
   *   sale en `altres` para revisarlo a mano.
   * Vacío no se toca (puede ser que aún no se sepa). Idempotente.
   * @param {string[]} [marques] marcas del catálogo
   * @returns {{ files: any[][], filesTocades: number, sensePilar: number, reclassificats: number,
   *   canvis: {abans: string, despres: string, files: number}[], altres: string[] }}
   */
  function planificarMigracioPilars(headers, files, marques) {
    const { idx } = indexarCapcaleres(headers);
    const falten = CAMPS_PILAR.filter(k => idx[k] === undefined);
    if (falten.length) {
      throw new Error('No trobo les columnes del pilar (' + falten.map(k => COLUMNES.find(c => c.clau === k).capcalera).join(', ') + ').');
    }
    let filesTocades = 0, sensePilar = 0, reclassificats = 0;
    const altres = [];
    const canvis = [];
    const anotarCanvi = (abans, despres) => {
      const c = canvis.find(x => x.abans === abans);
      if (c) c.files++; else canvis.push({ abans, despres, files: 1 });
    };
    const novesFiles = files.map(f => {
      if (filaBuida(f)) return f;
      const actual = textCela(f[idx.pilar]);
      if (!actual || TIPUS_PILAR.indexOf(actual) !== -1) return f;
      if (normalitzarTipusPilar(actual) === 'Sin pilar') {
        const copia = f.slice();
        copia[idx.pilar] = 'Sin pilar';
        filesTocades++;
        sensePilar++;
        return copia;
      }
      const a = analitzarTextPilar(actual, marques);
      const xoca = Object.keys(a.camps).some(k => k !== 'pilar' && textCela(f[idx[k]]) && textCela(f[idx[k]]) !== a.camps[k]);
      if (!a.camps.pilar || !a.complet || xoca) {
        if (altres.indexOf(actual) === -1) altres.push(actual);
        return f;
      }
      const copia = f.slice();
      Object.keys(a.camps).forEach(k => { copia[idx[k]] = a.camps[k]; });
      filesTocades++;
      reclassificats++;
      anotarCanvi(actual, descriurePilar(a.camps));
      return copia;
    });
    return { files: novesFiles, filesTocades, sensePilar, reclassificats, canvis, altres };
  }

  /**
   * Deshace la primera migración de pilares (2026-10-03), que dejaba "Multi-unit" + alçada y
   * tiraba el resto del texto (marca, conexión...). Recupera el texto original de una
   * copia anterior de la hoja (la pestaña "Còpia abans S2" o una copia del historial).
   * Solo toca las filas cuyo pilar es justo lo que dejó aquella migración a partir del
   * original: lo que se haya cambiado después a mano no se toca.
   * Las filas se emparejan por Codi + REF + lote + posición, y si no, por REF + lote +
   * posición o por nombre + posición (solo si el emparejamiento es único).
   * @returns {{ files: any[][], restaurades: number, noTrobades: number, canviadesDespres: number }}
   */
  function planificarRecuperacioPilars(headers, files, headersCopia, filesCopia) {
    const { idx } = indexarCapcaleres(headers);
    const { idx: idxC } = indexarCapcaleres(headersCopia);
    if (idxC.pilar === undefined) throw new Error('La còpia no té la columna "Pilar".');
    if (idx.pilar === undefined || idx.pilar_altura === undefined) {
      throw new Error('No trobo les columnes "Pilar" i "Pilar alçada (mm)".');
    }
    const t = (o, k) => textCela(o[k]).toUpperCase();
    const claus = [
      o => [t(o, 'codi_acces'), t(o, 'cod_implante'), t(o, 'lote'), t(o, 'posicion')].join('|'),
      o => (t(o, 'cod_implante') || t(o, 'lote')) ? [t(o, 'cod_implante'), t(o, 'lote'), t(o, 'posicion')].join('|') : '',
      o => t(o, 'nombre') ? [t(o, 'nombre'), t(o, 'posicion')].join('|') : ''
    ];
    const objsC = filesCopia.filter(f => !filaBuida(f)).map(f => filaAObjecte(f, idxC));
    const mapes = claus.map(clau => {
      const m = {};
      objsC.forEach(o => { const k = clau(o); if (k) (m[k] = m[k] || []).push(o); });
      return m;
    });
    const buscar = o => {
      for (let i = 0; i < claus.length; i++) {
        const k = claus[i](o);
        const trobats = k ? mapes[i][k] || [] : [];
        if (trobats.length === 1) return trobats[0];
        // Mismo implante repetido igual en la copia: vale si todos dicen el mismo pilar.
        if (trobats.length > 1 && trobats.every(x => textCela(x.pilar) === textCela(trobats[0].pilar))) return trobats[0];
      }
      return null;
    };
    let restaurades = 0, noTrobades = 0, canviadesDespres = 0;
    const novesFiles = files.map(f => {
      if (filaBuida(f)) return f;
      const actual = textCela(f[idx.pilar]);
      if (!actual) return f;
      const o = filaAObjecte(f, idx);
      const c = buscar(o);
      if (!c) { noTrobades++; return f; }
      const original = textCela(c.pilar);
      if (!original || original === actual || normalitzarTipusPilar(original) === 'Sin pilar') return f;
      if (normalitzarTipusPilar(original) !== actual) { canviadesDespres++; return f; }
      const copia = f.slice();
      copia[idx.pilar] = original;
      // La alçada la escribió aquella migración (si la copia ya la tenía, se respeta).
      const m = original.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
      const alturaCopia = idxC.pilar_altura !== undefined ? textCela(c.pilar_altura) : '';
      if (m && textCela(f[idx.pilar_altura]) === numero(m[1])) copia[idx.pilar_altura] = alturaCopia;
      restaurades++;
      return copia;
    });
    return { files: novesFiles, restaurades, noTrobades, canviadesDespres };
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
    esDni,
    esEmail,
    netejarDocument,
    classificarIdentificador,
    validarPacient,
    pacientsUnics,
    planificarMigracio,
    aplicarRevisio,
    planificarFusio,
    planificarCanviCuenta,
    marcarSenseDni,
    POSICIONS_PTERIGOIDEES,
    SENSE_POSICIO,
    normalitzarPosicio,
    esPosicioValida,
    ordrePosicio,
    TIPUS_PILAR,
    CAMPS_PILAR,
    normalitzarTipusPilar,
    analitzarTextPilar,
    descriurePilar,
    planificarMigracioPilars,
    planificarRecuperacioPilars
  };
}

var PacientModel = crearPacientModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PacientModel;
}
