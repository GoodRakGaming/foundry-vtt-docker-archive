'use strict';
const fs = require('fs');
const path = require('path');

// Guard B: refuse a full-volume copy into a destination that already has
// real content. "Real content" means an actual world, system, or module —
// NOT the skeleton every instance has the moment it's deployed: the
// top-level Data/ directory and its shared-assets mount-point stubs
// (art, tokens, maps, ...) are created before Foundry ever runs (partly by
// us, to avoid the EACCES crash from Фаза 13; partly by docker itself for
// the bind mounts), and Foundry's own options.json shows up after the
// first start regardless of whether any real content exists. None of that
// is "occupied" in the sense Guard B cares about — only worlds/systems/
// modules are irreplaceable per-instance data worth protecting.
function hasRealContent(dataPath) {
  for (const sub of ['worlds', 'systems', 'modules']) {
    const dir = path.join(dataPath, 'Data', sub);
    if (!fs.existsSync(dir)) continue;
    // A real world/system/module is always its own subdirectory. Foundry
    // itself drops a plain README.txt into each of these folders on first
    // start (explaining what goes there) — that file must not count as
    // "occupied", or Guard B would permanently block every instance that
    // was ever started even once.
    const hasSubdir = fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());
    if (hasSubdir) return true;
  }
  return false;
}

function isEmptyForGuardB(dataPath) {
  return !fs.existsSync(dataPath) || !hasRealContent(dataPath);
}

module.exports = { isEmptyForGuardB };
