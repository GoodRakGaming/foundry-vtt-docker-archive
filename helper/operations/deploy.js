'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../lib/exec');
const { extractZip } = require('../lib/zipslip');
const { validateName, validatePort, validateNodeImage } = require('../lib/validate');
const { getInstanceOrNull, serviceName } = require('./_common');
const { OpError } = require('../lib/errors');
const { requireFreeSpace } = require('../lib/diskspace');
const compose = require('../lib/compose');
const config = require('../config');

// admin-socket only. name/port/node are untrusted request input — this is
// the one operation where paths get built from a request instead of the
// registry, so every field is validated BEFORE it touches the filesystem
// (spec 3b rule 2). Do not relax this to "trust the panel already checked."
async function deploy(params, db) {
  const name = validateName(params.name);
  if (getInstanceOrNull(db, name)) {
    throw new OpError(`инстанс '${name}' уже зарегистрирован`);
  }
  const port = validatePort(params.port, db);
  const nodeImage = validateNodeImage(params.nodeImage);

  if (typeof params.archivePath !== 'string' || !fs.existsSync(params.archivePath)) {
    throw new OpError('архив не найден');
  }

  const appPath = path.join(config.APPS_DIR, name);
  const dataPath = path.join(config.DATA_DIR, name);
  if (fs.existsSync(appPath) || fs.existsSync(dataPath)) {
    throw new OpError(`путь для '${name}' уже существует на диске`);
  }

  requireFreeSpace(config.APPS_DIR, config.MIN_FREE_BYTES_SAFETY, 'развёртывания архива');

  fs.mkdirSync(appPath, { recursive: true });
  let extractResult;
  try {
    extractResult = await extractZip(params.archivePath, appPath);
  } catch (e) {
    fs.rmSync(appPath, { recursive: true, force: true });
    throw e;
  }
  if (!extractResult.foundMainJs) {
    fs.rmSync(appPath, { recursive: true, force: true });
    throw new OpError('в архиве нет resources/app/main.js — это не похоже на сборку Foundry, отказываюсь регистрировать');
  }

  // Foundry's own built-in updater writes to its install directory in
  // place (extracted archive currently owned by root, since the helper
  // itself runs as root) — the app volume is mounted rw (see compose.js)
  // specifically so that self-update path works, which only helps if the
  // container's own user (CONTAINER_UID) actually owns these files.
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, appPath]);

  fs.mkdirSync(dataPath, { recursive: true });
  // Foundry creates its own subtree under dataPath/Data on first start
  // (Data/systems, Data/worlds, Data/modules, ...). But Data/ is also the
  // parent of every shared-assets bind-mount point (see compose.js
  // sharedAssetMounts), so if it doesn't already exist when `docker
  // compose up` runs below, the docker daemon auto-creates it itself —
  // as root, since dockerd runs as root — before Foundry (running as
  // CONTAINER_UID, non-root) ever gets a chance to. Foundry then hits
  // EACCES the moment it tries to mkdir a subdirectory inside it. Found
  // this the hard way on v14 (Фаза 13) — pre-create it ourselves with the
  // right owner so docker has nothing left to auto-vivify.
  fs.mkdirSync(path.join(dataPath, 'Data'), { recursive: true });
  await run('chown', ['-R', `${config.CONTAINER_UID}:${config.CONTAINER_GID}`, dataPath]);
  await run('chmod', ['2770', path.join(dataPath, 'Data')]);

  compose.addService(name, port, nodeImage);
  // Address the new service explicitly so this never touches any other
  // running container (spec risk table: "compose up обрывает активную игру").
  // Long timeout: this may need to pull the node image fresh, which can
  // take minutes on a slow link — a short timeout here silently kills the
  // pull without the compose CLI ever reporting success or failure.
  await run('docker', ['compose', '-f', config.COMPOSE_FILE, 'up', serviceName(name), '-d', '--no-recreate'], { timeout: config.DOCKER_PULL_TIMEOUT_MS });

  db.prepare(
    `INSERT INTO instances (name, app_path, data_path, port, node_image, status, created_at, upgrade_blocked)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 0)`
  ).run(name, appPath, dataPath, port, nodeImage, Date.now());

  return { name, port, appPath, dataPath };
}

module.exports = deploy;
