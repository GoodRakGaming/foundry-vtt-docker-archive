'use strict';
const fs = require('fs');
const { run, runWithProgress } = require('../lib/exec');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const ratelimit = require('../lib/ratelimit');
const jobs = require('../lib/jobs');
const { isEmptyForGuardB } = require('../lib/guardB');
const { usedBytes, requireFreeSpace } = require('../lib/diskspace');
const config = require('../config');

// Async sibling of copy-volume: does the Guard B / rate-limit checks
// synchronously (so bad calls fail immediately, same as before), then
// returns a jobId instead of blocking the socket for the whole transfer.
// The actual rsync runs in the helper's own event loop — closing the
// caller's connection doesn't stop it. Poll progress with `job-status`.
async function copyVolumeJob(params, db) {
  const src = getInstance(db, params.src);
  const dst = getInstance(db, params.dst);

  if (!isEmptyForGuardB(dst.data_path)) {
    throw new OpError(`назначение data/${dst.name} не пустое (уже есть миры/системы/модули) — отказываю, чтобы не затереть существующие данные (Guard B)`);
  }

  // Full-volume copy can be many GB — the fixed safety floor other copy
  // ops use isn't enough on its own, so measure the actual source size and
  // require headroom proportional to it (dst is already known ~empty from
  // Guard B above, so this is close to the real net disk usage this
  // operation will add).
  const srcSize = usedBytes(src.data_path);
  requireFreeSpace(config.DATA_DIR, Math.max(srcSize * config.FULL_COPY_SPACE_MARGIN, config.MIN_FREE_BYTES_SAFETY), 'полной миграции тома');

  ratelimit.check('copy-volume', config.RATE_LIMIT_MS['copy-volume']);
  fs.mkdirSync(dst.data_path, { recursive: true });

  const jobId = jobs.createJob('copy-volume', { src: src.name, dst: dst.name });

  (async () => {
    try {
      jobs.updateJob(jobId, { message: 'копирование' });
      await runWithProgress(
        'rsync',
        // --no-inc-recursive: without it rsync's incremental directory scan
        // keeps growing the "total" denominator as it discovers more files
        // mid-transfer, so the percentage can visibly drop (observed:
        // 95% -> 63% partway through a real migration). Building the full
        // file list upfront costs a little startup time but keeps progress
        // monotonic.
        ['-a', '--no-inc-recursive', '--info=progress2', src.data_path + '/', dst.data_path + '/'],
        (progress) => jobs.updateJob(jobId, { progress }),
        { timeout: config.LONG_IO_TIMEOUT_MS }
      );
      jobs.updateJob(jobId, { progress: 99, message: 'выставляю права' });
      await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dst.data_path], { timeout: config.LONG_IO_TIMEOUT_MS });
      jobs.updateJob(jobId, { status: 'done', progress: 100, message: 'готово', finishedAt: Date.now() });
    } catch (e) {
      // A failed rsync leaves a partial dst — clean it back to empty so
      // Guard B doesn't permanently block a retry after a transient error.
      try {
        fs.rmSync(dst.data_path, { recursive: true, force: true });
        fs.mkdirSync(dst.data_path, { recursive: true });
      } catch { /* best-effort cleanup, the error below is what matters */ }
      jobs.updateJob(jobId, { status: 'error', error: e.message, finishedAt: Date.now() });
    }
  })();

  return { jobId, src: src.name, dst: dst.name };
}

module.exports = copyVolumeJob;
