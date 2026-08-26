'use strict';
const { checkPortOpen } = require('../lib/net');
const { getInstance } = require('./_common');
const config = require('../config');

async function health(params, db) {
  const inst = getInstance(db, params.name);
  const alive = await checkPortOpen('127.0.0.1', inst.port, config.HEALTH_TIMEOUT_MS);
  return { name: inst.name, port: inst.port, alive };
}

module.exports = health;
