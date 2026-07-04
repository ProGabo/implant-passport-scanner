const { execFileSync } = require('node:child_process');

/**
 * Synchronous httpFetch backed by `curl`, matching the same synchronous contract
 * ScanEngine's providers use in GAS via UrlFetchApp. Node has no built-in synchronous
 * fetch, and the engine's provider call must stay synchronous (it also runs inside
 * Apps Script's processImplantFile, called via google.script.run, which is not reliably
 * async-safe) - curl ships with Windows 11 by default.
 */
function curlHttpFetch(url, options) {
  const args = ['-s', '-S', '--max-time', '60', '-w', '\n%{http_code}', url];

  if (options.method && options.method.toLowerCase() === 'post') {
    args.push('-X', 'POST');
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push('-H', `${key}: ${value}`);
    }
  }
  if (options.body !== undefined) {
    args.push('--data-binary', '@-');
  }

  const result = execFileSync('curl', args, {
    input: options.body,
    maxBuffer: 1024 * 1024 * 25,
    encoding: 'utf8'
  });

  const splitIndex = result.lastIndexOf('\n');
  return {
    status: parseInt(result.slice(splitIndex + 1), 10),
    text: result.slice(0, splitIndex)
  };
}

module.exports = { curlHttpFetch };
