const fs = require('node:fs');
const ScanEngine = require('../src/ScanEngine.js');
const { curlHttpFetch } = require('./httpFetchSync.js');
const { compareToGolden } = require('./compareGolden.js');
const { loadSamples } = require('./sampleSets.js');
const RecordatoriModel = require('../src/RecordatoriModel.js');

function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set. Add it to .env.');
    process.exit(1);
  }
  // ACCURACY_ONLY=sample-6,private/sample-4: only those (each sample spends daily quota).
  const only = (process.env.ACCURACY_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
  const samples = loadSamples().filter(s => !only.length || only.includes(s.name));
  if (samples.length === 0) {
    console.error('No samples found. Run "npm run generate-fixtures" first.');
    process.exit(1);
  }

  console.log(`Running accuracy test against LIVE Gemini for ${samples.length} sample(s).`);
  console.log('This makes real API calls and uses daily quota.\n');

  let passed = 0;
  let failed = 0;

  samples.forEach(({ name: sampleName, pdfPaths, goldenPath, seguimentPath }) => {
    if (!pdfPaths.every(p => fs.existsSync(p)) || !fs.existsSync(goldenPath)) {
      console.log(`[${sampleName}] SKIP - missing PDF or golden file`);
      return;
    }

    const docs = pdfPaths.map(p => ({ base64Data: fs.readFileSync(p).toString('base64'), mimeType: 'application/pdf' }));
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

    try {
      // Several PDFs of the same patient go in ONE request (S7), like the sidebar does.
      const result = ScanEngine.scanDocuments(docs, {
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
      // P10d: the proposed follow-up (soft: free handwritten text).
      if (fs.existsSync(seguimentPath)) {
        const want = JSON.parse(fs.readFileSync(seguimentPath, 'utf8'));
        const got = RecordatoriModel.proposarSeguiment(result.seguiment, (result.data[0] || {}).fecha_colocacion);
        const ok = want === null ? got === null : !!got && got.n === want.n && got.unitat === want.unitat;
        if (!ok) soft.push(`seguiment: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)} from ${JSON.stringify(result.seguiment)}`);
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
