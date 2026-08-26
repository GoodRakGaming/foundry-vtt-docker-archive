'use strict';
const yauzl = require('yauzl');

// Cheap pre-check before ever calling the helper: does this look like a
// Foundry build at all, and does it contain any entry that would be a
// zip-slip attempt. This is a UX filter, NOT the security boundary — the
// helper re-validates independently on extraction (see helper/lib/zipslip.js),
// because this panel container is the less-trusted side of that boundary.
function validateArchive(zipPath) {
  return new Promise((resolve, reject) => {
    let foundMainJs = false;
    const suspicious = [];

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.on('error', reject);
      zipfile.on('end', () => {
        resolve({ valid: foundMainJs && suspicious.length === 0, foundMainJs, suspicious });
      });

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        if (name.startsWith('/') || name.split('/').includes('..')) {
          suspicious.push(name);
        }
        if (name.endsWith('resources/app/main.js')) {
          foundMainJs = true;
        }
        zipfile.readEntry();
      });
    });
  });
}

module.exports = { validateArchive };
