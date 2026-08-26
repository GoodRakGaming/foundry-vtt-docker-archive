'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../lib/exec');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const ratelimit = require('../lib/ratelimit');
const { requireFreeSpace } = require('../lib/diskspace');
const config = require('../config');

const WORLD_NAME_RE = /^[a-zA-Z0-9_-]+$/;

// Copies exactly one world directory between two instances' data volumes,
// instead of the whole volume (copy-volume). Used for Upgrade when the
// destination instance's data/ already has its own state (license, admin
// password) that copy-volume's "dst must be empty" guard would otherwise
// force you to wipe. Same safety shape as copy-volume: refuse to overwrite
// an existing destination world, chown after copy.
async function copyWorld(params, db) {
  const src = getInstance(db, params.src);
  const dst = getInstance(db, params.dst);

  const worldName = params.worldName;
  if (typeof worldName !== 'string' || !WORLD_NAME_RE.test(worldName)) {
    throw new OpError(`недопустимое имя мира '${worldName}'`);
  }

  const srcWorldDir = path.join(src.data_path, 'Data', 'worlds', worldName);
  const dstWorldsDir = path.join(dst.data_path, 'Data', 'worlds');
  const dstWorldDir = path.join(dstWorldsDir, worldName);

  if (!fs.existsSync(srcWorldDir)) {
    throw new OpError(`мир '${worldName}' не существует в ${src.name} (${srcWorldDir})`);
  }
  // Idempotent, not an error: "copy if missing" is the whole point of this
  // op, so a repeated call (e.g. as part of copy-world-with-system after a
  // partial run) must not fail just because the world already made it over.
  // We still never overwrite — this is a skip, not a merge.
  if (fs.existsSync(dstWorldDir)) {
    return { src: src.name, dst: dst.name, worldName, copied: false, reason: 'already present' };
  }

  ratelimit.check('copy-world', config.RATE_LIMIT_MS['copy-volume']);
  requireFreeSpace(dst.data_path, config.MIN_FREE_BYTES_SAFETY, 'копирования мира');

  fs.mkdirSync(dstWorldsDir, { recursive: true });
  // No trailing '/.' on the source here on purpose — unlike copy-volume,
  // we want the named subdirectory itself created under dst/worlds/, not
  // its contents merged into an existing one.
  await run('cp', ['-a', srcWorldDir, dstWorldsDir + '/'], { timeout: config.LONG_IO_TIMEOUT_MS });
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dstWorldDir], { timeout: config.LONG_IO_TIMEOUT_MS });

  return { src: src.name, dst: dst.name, worldName, copied: true };
}

module.exports = copyWorld;
