const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ScanEngine = require('../ScanEngine.js');
const { curlHttpFetch } = require('./httpFetchSync.js');

const TEST_DIR = __dirname;
const GOLDEN_DIR = path.join(TEST_DIR, 'golden');
const MANIFEST_PATH = path.join(TEST_DIR, 'fixtures', 'MANIFEST.json');

/**
 * Forces Gemini to fail (synthetic 429, no real call) while letting OpenRouter calls
 * through for real — proves scanPassport's fallback path actually reaches OpenRouter
 * instead of just asserting it in isolation.
 */
function poisonedHttpFetch(url, options) {
  if (url.indexOf('generativelanguage.googleapis.com') !== -1) {
    return { status: 429, text: '{"error":{"message":"simulated quota exceeded"}}' };
  }
  return curlHttpFetch(url, options);
}

function main() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    console.error('OPENROUTER_API_KEY not set. Add it to .env.');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No test/fixtures/MANIFEST.json found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const sampleNames = Object.keys(manifest).sort();

  console.log(`Running fallback accuracy test (Gemini forced down) against LIVE OpenRouter for ${sampleNames.length} sample(s).`);
  console.log('Gemini calls are simulated (no network); OpenRouter calls use the free model ($0).\n');

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
        httpFetch: poisonedHttpFetch,
        geminiApiKey: 'unused-gemini-is-forced-down',
        openRouterApiKey
      });

      if (!result.ok) {
        console.log(`[${sampleName}] FAIL - engine returned: ${result.message}`);
        failed++;
        return;
      }
      if (result.provider !== 'openrouter') {
        console.log(`[${sampleName}] FAIL - expected provider 'openrouter', got '${result.provider}'`);
        failed++;
        return;
      }

      assert.deepStrictEqual(result.data, expected);
      console.log(`[${sampleName}] PASS`);
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
