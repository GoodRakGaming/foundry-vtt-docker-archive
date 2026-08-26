'use strict';
const config = require('../config');
const { OpError } = require('./errors');

const NAME_RE = /^v[0-9]+$/;

// deploy is the one operation where name/port/node arrive fresh from a
// request instead of the registry — everything downstream (paths, docker
// service names) is built from these, so this is the path-traversal /
// command-injection choke point (spec 3b rule 2).
function validateName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new OpError(`недопустимое имя инстанса '${name}' — должно соответствовать ^v[0-9]+$`);
  }
  return name;
}

function validatePort(port, db) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < config.PORT_MIN || p > config.PORT_MAX) {
    throw new OpError(`порт должен быть целым числом в диапазоне [${config.PORT_MIN}, ${config.PORT_MAX}]`);
  }
  const existing = db.prepare('SELECT name FROM instances WHERE port = ?').get(p);
  if (existing) {
    throw new OpError(`порт ${p} уже занят инстансом '${existing.name}'`);
  }
  return p;
}

function validateNodeImage(image) {
  if (!config.NODE_ALLOWLIST.includes(image)) {
    throw new OpError(`образ node '${image}' не в белом списке: ${config.NODE_ALLOWLIST.join(', ')}`);
  }
  return image;
}

module.exports = { validateName, validatePort, validateNodeImage, NAME_RE };
