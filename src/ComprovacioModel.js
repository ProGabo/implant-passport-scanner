// ==========================================
//  ComprovacioModel - avisos antes de guardar y vocabulario de implantes
// ==========================================
// JS puro, sin servicios de Apps Script (como PacientModel y PortalModel): global en GAS y
// módulo en Node para los tests. Reglas locales, sin IA (decidido en S5).
//
// Lo "conocido" sale de la hoja Pacientes (cuántas veces se ha usado cada valor), no del
// catálogo: el catálogo aprende cualquier cosa que se guarde, también los errores, así que
// "está en el catálogo" no dice si está bien escrito. Un valor usado 300 veces sí.
//
// PacientModel se busca al llamar, no al cargar: en Apps Script el orden de carga de los
// archivos no está garantizado.

function crearComprovacioModel() {

  function pm() {
    return typeof PacientModel !== 'undefined' ? PacientModel : require('./PacientModel.js');
  }

  function net(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }

  /** Para comparar: sin acentos, sin mayúsculas, espacios simples. */
  function clau(v) {
    return net(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }

  // Campos de texto libre que se comprueban contra lo ya usado. `dins`: el modelo solo se
  // compara con los modelos de la misma marca.
  const CAMPS = [
    { k: 'marca', nom: 'la marca' },
    { k: 'modelo', nom: 'el model', dins: 'marca' },
    { k: 'conexion', nom: 'la connexió' },
    { k: 'pilar_marca', nom: 'la marca del pilar' }
  ];

  /**
   * Cuántas veces sale cada valor en la hoja.
   * @param {object[]} objetos filas de PacientModel
   * @returns {Object<string, Object<string, {valor: string, n: number, formes: Object<string, number>}>>}
   *   campo (o "modelo|<marca>") -> clave normalizada -> forma más usada y total
   */
  function vocabulari(objetos) {
    const voc = {};
    (objetos || []).forEach(o => {
      CAMPS.forEach(c => {
        const v = net(o[c.k]);
        if (!v) return;
        const grup = c.dins ? c.k + '|' + clau(o[c.dins]) : c.k;
        const g = voc[grup] = voc[grup] || {};
        const e = g[clau(v)] = g[clau(v)] || { valor: v, n: 0, formes: {} };
        e.n++;
        e.formes[v] = (e.formes[v] || 0) + 1;
        if (e.formes[v] > (e.formes[e.valor] || 0)) e.valor = v;
      });
    });
    return voc;
  }

  /**
   * Distancia de edición entre dos textos cortos, contando como un solo error dos letras
   * cambiadas de sitio ("Interan" / "Interna"), que es la errata más típica al teclear.
   */
  function distancia(a, b) {
    if (a === b) return 0;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /** El valor conocido más usado que se parece a `k` (1-2 letras de diferencia), o null. */
  function mesSemblant(k, grup) {
    let millor = null;
    Object.keys(grup || {}).forEach(kk => {
      const d = distancia(k, kk);
      const max = Math.max(1, Math.min(2, Math.floor(Math.max(k.length, kk.length) / 4)));
      if (d === 0 || d > max) return;
      if (!millor || grup[kk].n > millor.n) millor = grup[kk];
    });
    return millor;
  }

  // "4,0 x 10", "4.1 x 10 mm", "3,75x11,5"
  const RE_MIDES = /^\d+([.,]\d+)?\s*[xX×]\s*\d+([.,]\d+)?(\s*mm)?$/;

  /** Fecha de colocación: Date, d/m/aaaa o aaaa-mm-dd. null si no se entiende. */
  function llegirData(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
    const s = net(v);
    let a, me, di;
    let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) { di = +m[1]; me = +m[2]; a = +m[3]; }
    else {
      m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      a = +m[1]; me = +m[2]; di = +m[3];
    }
    const d = new Date(a, me - 1, di);
    // 31/2/2026 no existe: Date lo pasaría a marzo.
    return d.getMonth() === me - 1 && d.getDate() === di ? d : null;
  }

  function etiqueta(imp, n) {
    const p = net(imp.posicion);
    return p ? 'Implant ' + p : 'Implant ' + (n + 1) + ' (sense posició)';
  }

  /**
   * Avisos (en catalán, para la Auxiliar) del pasaporte tal como quedará. Nunca bloquean.
   * @param {object[]} implants filas del paciente tal como quedarán (planificarDesat)
   * @param {object[]} historic filas de los DEMÁS pacientes: las del propio paciente no
   *   cuentan como "conocidas", si no, un error se daría por bueno a sí mismo
   * @param {{avui?: Date}} [opcions]
   * @returns {string[]}
   */
  function comprovarPasaport(implants, historic, opcions) {
    const o = opcions || {};
    const avui = o.avui || new Date();
    const voc = vocabulari(historic);
    const avisos = [];
    const vistes = {};

    (implants || []).forEach((imp, n) => {
      const qui = etiqueta(imp, n);

      // Texto libre contra lo ya usado.
      CAMPS.forEach(c => {
        const v = net(imp[c.k]);
        if (!v) return;
        if (c.dins && !net(imp[c.dins])) return;
        const grup = voc[c.dins ? c.k + '|' + clau(imp[c.dins]) : c.k];
        if (c.dins && !grup) return; // marca nueva: ya se avisa por la marca
        const k = clau(v);
        const conegut = grup && grup[k];
        const s = mesSemblant(k, grup);
        if (conegut) {
          // Un error que ya se guardó alguna vez no se da por bueno si hay una forma
          // parecida mucho más usada ("Interan" 1 vez frente a "Interna" 30).
          if (s && s.n >= 5 * conegut.n) {
            avisos.push(`${qui}: ${c.nom} «${v}» s'assembla a «${s.valor}» (${s.n} vegades). Està ben escrit?`);
          } else if (conegut.valor !== v && conegut.formes[conegut.valor] > (conegut.formes[v] || 0)) {
            avisos.push(`${qui}: ${c.nom} «${v}» normalment s'escriu «${conegut.valor}».`);
          }
          return;
        }
        if (s) avisos.push(`${qui}: ${c.nom} «${v}» s'assembla a «${s.valor}» (${s.n} ${s.n === 1 ? 'vegada' : 'vegades'}). Està ben escrit?`);
        else if (grup || !c.dins) avisos.push(`${qui}: és la primera vegada que surt ${c.nom} «${v}». Està ben escrit?`);
      });

      // Formatos.
      const pos = net(imp.posicion);
      if (!pos) avisos.push(`${qui}: falta la posició.`);
      else if (!pm().esPosicioValida(pos)) avisos.push(`${qui}: la posició «${pos}» no és una dent (11-48) ni una fisura pterigoidea.`);
      else if (vistes[pos]) avisos.push(`${qui}: hi ha dos implants a la mateixa posició.`);
      if (pos) vistes[pos] = true;

      const mides = net(imp.dimensiones);
      if (mides && !RE_MIDES.test(mides)) avisos.push(`${qui}: les mides «${mides}» no tenen la forma «4,0 x 10».`);

      const dataTxt = net(imp.fecha_colocacion);
      if (!dataTxt) avisos.push(`${qui}: falta la data de col·locació.`);
      else {
        const d = llegirData(imp.fecha_colocacion);
        if (!d) avisos.push(`${qui}: no entenc la data «${dataTxt}».`);
        else if (d.getTime() > avui.getTime()) avisos.push(`${qui}: la data ${dataTxt} és futura.`);
      }

      if (!net(imp.cod_implante)) avisos.push(`${qui}: falta la Ref de l'implant.`);
      if (!net(imp.lote)) avisos.push(`${qui}: falta el lot de l'implant.`);

      const pc = net(imp.pilar_conexion);
      if (pc && pc !== 'Externa' && pc !== 'Interna') avisos.push(`${qui}: la connexió del pilar és «${pc}»; ha de ser Externa o Interna.`);
    });
    return avisos;
  }

  /**
   * Opciones de los desplegables del sidebar. Los modelos de cada marca salen de las filas
   * de Pacientes, donde marca y modelo van juntos de verdad: en el catálogo cada columna es
   * una lista independiente y la fila no empareja nada.
   * @param {{marques: string[], models: string[], connexions: string[]}} cataleg
   * @param {object[]} objetos filas de Pacientes
   */
  function opcionsImplant(cataleg, objetos) {
    const c = cataleg || {};
    const voc = vocabulari(objetos);
    // Sin las erratas: un valor que se parece a otro mucho más usado no se sugiere (el
    // catálogo las aprendió al guardar; sugerirlas las repetiría).
    const errata = (k, grup) => {
      const s = mesSemblant(k, grup);
      return !!(s && s.n >= 5 * Math.max(1, (grup[k] && grup[k].n) || 0));
    };
    const unics = (llista, grup) => {
      const vist = {};
      llista.forEach(v => {
        const s = net(v);
        if (!s || vist[clau(s)] || (grup && errata(clau(s), grup))) return;
        // La forma más usada en la hoja, si la hay.
        vist[clau(s)] = (grup && grup[clau(s)] && grup[clau(s)].valor) || s;
      });
      return Object.keys(vist).map(k => vist[k]).sort((a, b) => a.localeCompare(b, 'es'));
    };
    const perMarca = {};
    const nomMarca = {};
    (objetos || []).forEach(o => {
      const m = net(o.marca), mo = net(o.modelo);
      if (!m) return;
      nomMarca[clau(m)] = nomMarca[clau(m)] || m;
      if (mo) (perMarca[clau(m)] = perMarca[clau(m)] || []).push(mo);
    });
    const brands = unics((c.marques || []).concat((objetos || []).map(o => o.marca)), voc.marca || {});
    const modelsByBrand = {};
    brands.forEach(b => { modelsByBrand[b] = unics(perMarca[clau(b)] || [], voc['modelo|' + clau(b)] || {}); });
    return {
      brands,
      modelsByBrand,
      allConnections: unics((c.connexions || []).concat((objetos || []).map(o => o.conexion)), voc.conexion || {})
    };
  }

  return {
    clau,
    vocabulari,
    distancia,
    comprovarPasaport,
    opcionsImplant
  };
}

var ComprovacioModel = crearComprovacioModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ComprovacioModel;
}
