'use strict';
const { execFile, spawn } = require('child_process');

// The only way this module runs external commands: fixed binary name +
// argument array, never a shell string. Do not add an exec()/shell:true
// path here — that is the whole command-injection defense (spec 3b rule 1).
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout || 60000, maxBuffer: opts.maxBuffer || 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

// Same command-injection discipline as run() — fixed binary + argument
// array, no shell. Used for long transfers (rsync) where we want a live
// percentage rather than silence until the whole thing finishes. rsync's
// --info=progress2 writes percentage updates separated by \r, not \n, so
// this reads raw stdout chunks and regexes the last "NN%" out of each
// chunk instead of trying to split it into lines.
function runWithProgress(cmd, args, onProgress, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stderr = '';
    let timer = null;

    if (opts.timeout) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${cmd} timed out after ${opts.timeout}ms`));
      }, opts.timeout);
    }

    child.stdout.on('data', (chunk) => {
      const matches = chunk.toString('utf8').match(/(\d{1,3})%/g);
      if (matches && matches.length) {
        const pct = parseInt(matches[matches.length - 1], 10);
        // Cap at 99 — 100 is reserved for confirmed completion (resolve()
        // below), not merely "rsync's last progress line said 100%".
        if (!isNaN(pct)) onProgress(Math.min(pct, 99));
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

module.exports = { run, runWithProgress };
