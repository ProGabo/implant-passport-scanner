const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads every available sample as { name, pdfPath, pdfPaths, fixturePath, goldenPath,
 * seguimentPath }. A MANIFEST value is one PDF or (S7) an array of PDFs of the SAME
 * patient, scanned together in one request; pdfPath is then the first one.
 * seguimentPath (optional file): the follow-up proposal expected from the scan (P10d).
 *
 * Two sets share one layout (<root>/fixtures/MANIFEST.json, <root>/golden/,
 * PDFs at <root>/<filename>):
 *   - public:  test/ itself - committed, fully synthetic PDFs, safe to publish.
 *   - private: test/private/ - real clinic scans, gitignored, only present on
 *     machines that have them. Their goldens are verified baselines; do not
 *     regenerate them blindly (live-model drift would get blessed as correct).
 */
function loadSamples() {
  const samples = [];
  const sets = [
    { label: '', root: __dirname },
    { label: 'private/', root: path.join(__dirname, 'private') }
  ];
  sets.forEach(({ label, root }) => {
    const manifestPath = path.join(root, 'fixtures', 'MANIFEST.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    Object.keys(manifest).sort().forEach((sampleName) => {
      const pdfPaths = [].concat(manifest[sampleName]).map(f => path.join(root, f));
      samples.push({
        name: label + sampleName,
        pdfPath: pdfPaths[0],
        pdfPaths: pdfPaths,
        fixturePath: path.join(root, 'fixtures', `${sampleName}.json`),
        goldenPath: path.join(root, 'golden', `${sampleName}.json`),
        seguimentPath: path.join(root, 'golden', `${sampleName}.seguiment.json`)
      });
    });
  });
  return samples;
}

module.exports = { loadSamples };
