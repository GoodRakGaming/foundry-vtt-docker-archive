'use strict';
const fs = require('fs');
const path = require('path');
const { getInstance } = require('./_common');

// Read-only. Lists the worlds present on an instance so panels can offer a
// dropdown instead of free-text entry — a typo'd world name used to fail
// deep into the copy instead of up front.
async function listWorlds(params, db) {
  const inst = getInstance(db, params.name);
  const worldsDir = path.join(inst.data_path, 'Data', 'worlds');
  if (!fs.existsSync(worldsDir)) return { worlds: [] };

  const worlds = fs.readdirSync(worldsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const worldJsonPath = path.join(worldsDir, e.name, 'world.json');
      let title = null;
      if (fs.existsSync(worldJsonPath)) {
        try {
          title = JSON.parse(fs.readFileSync(worldJsonPath, 'utf8')).title || null;
        } catch {
          // leave title null — the folder name alone is still usable
        }
      }
      return { name: e.name, title };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { worlds };
}

module.exports = listWorlds;
