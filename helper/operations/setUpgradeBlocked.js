'use strict';
const { getInstance } = require('./_common');

// admin-socket only. No filesystem/docker side effect — just a registry
// flag — but still routed through the helper rather than writing SQLite
// from the panel, so "only the helper writes the registry" stays true
// without exceptions (spec 3a).
async function setUpgradeBlocked(params, db) {
  const inst = getInstance(db, params.name);
  const blocked = params.blocked ? 1 : 0;
  db.prepare('UPDATE instances SET upgrade_blocked = ? WHERE name = ?').run(blocked, inst.name);
  return { name: inst.name, upgrade_blocked: !!blocked };
}

module.exports = setUpgradeBlocked;
