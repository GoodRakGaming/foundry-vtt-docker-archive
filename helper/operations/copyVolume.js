'use strict';
const fs = require('fs');
const { run } = require('../lib/exec');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const ratelimit = require('../lib/ratelimit');
const { isEmptyForGuardB } = require('../lib/guardB');
const { usedBytes, requireFreeSpace } = require('../lib/diskspace');
const config = require('../config');

async function copyVolume(params, db) {
  const src = getInstance(db, params.src);
  const dst = getInstance(db, params.dst);

  if (!isEmptyForGuardB(dst.data_path)) {
    throw new OpError(`назначение data/${dst.name} не пустое (уже есть миры/системы/модули) — отказываю, чтобы не затереть существующие данные (Guard B)`);
  }

  const srcSize = usedBytes(src.data_path);
  requireFreeSpace(config.DATA_DIR, Math.max(srcSize * config.FULL_COPY_SPACE_MARGIN, config.MIN_FREE_BYTES_SAFETY), 'полной миграции тома');

  ratelimit.check('copy-volume', config.RATE_LIMIT_MS['copy-volume']);

  fs.mkdirSync(dst.data_path, { recursive: true });
  // Trailing '/.' on the source copies CONTENTS into dst/, not the
  // directory itself — `cp -a src dst` would produce dst/<src-name>/...
  // instead (spec 3b rule 5).
  await run('cp', ['-a', src.data_path + '/.', dst.data_path + '/'], { timeout: config.LONG_IO_TIMEOUT_MS });
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dst.data_path], { timeout: config.LONG_IO_TIMEOUT_MS });

  return { src: src.name, dst: dst.name };
}

module.exports = copyVolume;
