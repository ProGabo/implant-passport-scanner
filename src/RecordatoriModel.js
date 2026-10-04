// ==========================================
//  RecordatoriModel - recordatoris de seguiment de la Auxiliar (S6)
// ==========================================
// JS puro, sin servicios de Apps Script (como PacientModel): global en GAS, módulo en Node
// para los tests, y también se inyecta en el sidebar (fechas y propuesta del escáner).
//
// Un Recordatori es de la Auxiliar y solo se ve dentro de la hoja: la pestaña
// "Recordatoris" (una fila por recordatorio, que queda como historial) y el aviso al abrir.
// Un paciente tiene como mucho uno Actiu; ponerle otro lo sustituye.
//
// Las fechas viajan como texto ISO 'AAAA-MM-DD' (la del input date). En la hoja se
// escriben como fecha de verdad (para ordenar y para el formato condicional).
//
// PacientModel se busca al llamar, no al cargar: en Apps Script el orden de carga de los
// archivos no está garantizado.

function crearRecordatoriModel() {

  function pm() {
    return typeof PacientModel !== 'undefined' ? PacientModel : require('./PacientModel.js');
  }

  const MOTIU_PER_DEFECTE = "Revisar/enviar al pacient el passaport d'implants";
  const ACTIU = 'Actiu';
  const FET = 'Fet';
  const CANCELLAT = 'Cancel·lat';
  // Al reenviar, se cierra solo si ya toca (o falta poco): un reenvío cualquiera a los
  // pocos días no debe borrar el aviso de la 2ª cirugía de dentro de 4 meses.
  const DIES_MARGE_TANCAR = 14;
  // El escáner propone solo el seguimiento largo: el control de puntos (1-15 días) no.
  const DIES_MINIMS_PROPOSTA = 30;

  // Pestaña "Recordatoris", por cabecera (como la hoja Pacientes).
  const COLUMNES = [
    { clau: 'codi_acces', capcalera: "Codi d'accés", text: true, alies: ['codi', 'codigo'] },
    { clau: 'cuenta_quartup', capcalera: 'Cuenta Quartup', text: true, alies: ['cuenta'] },
    { clau: 'nombre', capcalera: 'Nom', text: true, alies: ['nombre', 'pacient'] },
    { clau: 'data', capcalera: "Data d'avís", alies: ['data avis', 'data', 'fecha'] },
    { clau: 'motiu', capcalera: 'Motiu', text: true, alies: ['motivo'] },
    { clau: 'estat', capcalera: 'Estat', text: true, alies: ['estado'] },
    { clau: 'origen', capcalera: 'Origen', text: true, alies: [] },
    { clau: 'creat', capcalera: 'Creat', alies: [] },
    { clau: 'tancat', capcalera: 'Tancat', alies: [] }
  ];
  const CAPCALERES = COLUMNES.map(c => c.capcalera);

  function net(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }

  function indexarCapcaleres(headers) {
    const norm = s => pm().normalitzar(s);
    const perNom = {};
    COLUMNES.forEach(c => [c.clau, c.capcalera].concat(c.alies).forEach(n => { perNom[norm(n)] = c.clau; }));
    const idx = {};
    (headers || []).forEach((h, i) => {
      const k = perNom[norm(h)];
      if (k && idx[k] === undefined) idx[k] = i;
    });
    return idx;
  }

  function filaAObjecte(fila, idx) {
    const o = {};
    COLUMNES.forEach(c => { o[c.clau] = idx[c.clau] === undefined ? '' : fila[idx[c.clau]]; });
    o.data = aIso(o.data);
    return o;
  }

  // ---- Fechas (siempre en hora local, sin husos: una fecha es un día) ----

  function dosXifres(n) { return (n < 10 ? '0' : '') + n; }

  function isoDeData(d) {
    return d.getFullYear() + '-' + dosXifres(d.getMonth() + 1) + '-' + dosXifres(d.getDate());
  }

  /** Date, 'AAAA-MM-DD' o 'DD/MM/AAAA' -> 'AAAA-MM-DD' ('' si no es una fecha). */
  function aIso(v) {
    // No instanceof: una fecha de otro contexto (la hoja, los tests) también es una fecha.
    if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : isoDeData(v);
    const s = net(v);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valida(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return '';
  }

  function valida(a, mes, dia) {
    const d = new Date(a, mes - 1, dia);
    return d.getFullYear() === a && d.getMonth() === mes - 1 && d.getDate() === dia ? isoDeData(d) : '';
  }

  function aData(iso) {
    const m = net(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function avuiIso(ms) {
    return isoDeData(new Date(ms));
  }

  /** 'DD/MM/AAAA' para enseñar. */
  function format(iso) {
    const m = net(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  /** Suma n días, setmanes o mesos a una fecha ISO ("d'aquí 4 mesos" = mismo día, 4 meses después). */
  function sumar(iso, n, unitat) {
    const d = aData(iso);
    if (!d) return '';
    if (unitat === 'mesos') {
      const dia = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      // 31/01 + 1 mes = 28/02 (o 29), no 03/03.
      const ultim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dia, ultim));
    } else {
      d.setDate(d.getDate() + n * (unitat === 'setmanes' ? 7 : 1));
    }
    return isoDeData(d);
  }

  function diesEntre(isoA, isoB) {
    const a = aData(isoA), b = aData(isoB);
    if (!a || !b) return NaN;
    return Math.round((b - a) / 86400000);
  }

  // ---- Lo que llega del formulario ----

  /**
   * {data, motiu, origen} del sidebar o del panel. data '' = sin recordatorio (si había
   * uno, se cancela). undefined/null = el formulario no lo toca.
   * @returns {{errors: string[], recordatori: object|null}}
   */
  function validar(r) {
    if (r === undefined || r === null) return { errors: [], recordatori: null };
    const brut = net(r.data);
    const data = aIso(brut);
    if (brut && !data) return { errors: ["La data del recordatori no és vàlida: " + brut], recordatori: null };
    return {
      errors: [],
      recordatori: {
        data: data,
        motiu: net(r.motiu).slice(0, 200) || MOTIU_PER_DEFECTE,
        origen: net(r.origen) === 'escàner' ? 'escàner' : 'manual'
      }
    };
  }

  /** Índice (en `objectes`) del recordatorio Actiu de un paciente, o -1. */
  function indexActiu(objectes, codi) {
    const c = net(codi).toUpperCase();
    for (let i = objectes.length - 1; i >= 0; i--) {
      if (net(objectes[i].codi_acces).toUpperCase() === c && net(objectes[i].estat) === ACTIU) return i;
    }
    return -1;
  }

  function actiuDe(objectes, codi) {
    const i = indexActiu(objectes, codi);
    return i === -1 ? null : objectes[i];
  }

  /**
   * Qué hacer en la pestaña al guardar el formulario de un paciente.
   * @param objectes filas de "Recordatoris" como objetos
   * @param nou resultado de validar().recordatori (null = no tocar)
   * @param pacient {codi_acces, cuenta_quartup, nombre}
   * @returns {{accio: 'cap'|'crear'|'actualitzar'|'cancellar', index?, objecte?}}
   */
  function planificar(objectes, nou, pacient) {
    if (!nou) return { accio: 'cap' };
    const i = indexActiu(objectes, pacient.codi_acces);
    if (!nou.data) return i === -1 ? { accio: 'cap' } : { accio: 'cancellar', index: i };
    if (i !== -1) {
      const a = objectes[i];
      if (a.data === nou.data && net(a.motiu) === nou.motiu) return { accio: 'cap' };
      return { accio: 'actualitzar', index: i, objecte: { data: nou.data, motiu: nou.motiu, origen: nou.origen } };
    }
    return {
      accio: 'crear',
      objecte: {
        codi_acces: net(pacient.codi_acces).toUpperCase(),
        cuenta_quartup: net(pacient.cuenta_quartup),
        nombre: net(pacient.nombre),
        data: nou.data,
        motiu: nou.motiu,
        estat: ACTIU,
        origen: nou.origen
      }
    };
  }

  /** ¿Se cierra al reenviar el pasaporte? Solo si ya toca o falta poco. */
  function tancaAlReenviar(r, avui) {
    return !!r && net(r.estat) === ACTIU && diesEntre(avui, r.data) <= DIES_MARGE_TANCAR;
  }

  /** Los Actius, los vencidos primero (por fecha). Cada uno con `vencut` y `dies` hasta la fecha. */
  function llistaActius(objectes, avui) {
    return objectes
      .filter(o => net(o.estat) === ACTIU && o.data)
      .map(o => Object.assign({}, o, { dies: diesEntre(avui, o.data), vencut: o.data <= avui, dataText: format(o.data) }))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  }

  function vencuts(objectes, avui) {
    return llistaActius(objectes, avui).filter(o => o.vencut);
  }

  // ---- Indicaciones de seguimiento del escáner (P10d) ----

  /**
   * "2ªC: 4 meses", "canvi de pilars en 4 mesos", "Control: 15 dies", "Ctrol 25 semanas"
   * -> {n, unitat, dies} (null si no hay un plazo).
   */
  function llegirTermini(text) {
    const s = net(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*(mes(?:es|os)?|m\b|mesos|setman(?:a|es)|seman(?:a|as)|sem\b|dies|dias|dia|d\b)/);
    if (!m) return null;
    const n = Math.round(parseFloat(m[1].replace(',', '.')));
    if (!(n > 0)) return null;
    const u = m[2];
    if (/^m/.test(u)) return { n: n, unitat: 'mesos', dies: n * 30 };
    if (/^s/.test(u)) return { n: n, unitat: 'setmanes', dies: n * 7 };
    return { n: n, unitat: 'dies', dies: n };
  }

  /**
   * De las indicaciones que el escáner ha leído en la ficha, la que se propone como
   * recordatorio: la de plazo más largo, si es de un mes o más, contada desde la fecha de
   * colocación (si no hay, desde hoy).
   * @param seguiment [{text}] o ['texto']
   * @returns {{text, n, unitat, dies, data}|null}
   */
  function proposarSeguiment(seguiment, fechaColocacion, avui) {
    let millor = null;
    (Array.isArray(seguiment) ? seguiment : []).forEach(s => {
      const text = net(s && typeof s === 'object' ? s.text : s);
      const t = llegirTermini(text);
      if (!t || t.dies < DIES_MINIMS_PROPOSTA) return;
      if (!millor || t.dies > millor.dies) millor = Object.assign({ text: text }, t);
    });
    if (!millor) return null;
    const base = aIso(fechaColocacion) || aIso(avui);
    millor.data = base ? sumar(base, millor.n, millor.unitat) : '';
    return millor;
  }

  return {
    MOTIU_PER_DEFECTE,
    ACTIU,
    FET,
    CANCELLAT,
    DIES_MARGE_TANCAR,
    COLUMNES,
    CAPCALERES,
    indexarCapcaleres,
    filaAObjecte,
    aIso,
    aData,
    avuiIso,
    format,
    sumar,
    diesEntre,
    validar,
    indexActiu,
    actiuDe,
    planificar,
    tancaAlReenviar,
    llistaActius,
    vencuts,
    llegirTermini,
    proposarSeguiment
  };
}

var RecordatoriModel = crearRecordatoriModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RecordatoriModel;
}
