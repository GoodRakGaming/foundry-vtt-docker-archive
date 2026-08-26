'use strict';
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { OpError } = require('./errors');

// Rejects absolute paths and any '..' path segment BEFORE joining, then
// re-checks the resolved result still lives under destDir. Checking main.js
// presence after extraction is not a security control — this is (spec 3b
// rule 3): a malicious entry could otherwise land anywhere on disk with
// root's privileges before we ever look at what got extracted.
function safeJoin(destDir, entryName) {
  if (path.isAbsolute(entryName)) {
    throw new OpError(`zip-slip: абсолютный путь в записи архива '${entryName}'`);
  }
  const normalized = path.normalize(entryName);
  if (normalized.split(path.sep).includes('..')) {
    throw new OpError(`zip-slip: выход за пределы через '..' в записи архива '${entryName}'`);
  }
  const resolvedBase = path.resolve(destDir) + path.sep;
  const target = path.join(destDir, normalized);
  if (!path.resolve(target).startsWith(resolvedBase)) {
    throw new OpError(`zip-slip: запись '${entryName}' выходит за пределы папки назначения`);
  }
  return target;
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    let foundMainJs = false;
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.on('error', reject);
      zipfile.on('end', () => resolve({ foundMainJs }));

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        let target;
        try {
          target = safeJoin(destDir, entry.fileName);
        } catch (e) {
          zipfile.close();
          return reject(e);
        }

        const isDir = /\/$/.test(entry.fileName);
        if (isDir) {
          fs.mkdirSync(target, { recursive: true });
          return zipfile.readEntry();
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) {
            zipfile.close();
            return reject(err);
          }
          const ws = fs.createWriteStream(target);
          readStream.pipe(ws);
          ws.on('finish', () => {
            if (entry.fileName.replace(/\\/g, '/').endsWith('resources/app/main.js')) {
              foundMainJs = true;
            }
            zipfile.readEntry();
          });
          ws.on('error', (e) => {
            zipfile.close();
            reject(e);
          });
        });
      });
    });
  });
}

module.exports = { extractZip, safeJoin };
