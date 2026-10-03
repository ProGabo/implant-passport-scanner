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
    { clau: 'codi_acces', capcalera: "Codi d'accés", grup: 'pacient', alies: ['Código', 'Codigo', 'Código Paciente', 'Código de paciente'] },
    { clau: 'cuenta_quartup', capcalera: 'Cuenta Quartup', grup: 'pacient', alies: ['id_quartup', 'ID Quartup', 'Cuenta'] },
    { clau: 'nombre', capcalera: 'Nom', grup: 'pacient', alies: ['Nombre', 'Nombre Completo'] },
    { clau: 'email', capcalera: 'Email', grup: 'pacient', alies: ['Correo', 'E-mail', 'Correo electrónico'] },
    { clau: 'sense_email', capcalera: 'Sense email', grup: 'pacient', casella: true, alies: [] },
    { clau: 'dni', capcalera: 'DNI', grup: 'pacient', alies: ['NIF', 'DNI/NIE'] },
    { clau: 'sense_dni', capcalera: 'Sense DNI', grup: 'pacient', casella: true, alies: [] },
    { clau: 'posicion', capcalera: 'Posició', grup: 'implant', alies: ['Posición', 'Posición diente', 'Diente'] },
    { clau: 'fecha_colocacion', capcalera: 'Data de col·locació', grup: 'implant', alies: ['Fecha', 'Fecha de colocación', 'Fecha colocación', 'Data'] },
    { clau: 'marca', capcalera: 'Marca', grup: 'implant', alies: [] },
    { clau: 'modelo', capcalera: 'Model', grup: 'implant', alies: ['Modelo'] },
    { clau: 'dimensiones', capcalera: 'Dimensions', grup: 'implant', alies: ['Dimensiones'] },
    { clau: 'plataforma', capcalera: 'Plataforma', grup: 'implant', alies: [] },
    { clau: 'conexion', capcalera: 'Connexió', grup: 'implant', alies: ['Conexión'] },
    { clau: 'pilar', capcalera: 'Pilar', grup: 'implant', alies: ['Pilar transepitelial', 'Aditamentos'] },
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
    marcarSenseDni
  };
}

var PacientModel = crearPacientModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PacientModel;
}
