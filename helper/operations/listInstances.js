'use strict';

// Read-only, both sockets. Panels display instance lists through this
// instead of mounting registry.sqlite themselves — avoids the WAL-mode
// read-only-bind-mount fragility across containers, and means a panel has
// literally no filesystem access to the DB at all, not even read-only.
async function listInstances(params, db) {
  const rows = db
    .prepare('SELECT name, port, node_image, status, created_at, upgrade_blocked FROM instances ORDER BY name')
    .all();
  return { instances: rows };
}

module.exports = listInstances;
