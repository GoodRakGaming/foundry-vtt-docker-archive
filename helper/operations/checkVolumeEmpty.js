'use strict';
const { getInstance } = require('./_common');
const { isEmptyForGuardB } = require('../lib/guardB');

// Read-only. Lets the admin panel check Guard B's condition (copy-volume's
// "destination must be empty" rule) BEFORE backing up and stopping the
// source instance — otherwise a doomed full-volume upgrade stops the
// active version for nothing and leaves it down until someone notices.
async function checkVolumeEmpty(params, db) {
  const inst = getInstance(db, params.name);
  const empty = isEmptyForGuardB(inst.data_path);
  return { name: inst.name, empty };
}

module.exports = checkVolumeEmpty;
