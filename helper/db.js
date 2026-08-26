'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS instances (
  name            TEXT PRIMARY KEY,
  app_path        TEXT NOT NULL,
  data_path       TEXT NOT NULL,
  port            INTEGER NOT NULL UNIQUE,
  node_image      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'stopped',
  created_at      INTEGER NOT NULL,
  upgrade_blocked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  ip            TEXT,
  friendly_name TEXT,
  action        TEXT NOT NULL,
  from_ver      TEXT,
  to_ver        TEXT,
  result        TEXT NOT NULL,
  detail        TEXT
);

CREATE TABLE IF NOT EXISTS ip_names (
  ip            TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  epoch         TEXT NOT NULL,
  friendly_name TEXT NOT NULL,
  assigned_at   INTEGER NOT NULL,
  PRIMARY KEY (ip, actor_type, epoch)
);
`;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneOldFiles(dir, prefix, keep) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

function openDb() {
  fs.mkdirSync(config.ROOT, { recursive: true });
  fs.mkdirSync(config.DB_BACKUP_DIR, { recursive: true });

  const db = new Database(config.DB_PATH);
  // Two panels + helper touch this file concurrently — without WAL +
  // busy_timeout this becomes SQLITE_BUSY under any real contention
  // (spec 3a "конкурентный доступ").
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

function quickCheck(db) {
  const rows = db.pragma('quick_check');
  return rows.length === 1 && rows[0].quick_check === 'ok';
}

function backupDb(db) {
  fs.mkdirSync(config.DB_BACKUP_DIR, { recursive: true });
  const dest = path.join(config.DB_BACKUP_DIR, `registry_${timestamp()}.sqlite`);
  db.exec(`VACUUM INTO '${dest}'`);
  pruneOldFiles(config.DB_BACKUP_DIR, 'registry_', config.DB_BACKUP_RETENTION);
  return dest;
}

// Last-resort reconstruction when the DB is unrecoverable and there is no
// usable backup (spec 3a point 3). audit_log and upgrade_blocked flags are
// NOT recoverable this way — that loss is a deliberate, documented boundary,
// not a bug.
function reconstructFromFs(db) {
  const found = [];
  if (!fs.existsSync(config.APPS_DIR)) return found;

  for (const name of fs.readdirSync(config.APPS_DIR)) {
    if (!/^v[0-9]+$/.test(name)) continue;
    const appPath = path.join(config.APPS_DIR, name);
    const dataPath = path.join(config.DATA_DIR, name);
    const mainJs = path.join(appPath, 'resources', 'app', 'main.js');
    if (!fs.existsSync(mainJs)) continue;

    let port = null;
    const optPath = path.join(dataPath, 'Config', 'options.json');
    if (fs.existsSync(optPath)) {
      try {
        port = JSON.parse(fs.readFileSync(optPath, 'utf8')).port ?? null;
      } catch { /* leave port null, surfaced via reconcile */ }
    }

    db.prepare(
      `INSERT INTO instances (name, app_path, data_path, port, node_image, status, created_at, upgrade_blocked)
       VALUES (@name, @appPath, @dataPath, @port, @nodeImage, 'unknown', @createdAt, 0)
       ON CONFLICT(name) DO UPDATE SET app_path=excluded.app_path, data_path=excluded.data_path`
    ).run({
      name,
      appPath,
      dataPath,
      port: port || 0,
      nodeImage: 'unknown',
      createdAt: Date.now(),
    });
    found.push(name);
  }
  return found;
}

function startSelfRepair(db) {
  if (!quickCheck(db)) {
    console.error('[helper] registry.sqlite failed quick_check — attempting WAL checkpoint');
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error('[helper] WAL checkpoint failed:', e.message);
    }
    if (!quickCheck(db)) {
      console.error('[helper] registry still inconsistent after checkpoint — reconstructing instances from filesystem (audit_log/upgrade_blocked are lost)');
      reconstructFromFs(db);
    }
  }

  setInterval(() => {
    try {
      backupDb(db);
    } catch (e) {
      console.error('[helper] periodic DB backup failed:', e.message);
    }
  }, config.DB_BACKUP_INTERVAL_MS).unref();
}

module.exports = { openDb, quickCheck, backupDb, reconstructFromFs, startSelfRepair, pruneOldFiles, timestamp };
