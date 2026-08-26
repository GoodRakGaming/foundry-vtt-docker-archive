'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

// admin-socket only, read-only. Reports mismatches between the registry and
// what's actually on disk — never changes anything itself (spec 3a: "не
// менять без подтверждения").
async function reconcile(params, db) {
  const registered = db.prepare('SELECT name, app_path, data_path, port FROM instances').all();
  const registeredNames = new Set(registered.map((r) => r.name));

  const listVersionDirs = (dir) =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^v[0-9]+$/.test(n)) : [];

  const issues = [];

  for (const r of registered) {
    if (!fs.existsSync(r.app_path)) issues.push({ type: 'missing_app_dir', instance: r.name, path: r.app_path });
    if (!fs.existsSync(r.data_path)) issues.push({ type: 'missing_data_dir', instance: r.name, path: r.data_path });
  }
  for (const dir of listVersionDirs(config.APPS_DIR)) {
    if (!registeredNames.has(dir)) issues.push({ type: 'orphan_app_dir', dir: path.join(config.APPS_DIR, dir) });
  }
  for (const dir of listVersionDirs(config.DATA_DIR)) {
    if (!registeredNames.has(dir)) issues.push({ type: 'orphan_data_dir', dir: path.join(config.DATA_DIR, dir) });
  }
  for (const r of registered) {
    const optPath = path.join(r.data_path, 'Config', 'options.json');
    if (fs.existsSync(optPath)) {
      try {
        const opt = JSON.parse(fs.readFileSync(optPath, 'utf8'));
        if (opt.port !== r.port) {
          issues.push({ type: 'port_mismatch', instance: r.name, registry_port: r.port, options_json_port: opt.port });
        }
      } catch { /* unreadable/corrupt options.json is itself worth surfacing */
        issues.push({ type: 'unreadable_options_json', instance: r.name, path: optPath });
      }
    }
  }

  return { issues, checkedAt: Date.now() };
}

module.exports = reconcile;
