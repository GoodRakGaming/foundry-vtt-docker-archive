'use strict';
const { run } = require('../lib/exec');
const { getInstance, serviceName } = require('./_common');
const { OpError } = require('../lib/errors');
const config = require('../config');

const FIXED_TARGETS = new Set(['nginx-access', 'nginx-error', 'helper']);
const FOUNDRY_TARGET_RE = /^foundry-(v[0-9]+)$/;

// admin-socket only, read-only. `target` is a request field but is only
// ever compared against a fixed set / re-validated against the registry —
// never interpolated into a shell string.
async function readLogs(params, db) {
  const target = params.target;

  if (target === 'nginx-access') {
    return (await run('tail', ['-n', '200', '/var/log/nginx/access.log'])).stdout;
  }
  if (target === 'nginx-error') {
    return (await run('tail', ['-n', '200', '/var/log/nginx/error.log'])).stdout;
  }
  if (target === 'helper') {
    return (await run('journalctl', ['-u', 'foundry-helper.service', '-n', '200', '--no-pager'])).stdout;
  }

  const m = FOUNDRY_TARGET_RE.exec(target || '');
  if (m) {
    getInstance(db, m[1]); // throws if not a real, registered instance
    return (await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'logs', '--tail=200', serviceName(m[1])])).stdout;
  }

  throw new OpError(`неизвестный источник логов '${target}'`);
}

module.exports = readLogs;
