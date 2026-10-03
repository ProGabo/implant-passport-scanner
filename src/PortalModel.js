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

  function capcalera(pacient, codi, dataEmissio, logo) {
    return `
        <table style="width:100%;border-bottom:2px solid ${BLAU};margin-bottom:16px;"><tr>
          <td style="vertical-align:middle;"><img src="${escapar(logo || LOGO_URL)}" style="height:55px;"></td>
          <td style="text-align:right;vertical-align:middle;">
            <div style="font-size:20px;color:${BLAU};font-weight:bold;">Pasaporte Implantológico</div>
            <div style="color:#666;">Certificado de Autenticidad y Garantía</div>
          </td>
        </tr></table>
        <table style="width:100%;background:#f4f6f9;margin-bottom:18px;" cellpadding="6"><tr>
          <td><b>Paciente:</b> ${escapar(pacient.nombre)}</td>
          <td>${pacient.dni_parcial ? '<b>DNI:</b> ' + escapar(pacient.dni_parcial) : ''}</td>
        </tr><tr>
          <td><b>Fecha de emisión:</b> ${escapar(dataEmissio)}</td>
          <td><b>Código de acceso:</b> ${escapar(codi)}</td>
        </tr></table>
        <div style="font-size:14px;color:${BLAU};font-weight:bold;border-bottom:1px solid #ccc;padding-bottom:4px;">Registro de Implantes Colocados</div>`;
  }

  const PEU = `
        <div style="margin-top:36px;font-size:9px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:10px;">
          Este documento certifica los componentes médicos implantados. Se recomienda conservarlo para futuras referencias clínicas.<br>
          © Clínica Dental Drs. Pi y Esteller
        </div>`;

  const e = v => escapar(net(v) || '-');
  const refLote = i => `Ref: ${e(i.cod_implante)}<br>Lote: ${e(i.lote)}`;

  // A: una fila por implante y, debajo, el pilar en una banda de color unida a él.
  function cosVariantA(implants) {
    const th = `padding:6px;text-align:left;background:${BLAU};color:#fff;`;
    const td = 'padding:7px 6px;vertical-align:top;border-top:1px solid #cfd6df;';
    const files = implants.map(i => {
      const pilar = textPilar(i);
      return `
          <tr>
            <td style="${td}"><b>${e(i.posicion)}</b></td>
            <td style="${td}">${e([net(i.marca), net(i.modelo)].filter(Boolean).join(' '))}</td>
            <td style="${td}">${e(i.dimensiones)}</td>
            <td style="${td}">${e(textConexion(i))}</td>
            <td style="${td}">${refLote(i)}</td>
            <td style="${td}">${e(i.fecha_colocacion)}</td>
          </tr>` + (pilar ? `
          <tr>
            <td style="padding:0 6px 7px 6px;"></td>
            <td colspan="5" style="padding:5px 8px;background:#e8eef6;border-left:3px solid #5b7fa8;color:#1f3b5c;">
              <b>Pilar:</b> ${escapar(pilar)}
            </td>
          </tr>` : '');
    }).join('');
    return `
        <table style="width:100%;border-collapse:collapse;margin-top:10px;">
          <tr><th style="${th}">Posición</th><th style="${th}">Implante</th><th style="${th}">Medidas</th>
              <th style="${th}">Conexión</th><th style="${th}">Ref / Lote</th><th style="${th}">Fecha</th></tr>
          ${files}
        </table>`;
  }

  // B: una tarjeta por implante, con el pilar en una sub-tarjeta.
  function cosVariantB(implants) {
    const k = 'padding:3px 8px 3px 0;color:#666;width:22%;vertical-align:top;';
    const v = 'padding:3px 12px 3px 0;vertical-align:top;';
    return implants.map(i => {
      const pilar = textPilar(i);
      return `
        <table style="width:100%;border:1px solid #cfd6df;border-collapse:collapse;margin-top:12px;">
          <tr><td style="background:${BLAU};color:#fff;padding:6px 10px;font-weight:bold;">${e(i.posicion)}</td>
              <td style="background:${BLAU};color:#fff;padding:6px 10px;text-align:right;">Colocado: ${e(i.fecha_colocacion)}</td></tr>
          <tr><td colspan="2" style="padding:8px 10px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="${k}">Implante</td><td style="${v}"><b>${e([net(i.marca), net(i.modelo)].filter(Boolean).join(' '))}</b></td>
                  <td style="${k}">Ref</td><td style="${v}">${e(i.cod_implante)}</td></tr>
              <tr><td style="${k}">Medidas</td><td style="${v}">${e(i.dimensiones)}</td>
                  <td style="${k}">Lote</td><td style="${v}">${e(i.lote)}</td></tr>
              <tr><td style="${k}">Conexión</td><td style="${v}" colspan="3">${e(textConexion(i))}</td></tr>
            </table>` + (pilar ? `
            <table style="width:100%;border-collapse:collapse;margin-top:6px;"><tr>
              <td style="padding:6px 10px;background:#e8eef6;border-left:3px solid #5b7fa8;color:#1f3b5c;"><b>Pilar:</b> ${escapar(pilar)}</td>
            </tr></table>` : '') + `
          </td></tr>
        </table>`;
    }).join('');
  }

  // C: tabla compacta, una fila por implante (referencia para comparar).
  function cosVariantC(implants) {
    const th = `padding:5px;text-align:left;background:${BLAU};color:#fff;`;
    const td = 'padding:5px;border-bottom:1px solid #ddd;vertical-align:top;';
    const files = implants.map(i => `
          <tr>
            <td style="${td}"><b>${e(i.posicion)}</b></td>
            <td style="${td}">${e([net(i.marca), net(i.modelo)].filter(Boolean).join(' '))}</td>
            <td style="${td}">${e(i.dimensiones)}</td>
            <td style="${td}">${e(textConexion(i))}</td>
            <td style="${td}">${refLote(i)}</td>
            <td style="${td}">${escapar(textPilar(i))}</td>
            <td style="${td}">${e(i.fecha_colocacion)}</td>
          </tr>`).join('');
    return `
        <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:10px;">
          <tr><th style="${th}">Posición</th><th style="${th}">Implante</th><th style="${th}">Medidas</th>
              <th style="${th}">Conexión</th><th style="${th}">Ref / Lote</th><th style="${th}">Pilar</th><th style="${th}">Fecha</th></tr>
          ${files}
        </table>`;
  }

  const VARIANTS = { A: cosVariantA, B: cosVariantB, C: cosVariantC };

  /**
   * HTML del pasaporte: el mismo para el portal, la vista previa y el PDF (que convierte
   * el servidor). Solo tablas y estilos en línea: el conversor de Apps Script no entiende
   * CSS moderno. Recibe datos ya filtrados por perAlPortal y ya ordenados.
   * @param {{variant?: string, logo?: string, nomesCos?: boolean}} [opcions] logo: URL o
   *   data URI; nomesCos: sin <html>/<body>, para meterlo dentro de otra página
   */
  function htmlPasaporte(pacient, implants, codi, dataEmissio, opcions) {
    const o = opcions || {};
    const cos = VARIANTS[o.variant] || cosVariantA;
    const contingut = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#333;font-size:11px;">
        ${capcalera(pacient || {}, codi, dataEmissio, o.logo)}
        ${cos(implants || [])}
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
