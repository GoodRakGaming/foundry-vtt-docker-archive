'use strict';
const { execSync } = require('child_process');
const { OpError } = require('./errors');

function freeBytes(targetDir) {
  const out = execSync(`df -B1 --output=avail "${targetDir}"`).toString().trim().split('\n');
  return Number(out[out.length - 1].trim());
}

function usedBytes(sourceDir) {
  return Number(execSync(`du -sB1 "${sourceDir}"`).toString().trim().split('\t')[0]);
}

// Refuses to start a write-heavy operation when the destination filesystem
// doesn't have enough headroom. Found out the hard way (backups) that
// running out of disk mid-write leaves a truncated, corrupt file — that's
// the same failure mode for every copy operation, not just backups, so
// every one of them checks this before touching disk.
function requireFreeSpace(targetDir, minBytes, label) {
  const free = freeBytes(targetDir);
  if (free < minBytes) {
    const freeGb = (free / 1024 ** 3).toFixed(1);
    const minGb = (minBytes / 1024 ** 3).toFixed(1);
    throw new OpError(`недостаточно места на диске для ${label}: свободно ${freeGb} ГиБ, нужно минимум ${minGb} ГиБ`);
  }
}

module.exports = { freeBytes, usedBytes, requireFreeSpace };
