'use strict';
const fs = require('fs');
const path = require('path');
const { getInstanceOrNull } = require('./_common');
const { validateName, validateNodeImage } = require('../lib/validate');
const { OpError } = require('../lib/errors');
const config = require('../config');

// admin-socket only. For instances whose files were placed on disk
// directly rather than through the `deploy` upload flow (e.g. adopting the
// host's pre-existing install into the registry). Touches nothing on disk
// or in docker — only validates the layout is real and writes the registry
// row, the same shape `deploy` would have written.
async function registerExisting(params, db) {
  const name = validateName(params.name);
  if (getInstanceOrNull(db, name)) {
    throw new OpError(`инстанс '${name}' уже зарегистрирован`);
  }
  const nodeImage = validateNodeImage(params.nodeImage);

  const appPath = path.join(config.APPS_DIR, name);
  const dataPath = path.join(config.DATA_DIR, name);
  const mainJs = path.join(appPath, 'resources', 'app', 'main.js');
  if (!fs.existsSync(mainJs)) {
    throw new OpError(`${mainJs} не найден — apps/${name} не похож на сборку Foundry`);
  }
  if (!fs.existsSync(dataPath)) {
    throw new OpError(`data/${name} не существует`);
  }

  const optPath = path.join(dataPath, 'Config', 'options.json');
  let port;
  try {
    port = JSON.parse(fs.readFileSync(optPath, 'utf8')).port;
  } catch {
    throw new OpError(`не удалось прочитать порт из ${optPath}`);
  }
  if (!Number.isInteger(port) || port < config.PORT_MIN || port > config.PORT_MAX) {
    throw new OpError(`порт ${port} из options.json вне разрешённого диапазона [${config.PORT_MIN}, ${config.PORT_MAX}]`);
  }
  const portTaken = db.prepare('SELECT name FROM instances WHERE port = ?').get(port);
  if (portTaken) {
    throw new OpError(`порт ${port} уже занят инстансом '${portTaken.name}'`);
  }

  db.prepare(
    `INSERT INTO instances (name, app_path, data_path, port, node_image, status, created_at, upgrade_blocked)
     VALUES (?, ?, ?, ?, ?, 'stopped', ?, 0)`
  ).run(name, appPath, dataPath, port, nodeImage, Date.now());

  return { name, port, appPath, dataPath };
}

module.exports = registerExisting;
