'use strict';
const { getActiveVersion } = require('./_common');

async function getState(params, db) {
  return { active: getActiveVersion(db) };
}

module.exports = getState;
