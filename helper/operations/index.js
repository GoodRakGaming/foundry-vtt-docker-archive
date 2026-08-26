'use strict';
const health = require('./health');
const { start, stop, restart } = require('./startStop');
const applyUpstream = require('./applyUpstream');
const copyVolume = require('./copyVolume');
const backupVolume = require('./backupVolume');
const deploy = require('./deploy');
const deleteInstance = require('./delete');
const readLogs = require('./readLogs');
const reconcile = require('./reconcile');
const listInstances = require('./listInstances');
const getState = require('./getState');
const getConfig = require('./getConfig');
const setUpgradeBlocked = require('./setUpgradeBlocked');
const registerExisting = require('./registerExisting');
const copyWorld = require('./copyWorld');
const copySystem = require('./copySystem');
const getWorldInfo = require('./getWorldInfo');
const checkVolumeEmpty = require('./checkVolumeEmpty');
const copyModules = require('./copyModules');
const copyVolumeJob = require('./copyVolumeJob');
const jobStatus = require('./jobStatus');
const listWorlds = require('./listWorlds');

const HANDLERS = {
  'health': health,
  'start': start,
  'stop': stop,
  'restart': restart,
  'apply-upstream': applyUpstream,
  'copy-volume': copyVolume,
  'copy-volume-job': copyVolumeJob,
  'job-status': jobStatus,
  'copy-world': copyWorld,
  'copy-system': copySystem,
  'copy-modules': copyModules,
  'get-world-info': getWorldInfo,
  'list-worlds': listWorlds,
  'check-volume-empty': checkVolumeEmpty,
  'backup-volume': backupVolume,
  'deploy': deploy,
  'delete': deleteInstance,
  'read-logs': readLogs,
  'reconcile': reconcile,
  'list-instances': listInstances,
  'get-state': getState,
  'get-config': getConfig,
  'set-upgrade-blocked': setUpgradeBlocked,
  'register-existing': registerExisting,
};

// read-only ops don't need an audit trail entry — everything else does.
const NOT_AUDITED = new Set(['health', 'read-logs', 'reconcile', 'list-instances', 'get-state', 'get-config', 'get-world-info', 'check-volume-empty', 'job-status', 'list-worlds']);

async function dispatch(op, params, db) {
  const handler = HANDLERS[op];
  if (!handler) throw new Error(`no handler registered for op '${op}'`);
  return handler(params, db);
}

function isAuditable(op) {
  return !NOT_AUDITED.has(op);
}

module.exports = { dispatch, isAuditable, HANDLERS };
