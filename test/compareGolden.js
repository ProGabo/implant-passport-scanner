// Shared golden comparison for the LIVE accuracy suites (accuracy.js, accuracy-fallback.js).
//
// Goldens are a snapshot of verified-correct output, but live models drift over time
// (observed 2026-07-09: unchanged prompt, direct Gemini started returning
// "No especificado"/swapped positions on documents it previously nailed). A live test
// that hard-fails on that drift just trains everyone to ignore red. So: hard-fail only
// on the traceability-critical values printed on the sticker — the ones nobody can
// safely re-derive from memory later — and report (visibly, but passing) drift on the
// soft fields the staff already reviews in the editable sidebar form before saving.
const CRITICAL_FIELDS = ['lote', 'cod_implante', 'diametro', 'longitud'];
const SOFT_FIELDS = ['fecha_colocacion', 'marca', 'modelo', 'conexion', 'plataforma', 'posicion', 'pilar'];

function compareToGolden(actual, expected) {
  const critical = [];
  const soft = [];
  if (actual.length !== expected.length) {
    critical.push(`implant count ${actual.length} (expected ${expected.length})`);
    return { critical, soft };
  }
  expected.forEach((exp, i) => {
    CRITICAL_FIELDS.forEach((k) => {
      if (String(actual[i][k]) !== String(exp[k])) critical.push(`[${i}].${k}: got ${JSON.stringify(actual[i][k])}, expected ${JSON.stringify(exp[k])}`);
    });
    SOFT_FIELDS.forEach((k) => {
      if (String(actual[i][k]) !== String(exp[k])) soft.push(`[${i}].${k}: got ${JSON.stringify(actual[i][k])}, expected ${JSON.stringify(exp[k])}`);
    });
  });
  return { critical, soft };
}

module.exports = { compareToGolden, CRITICAL_FIELDS, SOFT_FIELDS };
