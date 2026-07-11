const fs = require('node:fs');
const ScanEngine = require('../src/ScanEngine.js');
const { curlHttpFetch } = require('./httpFetchSync.js');
const { compareToGolden } = require('./compareGolden.js');
const { loadSamples } = require('./sampleSets.js');

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
  const samples = loadSamples();
  if (samples.length === 0) {
    console.error('No samples found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  console.log(`Running fallback accuracy test (Gemini forced down) against LIVE OpenRouter for ${samples.length} sample(s).`);
  console.log(`Gemini calls are simulated (no network); OpenRouter calls use ${ScanEngine.OPENROUTER_MODEL} (paid, ~$0.001/sample, prepaid credits).\n`);

  let passed = 0;
  let failed = 0;

  samples.forEach(({ name: sampleName, pdfPath: filePath, goldenPath }) => {
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
