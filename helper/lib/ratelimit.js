'use strict';
const { OpError } = require('./errors');

const last = new Map();

function check(key, minIntervalMs) {
  const now = Date.now();
  const prev = last.get(key);
  if (prev && now - prev < minIntervalMs) {
    const waitSec = Math.ceil((minIntervalMs - (now - prev)) / 1000);
    throw new OpError(`слишком часто: '${key}' — попробуйте через ${waitSec}с`);
  }
  last.set(key, now);
}

module.exports = { check };
