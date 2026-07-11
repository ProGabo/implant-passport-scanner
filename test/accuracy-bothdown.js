const fs = require('node:fs');
const assert = require('node:assert/strict');
const ScanEngine = require('../src/ScanEngine.js');
const { loadSamples } = require('./sampleSets.js');
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
  const samples = loadSamples();
  if (samples.length === 0) {
    console.error('No samples found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  console.log(`Running both-providers-down test for ${samples.length} sample(s). Zero real network calls.\n`);

  let passed = 0;
  let failed = 0;

  samples.forEach(({ name: sampleName, pdfPath: filePath }) => {
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
