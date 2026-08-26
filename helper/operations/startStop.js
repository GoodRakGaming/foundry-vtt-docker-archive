'use strict';
const { run } = require('../lib/exec');
const { checkPortOpen } = require('../lib/net');
const { getInstance, serviceName } = require('./_common');
const { OpError } = require('../lib/errors');
const config = require('../config');

// `docker compose up` only confirms the container was created/started —
// not that Foundry initialized successfully inside it. A crash-looping
// container also makes that command exit 0, which is exactly what
// happened with v14 (EACCES on Data/systems): the helper kept reporting
// "started" while the container silently restarted forever. So after
// `up`, actually wait for the app to answer on its port before calling it
// a success, and surface real diagnostics (container status + tail of its
// logs) if it never does.
const START_HEALTH_TIMEOUT_MS = 30000;
const START_HEALTH_POLL_MS = 1500;

async function waitForHealthy(port, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await checkPortOpen('127.0.0.1', port, 1000)) return true;
    await new Promise((resolve) => setTimeout(resolve, START_HEALTH_POLL_MS));
  }
  return false;
}

async function start(params, db) {
  const inst = getInstance(db, params.name);
  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'up', serviceName(inst.name), '-d', '--no-recreate'], { timeout: config.DOCKER_PULL_TIMEOUT_MS });

  const healthy = await waitForHealthy(inst.port, START_HEALTH_TIMEOUT_MS);
  if (!healthy) {
    let detail = '';
    try {
      const status = await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'ps', serviceName(inst.name)]);
      const logs = await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'logs', '--tail=15', serviceName(inst.name)]);
      detail = `\n\nСтатус контейнера:\n${status.stdout.trim()}\n\nПоследние строки лога:\n${logs.stdout.trim()}`;
    } catch {
      // best-effort diagnostics only — a failure here must not mask the
      // real "didn't come up" error above
    }
    throw new OpError(`${inst.name} не отвечает на порту ${inst.port} спустя ${START_HEALTH_TIMEOUT_MS / 1000}с после запуска — падает само приложение, это не проблема панели.${detail}`);
  }

  return { name: inst.name };
}

async function stop(params, db) {
  // Intentionally does not block stopping the active version — that guard
  // lives in the DM-panel UI as a confirmation prompt, not here. The
  // helper only refuses the truly destructive combination (delete active),
  // see delete.js.
  const inst = getInstance(db, params.name);
  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'stop', serviceName(inst.name)]);
  return { name: inst.name };
}

// Foundry only scans Data/worlds, Data/systems, Data/modules once, at
// process startup — it does not watch the filesystem. An instance that's
// been running since `deploy` (which is every instance: deploy() starts
// the container as its last step) will NOT notice new content dropped
// into its Data/ tree by a later copy-world / copy-modules / full-volume
// migration until the Foundry process itself is actually relaunched.
// `start`'s `--no-recreate` is deliberately a no-op on an already-running
// container (that's what makes it safe to call opportunistically), so it
// cannot be used for this — use `restart` instead, which unconditionally
// stops and starts the container regardless of its current state.
async function restart(params, db) {
  const inst = getInstance(db, params.name);
  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'restart', serviceName(inst.name)], { timeout: config.DOCKER_PULL_TIMEOUT_MS });

  const healthy = await waitForHealthy(inst.port, START_HEALTH_TIMEOUT_MS);
  if (!healthy) {
    let detail = '';
    try {
      const status = await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'ps', serviceName(inst.name)]);
      const logs = await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'logs', '--tail=15', serviceName(inst.name)]);
      detail = `\n\nСтатус контейнера:\n${status.stdout.trim()}\n\nПоследние строки лога:\n${logs.stdout.trim()}`;
    } catch {
      // best-effort diagnostics only
    }
    throw new OpError(`${inst.name} не поднялся после перезапуска (порт ${inst.port} не отвечает спустя ${START_HEALTH_TIMEOUT_MS / 1000}с).${detail}`);
  }

  return { name: inst.name };
}

module.exports = { start, stop, restart };
