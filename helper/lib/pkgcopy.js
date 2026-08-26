'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./exec');
const config = require('../config');

// Copies one named subdirectory from srcParentDir/name into dstParentDir/name.
// "Copy if missing" — an existing destination is a skip, not an error, same
// contract as copy-world/copy-system. Shared by copy-system and copy-modules
// so both stay in lockstep on cp semantics and chown.
async function copyPackageDir(srcParentDir, dstParentDir, name) {
  const srcDir = path.join(srcParentDir, name);
  const dstDir = path.join(dstParentDir, name);
  if (!fs.existsSync(srcDir)) return { name, copied: false, reason: 'source missing' };
  if (fs.existsSync(dstDir)) return { name, copied: false, reason: 'already present' };

  fs.mkdirSync(dstParentDir, { recursive: true });
  await run('cp', ['-a', srcDir, dstParentDir + '/'], { timeout: config.LONG_IO_TIMEOUT_MS });
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dstDir], { timeout: config.LONG_IO_TIMEOUT_MS });
  return { name, copied: true };
}

module.exports = { copyPackageDir };
