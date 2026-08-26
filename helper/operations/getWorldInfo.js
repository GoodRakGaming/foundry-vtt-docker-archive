'use strict';
const fs = require('fs');
const path = require('path');
const { getInstance } = require('./_common');
const { OpError } = require('../lib/errors');

// Read-only. Tells the caller which system a world needs, and — if that
// system happens to already be present on the SAME instance (i.e. reading
// the source before a copy) — its declared compatibility range, so the DM
// panel can warn before blindly copying a system that says it won't run on
// the target core (spec: "проверить совместимость системы... до миграции").
async function getWorldInfo(params, db) {
  const inst = getInstance(db, params.name);
  const worldName = params.worldName;
  const worldJsonPath = path.join(inst.data_path, 'Data', 'worlds', worldName, 'world.json');
  if (!fs.existsSync(worldJsonPath)) {
    throw new OpError(`мир '${worldName}' не найден в ${inst.name}`);
  }

  let world;
  try {
    world = JSON.parse(fs.readFileSync(worldJsonPath, 'utf8'));
  } catch {
    throw new OpError(`не удалось разобрать ${worldJsonPath}`);
  }
  const systemId = world.system;

  let systemInfo = null;
  if (systemId) {
    const systemJsonPath = path.join(inst.data_path, 'Data', 'systems', systemId, 'system.json');
    if (fs.existsSync(systemJsonPath)) {
      try {
        const sys = JSON.parse(fs.readFileSync(systemJsonPath, 'utf8'));
        systemInfo = { id: sys.id, version: sys.version, compatibility: sys.compatibility || null };
      } catch { /* leave systemInfo null, caller just won't get a compatibility warning */ }
    }
  }

  return { worldName, title: world.title || null, coreVersion: world.coreVersion || null, system: systemId, systemInfo };
}

module.exports = getWorldInfo;
