const fs = require('node:fs');
const path = require('node:path');
const ScanEngine = require('../src/ScanEngine.js');
const { curlHttpFetch } = require('./httpFetchSync.js');
const { compareToGolden } = require('./compareGolden.js');

const TEST_DIR = __dirname;
const GOLDEN_DIR = path.join(TEST_DIR, 'golden');
const MANIFEST_PATH = path.join(TEST_DIR, 'fixtures', 'MANIFEST.json');

function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set. Add it to .env.');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No test/fixtures/MANIFEST.json found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const sampleNames = Object.keys(manifest).sort();

  console.log(`Running accuracy test against LIVE Gemini for ${sampleNames.length} sample(s).`);
  console.log('This makes real API calls and uses daily quota.\n');

  let passed = 0;
  let failed = 0;

  sampleNames.forEach((sampleName) => {
    const filename = manifest[sampleName];
    const filePath = path.join(TEST_DIR, filename);
    const goldenPath = path.join(GOLDEN_DIR, `${sampleName}.json`);

    if (!fs.existsSync(filePath) || !fs.existsSync(goldenPath)) {
      console.log(`[${sampleName}] SKIP - missing PDF or golden file`);
      return;
    }

    const base64Data = fs.readFileSync(filePath).toString('base64');
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

    try {
      const result = ScanEngine.scanPassport(base64Data, 'application/pdf', {
        httpFetch: curlHttpFetch,
        geminiApiKey: apiKey
      });

      if (!result.ok) {
        console.log(`[${sampleName}] FAIL - engine returned: ${result.message}`);
        failed++;
        return;
      }

      const { critical, soft } = compareToGolden(result.data, expected);
      if (critical.length > 0) {
        console.log(`[${sampleName}] FAIL - critical field mismatch: ${critical.join(' | ')}`);
        failed++;
        return;
      }
      const softNote = soft.length > 0 ? ` (${soft.length} soft diff(s): ${soft.join(' | ')})` : '';
      console.log(`[${sampleName}] PASS${softNote}`);
      passed++;
    } catch (e) {
      console.log(`[${sampleName}] FAIL - ${e.message}`);
      failed++;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
