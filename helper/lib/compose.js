'use strict';
const fs = require('fs');
const YAML = require('yaml');
const config = require('../config');

function serviceName(instanceName) {
  return `foundry-${instanceName}`;
}

function loadDoc() {
  const text = fs.readFileSync(config.COMPOSE_FILE, 'utf8');
  return YAML.parseDocument(text);
}

function writeDoc(doc) {
  const tmp = config.COMPOSE_FILE + '.tmp';
  fs.writeFileSync(tmp, doc.toString());
  fs.renameSync(tmp, config.COMPOSE_FILE);
}

// Shared user assets (maps, tokens, music, ...) are mounted into every
// Foundry version under the SAME path they had before the split
// (Data/<name>), so no scene/actor path inside any world ever changes.
// worlds/systems/modules stay per-version — sharing those would let a v14
// system update break v13 mid-campaign (see spec / Фаза 8 notes).
// Long mount syntax because several folder names contain spaces/Cyrillic.
function sharedAssetMounts() {
  if (!fs.existsSync(config.SHARED_ASSETS_DIR)) return [];
  return fs.readdirSync(config.SHARED_ASSETS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      type: 'bind',
      source: `${config.SHARED_ASSETS_DIR}/${e.name}`,
      target: `/data/Data/${e.name}`,
    }));
}

// name/port/nodeImage are already validated (^v[0-9]+$, allowlisted image,
// registry-checked port) by the caller before this ever runs — this
// function does not re-validate, it only shapes the YAML.
function addService(name, port, nodeImage) {
  const doc = loadDoc();
  const svc = serviceName(name);
  doc.setIn(['services', svc], {
    image: nodeImage,
    restart: 'unless-stopped',
    user: `${config.CONTAINER_UID}:${config.CONTAINER_GID}`,
    working_dir: '/app',
    command: ['node', 'resources/app/main.js', '--dataPath=/data', `--port=${port}`],
    volumes: [
      // rw, deliberately: Foundry's own built-in updater writes to its
      // install directory in place, and the user wants that to always
      // work rather than routing every point-release bump through a new
      // admin-panel deploy. This does mean app files can now change
      // outside the validated deploy flow — accepted tradeoff, decided
      // 2026-08-25 (see status.md Фаза 19).
      `${config.APPS_DIR}/${name}:/app:rw`,
      `${config.DATA_DIR}/${name}:/data:rw`,
      ...sharedAssetMounts(),
    ],
    ports: [`127.0.0.1:${port}:${port}`],
    environment: ['NODE_ENV=production'],
  });
  writeDoc(doc);
}

// Re-applies the current shared-assets mount set to an EXISTING service
// (used when the shared-assets catalog itself changes). Rebuilds only the
// volumes list, from the same inputs addService would use.
function refreshServiceMounts(name, port) {
  const doc = loadDoc();
  const svc = serviceName(name);
  if (!doc.getIn(['services', svc])) throw new Error(`сервис ${svc} не найден в compose-файле`);
  doc.setIn(['services', svc, 'volumes'], doc.createNode([
    `${config.APPS_DIR}/${name}:/app:rw`,
    `${config.DATA_DIR}/${name}:/data:rw`,
    ...sharedAssetMounts(),
  ]));
  writeDoc(doc);
}

function removeService(name) {
  const doc = loadDoc();
  doc.deleteIn(['services', serviceName(name)]);
  writeDoc(doc);
}

module.exports = { serviceName, addService, removeService, refreshServiceMounts, sharedAssetMounts };
