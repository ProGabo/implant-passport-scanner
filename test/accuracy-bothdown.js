const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ScanEngine = require('../src/ScanEngine.js');

const TEST_DIR = __dirname;
const MANIFEST_PATH = path.join(TEST_DIR, 'fixtures', 'MANIFEST.json');
const GRACEFUL_MESSAGE = 'Límite alcanzado por hoy. Inténtelo de nuevo mañana.';

/**
 * Fails both providers with zero real network calls (deterministic, safe to run anytime,
 * costs nothing). Proves the "both exhausted" path fails gracefully instead of crashing
 * or silently doing nothing, and that no fallback ever reaches a real (paid-risk) call.
 */
function bothDownHttpFetch() {
  return { status: 429, text: '{"error":{"message":"simulated quota exceeded"}}' };
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('No test/fixtures/MANIFEST.json found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const sampleNames = Object.keys(manifest).sort();

  console.log(`Running both-providers-down test for ${sampleNames.length} sample(s). Zero real network calls.\n`);

  let passed = 0;
  let failed = 0;

  sampleNames.forEach((sampleName) => {
    const filename = manifest[sampleName];
    const filePath = path.join(TEST_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`[${sampleName}] SKIP - missing PDF`);
      return;
    }

    const base64Data = fs.readFileSync(filePath).toString('base64');

    try {
      const result = ScanEngine.scanPassport(base64Data, 'application/pdf', {
        httpFetch: bothDownHttpFetch,
        geminiApiKey: 'unused-both-down',
        openRouterApiKey: 'unused-both-down'
      });

      assert.equal(result.ok, false);
      assert.equal(result.message, GRACEFUL_MESSAGE);
      console.log(`[${sampleName}] PASS - graceful failure returned`);
      passed++;
    } catch (e) {
      console.log(`[${sampleName}] FAIL - threw instead of failing gracefully: ${e.message}`);
      failed++;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
