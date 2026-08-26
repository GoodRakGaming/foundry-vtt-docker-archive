'use strict';
const { OpError } = require('../lib/errors');
const { serviceName } = require('../lib/compose');

function getInstance(db, name) {
  const inst = db.prepare('SELECT * FROM instances WHERE name = ?').get(name);
  if (!inst) throw new OpError(`неизвестный инстанс '${name}'`);
  return inst;
}

function getInstanceOrNull(db, name) {
  return db.prepare('SELECT * FROM instances WHERE name = ?').get(name) || null;
}

function getActiveVersion(db) {
  const row = db.prepare("SELECT value FROM state WHERE key = 'active_version'").get();
  return row ? row.value : null;
}

module.exports = { getInstance, getInstanceOrNull, getActiveVersion, serviceName };
