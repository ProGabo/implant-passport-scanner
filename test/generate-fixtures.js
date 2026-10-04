const fs = require('node:fs');
const path = require('node:path');
const ScanEngine = require('../src/ScanEngine.js');
const { curlHttpFetch } = require('./httpFetchSync.js');

const TEST_DIR = __dirname;
const FIXTURES_DIR = path.join(TEST_DIR, 'fixtures');
const GOLDEN_DIR = path.join(TEST_DIR, 'golden');

function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set. Add it to .env, then run: npm run generate-fixtures');
    process.exit(1);
  }

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  const pdfFiles = fs.readdirSync(TEST_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  if (pdfFiles.length === 0) {
    console.error('No PDFs found directly in test/. Put the sample PDFs there first.');
    process.exit(1);
  }

  console.log(`Found ${pdfFiles.length} PDF(s). This makes one real Gemini call per PDF (uses daily quota).\n`);

  const manifest = {};

  pdfFiles.forEach((filename, index) => {
    const sampleName = `sample-${index + 1}`;
    console.log(`[${sampleName}] scanning "${filename}"...`);

    const filePath = path.join(TEST_DIR, filename);
    const base64Data = fs.readFileSync(filePath).toString('base64');
    const mimeType = 'application/pdf';
    const promptText = ScanEngine.buildPrompt();

    let raw;
    let fields;
    try {
      raw = ScanEngine.geminiProvider(base64Data, mimeType, promptText, {
        httpFetch: curlHttpFetch,
        geminiApiKey: apiKey
      });
      fields = ScanEngine.parseResponse(raw);
    } catch (e) {
      console.error(`  FAILED: ${e.message}\n`);
      return;
    }

    fs.writeFileSync(path.join(FIXTURES_DIR, `${sampleName}.json`), raw);
    fs.writeFileSync(path.join(GOLDEN_DIR, `${sampleName}.json`), JSON.stringify(fields, null, 2));
    manifest[sampleName] = filename;

    console.log(`  -> ${fields.length} implant(s) parsed:`);
    console.log(JSON.stringify(fields, null, 2) + '\n');
  });

  // Samples of several PDFs (S7, e.g. test/multi/) are not regenerated here: keep them.
  const manifestPath = path.join(FIXTURES_DIR, 'MANIFEST.json');
  const previ = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  Object.keys(previ).filter(k => Array.isArray(previ[k])).forEach(k => { manifest[k] = previ[k]; });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('Done. REVIEW the golden output above (or test/golden/*.json) for clinical correctness');
  console.log('before treating these as regression baselines.');
}

main();
