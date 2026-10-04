// Mide el portal en producción: N logins y M PDFs seguidos con un código de prueba.
// Uso: node scripts/medir-portal.js [N=20] [M=5] [codi=DEMO2026]. El login pide el PDF a la
// vez, como el portal (ambPdf); los M PDFs aparte son el respaldo (pdfPasaporte).
// Cuenta como error cualquier respuesta que no sea JSON (la página HTML de Google del
// "Error de conexión") y las que tardan más del corte.
const API_URL = 'https://script.google.com/macros/s/AKfycbymkCc2Bf0pW82p6wUbpCIzIigaeYX9g7P-wTQxgTMpbAsqjF9JyB-W7LyCatuepz3O/exec';
const [N = 20, M = 5] = process.argv.slice(2, 4).map(Number);
const CODI = process.argv[4] || 'DEMO2026';
const CORTE_MS = 70000;

async function peticio(cos) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CORTE_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ diag: true }, cos)),
      signal: ctrl.signal
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    try {
      const json = JSON.parse(text);
      return { ms, ok: json.ok === true, error: json.ok ? null : 'ok=false: ' + json.message, diag: json._diag };
    } catch (e) {
      const titol = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || text.replace(/\s+/g, ' ').slice(0, 120);
      return { ms, ok: false, error: 'no es JSON (HTTP ' + res.status + '): ' + titol };
    }
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, error: e.name === 'AbortError' ? 'corte a ' + CORTE_MS / 1000 + ' s' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Lo que cuenta el servidor: carga del script y pasos (ms desde que entra en doPost).
function detall(r) {
  if (!r.diag) return '';
  return `  [carga ${r.diag.carrega_ms} ms; ` + r.diag.passos.map(p => p[0] + ' ' + p[1]).join(', ') + ']';
}

function resum(nom, rs) {
  const t = rs.map(r => r.ms).sort((a, b) => a - b);
  const pct = p => t[Math.min(t.length - 1, Math.floor(p * t.length))];
  const errors = rs.filter(r => !r.ok);
  console.log(`${nom}: n=${rs.length} mediana=${(pct(0.5) / 1000).toFixed(2)}s p90=${(pct(0.9) / 1000).toFixed(2)}s ` +
    `max=${(t[t.length - 1] / 1000).toFixed(2)}s errores=${errors.length}`);
  errors.forEach(e => console.log('  - ' + e.error + ' (' + (e.ms / 1000).toFixed(1) + ' s)'));
}

(async () => {
  const logins = [];
  for (let i = 0; i < N; i++) {
    const r = await peticio({ action: 'initiateLogin', code: CODI, ambPdf: true });
    logins.push(r);
    console.log(`login ${i + 1}/${N}: ${(r.ms / 1000).toFixed(2)} s${r.ok ? '' : ' ERROR ' + r.error}${detall(r)}`);
  }
  const pdfs = [];
  for (let i = 0; i < M; i++) {
    const r = await peticio({ action: 'pdfPasaporte', code: CODI });
    pdfs.push(r);
    console.log(`pdf ${i + 1}/${M}: ${(r.ms / 1000).toFixed(2)} s${r.ok ? '' : ' ERROR ' + r.error}${detall(r)}`);
  }
  console.log('');
  resum('Login', logins);
  if (M) resum('PDF', pdfs);
})();
