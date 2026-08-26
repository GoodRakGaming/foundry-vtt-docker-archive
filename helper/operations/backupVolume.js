'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../lib/exec');
const { getInstance } = require('./_common');
const ratelimit = require('../lib/ratelimit');
const { requireFreeSpace } = require('../lib/diskspace');
const { pruneOldFiles, timestamp } = require('../db');
const config = require('../config');

async function backupVolume(params, db) {
  const inst = getInstance(db, params.name);

  ratelimit.check('backup-volume', config.RATE_LIMIT_MS['backup-volume']);

  fs.mkdirSync(config.VOLUME_BACKUPS_DIR, { recursive: true });
  requireFreeSpace(config.VOLUME_BACKUPS_DIR, config.MIN_FREE_BYTES_SAFETY, 'бэкапа');

  const dest = path.join(config.VOLUME_BACKUPS_DIR, `${inst.name}_${timestamp()}.tar.gz`);
  await run('tar', ['-czf', dest, '-C', path.dirname(inst.data_path), path.basename(inst.data_path)], { timeout: config.LONG_IO_TIMEOUT_MS });

  pruneOldFiles(config.VOLUME_BACKUPS_DIR, `${inst.name}_`, config.VOLUME_BACKUP_RETENTION);

  return { name: inst.name, file: dest };
}

module.exports = backupVolume;
