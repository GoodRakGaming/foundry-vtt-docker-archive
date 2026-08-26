'use strict';
const fs = require('fs');
const { run } = require('../lib/exec');
const { checkPortOpen } = require('../lib/net');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');
const config = require('../config');

function renderConf(port) {
  return `# managed by foundry-helper — generated from registry.sqlite, do not edit by hand\nupstream foundry_active {\n    server 127.0.0.1:${port};\n}\n`;
}

async function applyUpstream(params, db) {
  const inst = getInstance(db, params.name);

  // Health-gate: refuse to switch traffic onto something that isn't
  // listening. Silently reloading nginx onto a dead port would mean 502s
  // for every player instead of a clear error here (spec 3b rule 4).
  const alive = await checkPortOpen('127.0.0.1', inst.port, config.HEALTH_TIMEOUT_MS);
  if (!alive) {
    throw new OpError(`инстанс '${inst.name}' не отвечает на порту ${inst.port} — отказываюсь переключать на него трафик`);
  }

  const tmpPath = config.ACTIVE_CONF_PATH + '.tmp';
  fs.writeFileSync(tmpPath, renderConf(inst.port));
  fs.renameSync(tmpPath, config.ACTIVE_CONF_PATH);

  try {
    await run('nginx', ['-t']);
  } catch (e) {
    throw new OpError(`nginx -t не прошёл после записи нового upstream — reload НЕ выполнен, активная версия не изменена: ${e.stderr || e.message}`);
  }

  await run('nginx', ['-s', 'reload']);

  db.prepare(
    `INSERT INTO state (key, value) VALUES ('active_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(inst.name);

  return { active: inst.name, port: inst.port };
}

module.exports = applyUpstream;
