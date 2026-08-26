'use strict';
const fs = require('fs');
const path = require('path');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const ratelimit = require('../lib/ratelimit');
const { copyPackageDir } = require('../lib/pkgcopy');
const { usedBytes, requireFreeSpace } = require('../lib/diskspace');
const config = require('../config');

// Bulk "copy if missing" for every module directory from src to dst — for
// preparing a target version to run a world that depends on many modules,
// instead of one copy-system-style call per module. Version compatibility
// is NOT checked here (same stance as copy-system): Foundry itself flags
// incompatible modules in Setup, the human decides whether to update or
// remove them there. Sequential, not parallel — this is a rare, human-
// triggered operation, not a hot path; parallel `cp`s would just contend
// for the same disk.
async function copyModules(params, db) {
  const src = getInstance(db, params.src);
  const dst = getInstance(db, params.dst);

  const srcModulesDir = path.join(src.data_path, 'Data', 'modules');
  const dstModulesDir = path.join(dst.data_path, 'Data', 'modules');
  if (!fs.existsSync(srcModulesDir)) {
    throw new OpError(`нет папки Data/modules в ${src.name}`);
  }

  const names = fs.readdirSync(srcModulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  ratelimit.check('copy-modules', config.RATE_LIMIT_MS['copy-volume']);

  // Bulk copy can be many modules' worth of assets — sum only the ones
  // actually missing in dst (copyPackageDir skips the rest) rather than
  // assuming the fixed safety floor covers it.
  const missingSize = names
    .filter((name) => !fs.existsSync(path.join(dstModulesDir, name)))
    .reduce((sum, name) => sum + usedBytes(path.join(srcModulesDir, name)), 0);
  requireFreeSpace(dst.data_path, Math.max(missingSize * config.FULL_COPY_SPACE_MARGIN, config.MIN_FREE_BYTES_SAFETY), 'копирования модулей');

  const results = [];
  for (const name of names) {
    results.push(await copyPackageDir(srcModulesDir, dstModulesDir, name));
  }

  return {
    src: src.name,
    dst: dst.name,
    total: names.length,
    copied: results.filter((r) => r.copied).length,
    skipped: results.filter((r) => !r.copied).length,
    details: results,
  };
}

module.exports = copyModules;
