// web/index.html (Netlify) tiene que ser exactamente src/Index.html + la cabecera pública.
// Si falla: npm run web, y commit de los dos archivos juntos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { generarWeb, ORIGEN, DESTI } = require('../scripts/generar-web');

test('web/index.html está al día con src/Index.html (npm run web)', () => {
  const esperat = generarWeb(fs.readFileSync(ORIGEN, 'utf8'));
  assert.equal(fs.readFileSync(DESTI, 'utf8').replace(/\r\n/g, '\n'), esperat);
});

test('la página pública es el portal entero, no un marco, y lleva icono e idioma', () => {
  const web = fs.readFileSync(DESTI, 'utf8');
  assert.doesNotMatch(web, /<iframe/i);
  assert.match(web, /<html lang="es">/);
  assert.match(web, /<link rel="icon" href="https:\/\/i\.postimg\.cc\//);
  assert.match(web, /og:title/);
  assert.match(web, /const API_URL = "https:\/\/script\.google\.com\/macros\/s\/AKfycbymkCc2/);
});
