'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../lib/exec');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const ratelimit = require('../lib/ratelimit');
const { requireFreeSpace } = require('../lib/diskspace');
const config = require('../config');

const PKG_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Copies one game system directory between instances' data volumes.
// "Copy if missing" — an already-present destination system is success
// with copied:false, not an error, since the caller (copy-world-with-system
// on the DM panel) is meant to call this unconditionally before copying
// the world itself. Does NOT check version compatibility with the target
// Foundry core — that's surfaced separately via get-world-info so the human
// decides, this op only ever does exactly what it's told.
async function copySystem(params, db) {
  const src = getInstance(db, params.src);
  const dst = getInstance(db, params.dst);

  const systemId = params.systemId;
  if (typeof systemId !== 'string' || !PKG_ID_RE.test(systemId)) {
    throw new OpError(`недопустимый id системы '${systemId}'`);
  }

  const srcSystemDir = path.join(src.data_path, 'Data', 'systems', systemId);
  const dstSystemsDir = path.join(dst.data_path, 'Data', 'systems');
  const dstSystemDir = path.join(dstSystemsDir, systemId);

  if (!fs.existsSync(srcSystemDir)) {
    throw new OpError(`система '${systemId}' не найдена в ${src.name} (${srcSystemDir})`);
  }
  if (fs.existsSync(dstSystemDir)) {
    return { src: src.name, dst: dst.name, systemId, copied: false, reason: 'already present' };
  }

  ratelimit.check('copy-system', config.RATE_LIMIT_MS['copy-volume']);
  requireFreeSpace(dst.data_path, config.MIN_FREE_BYTES_SAFETY, 'копирования системы');

  fs.mkdirSync(dstSystemsDir, { recursive: true });
  await run('cp', ['-a', srcSystemDir, dstSystemsDir + '/'], { timeout: config.LONG_IO_TIMEOUT_MS });
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dstSystemDir], { timeout: config.LONG_IO_TIMEOUT_MS });

  return { src: src.name, dst: dst.name, systemId, copied: true };
}

module.exports = copySystem;
