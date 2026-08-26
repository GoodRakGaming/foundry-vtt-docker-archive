'use strict';
const fs = require('fs');
const { run } = require('../lib/exec');
const { getInstance, getActiveVersion, serviceName } = require('./_common');
const { OpError } = require('../lib/errors');
const compose = require('../lib/compose');
const config = require('../config');

// admin-socket only. Guard C: refusing to delete the active version is
// what stops a compromised/buggy caller from leaving foundry-active.conf
// pointing at a container that no longer exists (spec 3b rule 6).
async function deleteInstance(params, db) {
  const inst = getInstance(db, params.name);
  const active = getActiveVersion(db);
  if (inst.name === active) {
    throw new OpError(`'${inst.name}' — активная версия, сначала переключитесь на другую, потом удаляйте`);
  }

  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'stop', serviceName(inst.name)]).catch(() => {});
  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'rm', '-f', serviceName(inst.name)]).catch(() => {});
  compose.removeService(inst.name);

  db.prepare('DELETE FROM instances WHERE name = ?').run(inst.name);

  let dataRemoved = false;
  if (params.withData === true) {
    fs.rmSync(inst.data_path, { recursive: true, force: true });
    fs.rmSync(inst.app_path, { recursive: true, force: true });
    dataRemoved = true;
  }

  return { name: inst.name, dataRemoved };
}

module.exports = deleteInstance;
