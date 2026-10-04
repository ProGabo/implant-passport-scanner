// Genera web/index.html (lo que publica Netlify) a partir de src/Index.html (el portal).
// El portal se sirve estático desde Netlify y solo llama a Apps Script por fetch (ADR 0005):
// aquí solo se le añade lo que necesita la página pública (idioma, icono, vista previa al
// compartir el enlace). Uso: npm run web
const fs = require('node:fs');
const path = require('node:path');

const ARREL = path.join(__dirname, '..');
const ORIGEN = path.join(ARREL, 'src', 'Index.html');
const DESTI = path.join(ARREL, 'web', 'index.html');

const ICONA = 'https://i.postimg.cc/tTX6JQ42/DR-PI-ESTELLER.png';
const CAP = [
  `<link rel="icon" href="${ICONA}" type="image/png">`,
  '<meta property="og:title" content="Consulta implantes - Clínica Dental">',
  '<meta property="og:description" content="Accede a tu pasaporte de implantes de forma digital.">',
  `<meta property="og:image" content="${ICONA}">`
];

function substituir(text, de, a) {
  if (!de.test(text)) throw new Error('src/Index.html ha cambiado: no encuentro ' + de);
  return text.replace(de, a);
}

/** @param {string} index contenido de src/Index.html @returns {string} web/index.html */
function generarWeb(index) {
  let html = index.replace(/\r\n/g, '\n');
  html = substituir(html, /<!DOCTYPE html>\n<html>/i,
    '<!DOCTYPE html>\n<!-- Generado desde src/Index.html con "npm run web". No lo edites a mano. -->\n<html lang="es">');
  html = substituir(html, /<meta name="viewport"[^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">');
  html = substituir(html, /(\n(\s*)<title>[^<]*<\/title>)/i, (m, linia, sagnat) => linia + CAP.map(l => '\n' + sagnat + l).join(''));
  return html;
}

if (require.main === module) {
  fs.writeFileSync(DESTI, generarWeb(fs.readFileSync(ORIGEN, 'utf8')));
  console.log('web/index.html generado desde src/Index.html');
}

module.exports = { generarWeb, ORIGEN, DESTI };
