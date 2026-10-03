// ==========================================
//  PortalModel - lo que el paciente puede ver y cómo se entra al portal
// ==========================================
// JS puro, sin servicios de Apps Script (como PacientModel): global en GAS y módulo en
// Node para los tests. Aquí viven las reglas de seguridad del portal desde que se quitó
// el PIN por email (S1, ADR 0003): el Codi d'accés solo basta para entrar, así que
// importa qué se enseña, cómo se comparan los códigos y cuántos intentos se permiten.

function crearPortalModel() {

  const URL_PORTAL = 'https://clinicapiestellercom.netlify.app/';

  // --- Codi d'accés ---

  // Sin O, 0, I, 1 ni L: son los que se confunden al leerlos o teclearlos.
  const ALFABET_CODI = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function netejarCodi(v) {
    return String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[\s.\-_]/g, '');
  }

  /**
   * Forma con la que se comparan los códigos: O=0, I=L=1, y los ceros a la izquierda que
   * Sheets se come cuando un código solo de cifras se guardó como número (012345 -> 12345).
   */
  function codiCanonic(v) {
    let s = netejarCodi(v).replace(/O/g, '0').replace(/[IL]/g, '1');
    if (/^\d{1,5}$/.test(s)) s = s.padStart(6, '0');
    return s;
  }

  /**
   * Genera un código de 6 caracteres que no choque con ninguno existente, ni siquiera
   * al normalizarlo. Nunca solo cifras ni con pinta de notación científica (12E345), que
   * Sheets convertiría en número.
   * @param {any[]} existents códigos ya usados
   * @param {function} [aleatori] () => [0, 1), para los tests
   */
  function generarCodi(existents, aleatori) {
    const rnd = aleatori || Math.random;
    const usats = new Set((existents || []).map(codiCanonic));
    let codi;
    do {
      codi = '';
      for (let i = 0; i < 6; i++) codi += ALFABET_CODI.charAt(Math.floor(rnd() * ALFABET_CODI.length));
    } while (usats.has(codiCanonic(codi)) || /^\d+$/.test(codi) || /^\d+E\d+$/.test(codi));
    return codi;
  }

  /**
   * Qué código de la hoja corresponde a lo que ha escrito el paciente. Primero el exacto
   * (sin contar mayúsculas ni separadores); si no hay, el que coincide al normalizar, pero
   * solo si es uno: si dos códigos distintos quedan iguales, no se elige ninguno, porque
   * se podría enseñar el pasaporte de otra persona.
   * @returns {{codi: string|null, ambigu: boolean}} `codi` tal como está en la hoja
   */
  function resoldreCodi(entrada, codisExistents) {
    const net = netejarCodi(entrada);
    if (!net) return { codi: null, ambigu: false };
    const distints = [];
    const vistos = new Set();
    (codisExistents || []).forEach(c => {
      const s = String(c === undefined || c === null ? '' : c).trim();
      const k = netejarCodi(s);
      if (k && !vistos.has(k)) { vistos.add(k); distints.push(s); }
    });
    const exacte = distints.find(c => netejarCodi(c) === net);
    if (exacte !== undefined) return { codi: exacte, ambigu: false };
    const canon = codiCanonic(net);
    const candidats = distints.filter(c => codiCanonic(c) === canon);
    if (candidats.length === 1) return { codi: candidats[0], ambigu: false };
    return { codi: null, ambigu: candidats.length > 1 };
  }

  /**
   * Diagnóstico de los códigos existentes para "Comprovar-ho tot".
   * @param {any[]} codis valores crudos de la columna (pueden repetirse: un código por implante)
   * @param {string[]} [excepcions] códigos que se saben especiales (DEMO2026)
   * @returns {{numerics: string[], llargadaRara: string[], xocs: string[][]}}
   */
  function analitzarCodis(codis, excepcions) {
    const exc = new Set((excepcions || []).map(netejarCodi));
    const numerics = [];
    const llargadaRara = [];
    const perCanon = {};
    const vistos = new Set();
    (codis || []).forEach(c => {
      if (c === '' || c === null || c === undefined) return;
      const s = String(c).trim();
      const k = netejarCodi(s);
      if (!k || vistos.has(k)) return;
      vistos.add(k);
      if (typeof c === 'number') numerics.push(s);
      else if (!exc.has(k) && k.length !== 6) llargadaRara.push(s);
      const canon = codiCanonic(s);
      (perCanon[canon] = perCanon[canon] || []).push(s);
    });
    const xocs = Object.keys(perCanon).map(k => perCanon[k]).filter(l => l.length > 1);
    return { numerics, llargadaRara, xocs };
  }

  // --- Lo que ve el paciente ---

  // Lista blanca: lo único que sale del servidor hacia el portal y el PDF. Lo demás
  // (email, Cuenta Quartup, casillas internas, DNI completo) no sale nunca. Una columna
  // nueva que deba ver el paciente se añade aquí (p. ej. el pilar estructurado de S4).
  const CAMPS_PORTAL = ['posicion', 'fecha_colocacion', 'marca', 'modelo', 'dimensiones',
    'plataforma', 'conexion', 'pilar', 'cod_implante', 'lote',
    // Detalles del pilar (S4); los muestra el pasaporte de S5.
    'pilar_altura', 'pilar_angulacion', 'pilar_marca', 'pilar_conexion', 'pilar_ref'];
  // Además, perAlPortal añade `pilar_pendiente` (bool) y los textos ya escritos
  // (implante_texto, conexion_texto, pilar_texto). Las casillas de S3 (`pendent`,
  // `que_falta`) son internas: no salen nunca.

  /** `***4567**` (DNI) o `****4567*` (NIE); null si no hay DNI válido. */
  function emmascararDni(v) {
    const s = String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');
    if (/^\d{8}[A-Z]$/.test(s)) return '***' + s.slice(3, 7) + '**';
    if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return '****' + s.slice(4, 8) + '*';
    return null;
  }

  function esData(v) {
    return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
  }

  function aText(v) {
    if (v === undefined || v === null) return '';
    if (esData(v)) return v.getDate() + '/' + (v.getMonth() + 1) + '/' + v.getFullYear();
    return String(v);
  }

  function esCert(v) {
    return v === true || /^(TRUE|VERDADERO)$/i.test(String(v).trim());
  }

  /**
   * Una fila-implante (objeto de PacientModel) tal como la puede ver el paciente, con los
   * textos ya escritos (los mismos que el PDF: la pantalla no los rehace).
   * @param {{pilarPendiente?: boolean}} [opcions] calculado en el servidor a partir de las
   *   casillas internas (S3); de la fila nunca se copia nada interno.
   */
  function perAlPortal(o, opcions) {
    const out = { nombre: aText(o.nombre) };
    const dni = esCert(o.sense_dni) ? null : emmascararDni(o.dni);
    if (dni) out.dni_parcial = dni;
    CAMPS_PORTAL.forEach(k => { if (k in o) out[k] = aText(o[k]); });
    out.pilar_pendiente = !!(opcions && opcions.pilarPendiente);
    return Object.assign(out, textosImplant(out));
  }

  // --- Límite de intentos ---
  // Sin PIN, lo que frena probar códigos al azar es el tamaño del espacio y este límite.
  // Es global (Apps Script no ve la IP): ventanas fijas de 10 min en CacheService.

  const LIMIT = { fallits: 20, finestraSegons: 600, pausaSegons: 900, avisSegons: 21600 };

  function estaPausat(cache) {
    return !!cache.get('PORTAL_PAUSA');
  }

  /**
   * Cuenta un intento fallido (o una petición de recuperar código).
   * @returns {{pausat: boolean, nouAvis: boolean}} `nouAvis`: es la primera vez que
   *   salta en las últimas 6 h, hay que avisar al responsable.
   */
  function registrarIntentFallit(cache, araMs) {
    const clau = 'PORTAL_FALLITS_' + Math.floor(araMs / (LIMIT.finestraSegons * 1000));
    const n = (parseInt(cache.get(clau), 10) || 0) + 1;
    cache.put(clau, String(n), LIMIT.finestraSegons);
    if (n < LIMIT.fallits) return { pausat: false, nouAvis: false };
    cache.put('PORTAL_PAUSA', '1', LIMIT.pausaSegons);
    if (cache.get('PORTAL_AVISAT')) return { pausat: true, nouAvis: false };
    cache.put('PORTAL_AVISAT', '1', LIMIT.avisSegons);
    return { pausat: true, nouAvis: true };
  }

  // --- Textos ---

  function escapar(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /** Mensaje para el paciente (en español), listo para reenviar por WhatsApp. */
  function missatgePacient(p) {
    return 'Hola, ' + String(p.nombre || '').trim() + ':\n\n' +
      'Le enviamos el acceso a su Pasaporte Implantológico de la Clínica Dental Drs. Pi y Esteller, ' +
      'donde puede consultar la marca, el modelo y el lote de sus implantes.\n\n' +
      'Código de acceso: ' + p.codi + '\n' +
      'Entre aquí: ' + URL_PORTAL + '\n\n' +
      'Guarde este mensaje. Si tiene cualquier duda, estamos a su disposición.';
  }

  /** Abre WhatsApp con el texto escrito; quien lo envía elige el contacto. */
  function enllacWhatsApp(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  /**
   * Email interno (en catalán) para que la Secretària haga llegar el pasaporte a un
   * paciente sin email. Lleva el DNI completo: es para encontrarlo en sus contactos.
   * @param {{nombre, cuenta_quartup, dni, codi}} p
   */
  function avisSecretaria(p) {
    const missatge = missatgePacient(p);
    const wa = enllacWhatsApp(missatge);
    const fila = (etiqueta, valor) => valor
      ? `<tr><td style="padding:4px 12px 4px 0;color:#555;">${etiqueta}</td><td style="padding:4px 0;"><b>${escapar(valor)}</b></td></tr>`
      : '';
    const html = `
      <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:560px;">
        <p>Hola,</p>
        <p>S'ha desat el pasaport implantològic d'un pacient <b>sense email</b>. Si us plau, feu-li arribar el codi d'accés.</p>
        <table style="border-collapse:collapse;margin:12px 0;">
          ${fila('Pacient', p.nombre)}
          ${fila('Cuenta Quartup', p.cuenta_quartup)}
          ${fila('DNI', p.dni)}
          ${fila("Codi d'accés", p.codi)}
        </table>
        <p style="margin-top:20px;"><b>Missatge per al pacient</b> (ja escrit, en castellà):</p>
        <div style="background:#f3f4f6;border-left:4px solid #02234f;padding:12px;white-space:pre-wrap;">${escapar(missatge)}</div>
        <p style="margin:20px 0;">
          <a href="${escapar(wa)}" style="background:#25D366;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block;">Enviar per WhatsApp</a>
        </p>
        <p style="font-size:13px;color:#555;">El botó obre WhatsApp amb el missatge escrit: tria el contacte del pacient i envia'l. El pasaport en PDF va adjunt per si el voleu imprimir.</p>
      </div>`;
    const text = "S'ha desat el pasaport implantològic d'un pacient sense email. Feu-li arribar el codi d'accés.\n\n" +
      'Pacient: ' + (p.nombre || '') + '\n' +
      'Cuenta Quartup: ' + (p.cuenta_quartup || '-') + '\n' +
      'DNI: ' + (p.dni || '-') + '\n' +
      "Codi d'accés: " + p.codi + '\n\n' +
      '--- Missatge per al pacient ---\n' + missatge + '\n\n' +
      'Enviar per WhatsApp: ' + wa;
    return { assumpte: 'Pasaport sense email: ' + String(p.nombre || '').trim() + ' (' + p.codi + ')', html, text };
  }

  // --- Pasaporte (renderer único: portal, vista previa y PDF) ---

  function net(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }

  /**
   * Lo que el paciente lee del pilar. Vacío = "aún no se sabe": no se dice nada, salvo
   * que la ficha esté pendiente de ese pilar (pilar_pendiente, derivado en el servidor).
   * "Multi-unit 30º · 5 mm · Ticare · Externa · ref. pilar HE48865"
   */
  function textPilar(imp) {
    const tipus = net(imp.pilar);
    if (!tipus) return imp.pilar_pendiente === true ? 'Pendiente de colocar' : '';
    if (tipus === 'Sin pilar') return 'Sin pilar';
    const ang = net(imp.pilar_angulacion), alt = net(imp.pilar_altura), ref = net(imp.pilar_ref);
    return [tipus, ang && ang + 'º', alt && alt + ' mm', net(imp.pilar_marca), net(imp.pilar_conexion),
      ref && 'ref. pilar ' + ref].filter(Boolean).join(' · ');
  }

  /** "Interna · plataforma 4,1"; los vacíos no salen. */
  function textConexion(imp) {
    const plat = net(imp.plataforma);
    return [net(imp.conexion), plat && 'plataforma ' + plat].filter(Boolean).join(' · ');
  }

  /** Textos ya escritos para el portal: la pantalla no los rehace (los mismos que el PDF). */
  function textosImplant(imp) {
    return {
      implante_texto: [net(imp.marca), net(imp.modelo)].filter(Boolean).join(' '),
      conexion_texto: textConexion(imp),
      pilar_texto: textPilar(imp)
    };
  }

  const LOGO_URL = 'https://i.postimg.cc/tTX6JQ42/DR-PI-ESTELLER.png';
  const BLAU = '#02234f';
  const SERIF = "Georgia,'Times New Roman',serif";

  // El conversor de PDF de Apps Script (medido, S5): NO pinta ningún `background` y
  // oscurece a #ababab todo texto claro. Los rellenos van con box-shadow inset (el
  // navegador y el conversor los pintan igual) y el texto siempre oscuro sobre fondo
  // suave. Así la vista previa, la impresión y el PDF son el mismo diseño.
  const relleno = c => `box-shadow:inset 0 0 0 2000px ${c};`;
  const ETIQUETA = 'font-size:7.5px;letter-spacing:1.4px;text-transform:uppercase;color:#5f6f86;font-weight:bold;';
  const e = v => escapar(net(v) || '-');

  function capcalera(pacient, codi, dataEmissio, logo) {
    const dada = (etiqueta, valor, estil) => `
          <td style="padding:9px 14px;vertical-align:top;${estil || ''}">
            <div style="${ETIQUETA}padding-bottom:3px;">${etiqueta}</div>
            <div style="font-size:11.5px;color:${BLAU};">${valor}</div></td>`;
    const sep = 'border-left:1px solid #d5dce7;';
    return `
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:bottom;padding-bottom:12px;"><img src="${escapar(logo || LOGO_URL)}" style="height:52px;"></td>
          <td style="text-align:right;vertical-align:bottom;padding-bottom:12px;">
            <div style="${ETIQUETA}letter-spacing:2.4px;padding-bottom:5px;">Certificado de autenticidad y garantía</div>
            <div style="font-family:${SERIF};font-size:25px;color:${BLAU};">Pasaporte Implantológico</div>
          </td></tr></table>
        <div style="border-top:1px solid ${BLAU};border-bottom:1px solid ${BLAU};height:2px;margin-bottom:20px;"></div>
        <table style="width:100%;border-collapse:collapse;${relleno('#f3f6fa')}"><tr>
          ${dada('Paciente', e(pacient.nombre), 'width:34%;')}
          ${dada('DNI', e(pacient.dni_parcial), 'width:20%;' + sep)}
          ${dada('Fecha de emisión', e(dataEmissio), 'width:22%;' + sep)}
          ${dada('Código de acceso', e(codi), 'width:24%;' + sep)}
        </tr></table>
        <div style="font-family:${SERIF};font-size:16px;color:${BLAU};margin-top:30px;">Registro de Implantes Colocados</div>
        <div style="height:7px;"></div>`;
  }

  /**
   * Una fila por implante y, debajo, el pilar en una banda de color suave unida a él
   * (sin banda si textPilar está vacío). Cada implante es un <tbody> que no se parte
   * entre páginas; el <thead> se repite.
   */
  function cosPasaporte(implants) {
    const th = amplada => `width:${amplada};padding:7px 6px 7px 10px;text-align:left;${ETIQUETA}border-top:1px solid ${BLAU};border-bottom:1px solid ${BLAU};`;
    const cella = 'vertical-align:top;font-size:10.5px;color:#26354a;line-height:1.5;';
    const mini = t => `<span style="${ETIQUETA}font-size:7px;letter-spacing:1.2px;padding-right:5px;">${t}</span>`;
    const files = implants.map(i => {
      const pilar = textPilar(i);
      const td = `padding:11px 6px ${pilar ? 6 : 11}px 10px;${cella}` + (pilar ? '' : 'border-bottom:1px solid #d5dce7;');
      const conexion = textConexion(i);
      return `
          <tbody style="page-break-inside:avoid;">
            <tr>
              <td style="${td}font-weight:bold;font-size:11.5px;color:${BLAU};">${e(i.posicion)}</td>
              <td style="${td}"><span style="font-weight:bold;color:${BLAU};">${e(i.marca)}</span>${net(i.modelo) ? '<br><span style="color:#5f6f86;">' + escapar(net(i.modelo)) + '</span>' : ''}</td>
              <td style="${td}">${e(i.dimensiones)}</td>
              <td style="${td}">${conexion ? conexion.split(' · ').map(t => escapar(t).replace(/ /g, '&nbsp;')).join('<br>') : '-'}</td>
              <td style="${td}">${mini('Ref')}${e(i.cod_implante)}<br>${mini('Lote')}${e(i.lote)}</td>
              <td style="${td}">${e(i.fecha_colocacion)}</td>
            </tr>` + (pilar ? `
            <tr><td colspan="6" style="padding:0;border-bottom:1px solid #d5dce7;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:10px;"><tr>
                <td style="width:10px;"></td>
                <td style="padding:8px 12px;border-left:4px solid #5b7fa8;${relleno('#e1eaf5')}font-size:10px;color:#1f3b5c;">
                  <span style="${ETIQUETA}color:#3f5c82;padding-right:8px;">Pilar</span>${escapar(pilar)}</td>
              </tr></table></td></tr>` : '') + `
          </tbody>`;
    }).join('');
    return `
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
          <thead><tr><th style="${th('18%')}">Posición</th><th style="${th('19%')}">Implante</th><th style="${th('11%')}">Medidas</th>
            <th style="${th('20%')}">Conexión</th><th style="${th('16%')}">Ref / Lote</th><th style="${th('16%')}">Fecha</th></tr></thead>
          ${files}
        </table>`;
  }

  const PEU = `
        <div style="margin-top:38px;text-align:center;">
          <div style="border-top:1px solid ${BLAU};width:60px;margin:0 auto 12px auto;"></div>
          <div style="font-family:${SERIF};font-size:9.5px;color:#4a5b73;line-height:1.5;">Este documento certifica los componentes médicos implantados.<br>Se recomienda conservarlo para futuras referencias clínicas.</div>
          <div style="${ETIQUETA}padding-top:7px;">© Clínica Dental Drs. Pi y Esteller</div>
        </div>`;

  /**
   * HTML del pasaporte: el mismo para el portal, la vista previa, la impresión y el PDF
   * (que convierte el servidor). Solo tablas y estilos en línea (ver `relleno`). Recibe
   * datos ya filtrados por perAlPortal y ya ordenados.
   * @param {{logo?: string, nomesCos?: boolean}} [opcions] logo: URL o data URI;
   *   nomesCos: sin <html>/<body>, para meterlo dentro de otra página
   */
  function htmlPasaporte(pacient, implants, codi, dataEmissio, opcions) {
    const o = opcions || {};
    const contingut = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#26354a;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${capcalera(pacient || {}, codi, dataEmissio, o.logo)}
        ${cosPasaporte(implants || [])}
        ${PEU}
      </div>`;
    if (o.nomesCos) return contingut;
    return `<html><head><meta charset="utf-8"></head><body>${contingut}</body></html>`;
  }

  return {
    URL_PORTAL,
    ALFABET_CODI,
    CAMPS_PORTAL,
    LIMIT,
    netejarCodi,
    codiCanonic,
    generarCodi,
    resoldreCodi,
    analitzarCodis,
    emmascararDni,
    perAlPortal,
    estaPausat,
    registrarIntentFallit,
    escapar,
    missatgePacient,
    enllacWhatsApp,
    avisSecretaria,
    textPilar,
    textConexion,
    textosImplant,
    htmlPasaporte
  };
}

var PortalModel = crearPortalModel();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PortalModel;
}
