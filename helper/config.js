'use strict';
const path = require('path');

const ROOT = '/opt/foundry';

module.exports = {
  ROOT,
  APPS_DIR: path.join(ROOT, 'apps'),
  DATA_DIR: path.join(ROOT, 'data'),
  BACKUPS_DIR: path.join(ROOT, 'backups'),
  SHARED_ASSETS_DIR: path.join(ROOT, 'shared-assets'),
  VOLUME_BACKUPS_DIR: path.join(ROOT, 'backups', 'volumes'),
  DB_BACKUP_DIR: path.join(ROOT, 'backups', 'db'),
  DB_PATH: path.join(ROOT, 'registry.sqlite'),
  ACTIVE_CONF_PATH: path.join(ROOT, 'foundry-active.conf'),
  COMPOSE_FILE: path.join(ROOT, 'docker-compose.yml'),

  // Sockets live inside their own directories, not directly in /run.
  // Docker bind-mounts of a single FILE track the inode, not the path —
  // when the helper restarts it unlinks+recreates the socket file (new
  // inode), and a file-level bind mount in a container keeps pointing at
  // the old, now-orphaned inode until the container itself restarts.
  // Bind-mounting the containing directory instead means the container
  // sees whatever socket file currently exists at that path.
  DM_SOCKET_DIR: '/run/foundry-helper-dm',
  ADMIN_SOCKET_DIR: '/run/foundry-helper-admin',
  DM_SOCKET: '/run/foundry-helper-dm/dm.sock',
  ADMIN_SOCKET: '/run/foundry-helper-admin/admin.sock',

  PORT_MIN: 30010,
  PORT_MAX: 30099,

  // Extend only after checking the target Foundry version's documented Node
  // requirement — never assume "one Node for everything" (see spec section 2).
  // Confirmed 2026-08-24: v13 runs on Node 22 (proven in prod). v14 requires
  // Node 24 specifically — v13 and v14 need mutually exclusive Node majors,
  // this is not a hypothetical case from the spec, it's the real situation.
  NODE_ALLOWLIST: [
    'node:20-bullseye-slim',
    'node:22-bullseye-slim',
    'node:24-bullseye-slim',
  ],

  // Official `node` image runs as uid 1000 ('node') by default.
  CONTAINER_UID: 1000,
  CONTAINER_GID: 1000,

  DB_BACKUP_INTERVAL_MS: 30 * 60 * 1000,
  DB_BACKUP_RETENTION: 10,
  VOLUME_BACKUP_RETENTION: 5,
  // Baseline floor before ANY write-heavy op (backup, world/system/module
  // copy, archive extraction) — guards the "basically out of disk" case
  // that's already bitten this project once (a timeout mid-tar left a
  // truncated, unreadable backup). Full-volume copy additionally checks
  // against the actual source size on top of this floor, since a full
  // volume can be far bigger than this margin covers on its own.
  MIN_FREE_BYTES_SAFETY: 2 * 1024 * 1024 * 1024, // 2 GiB
  FULL_COPY_SPACE_MARGIN: 1.1, // require 110% of the source volume's size free

  RATE_LIMIT_MS: {
    'copy-volume': 5 * 60 * 1000,
    'backup-volume': 5 * 60 * 1000,
  },

  HEALTH_TIMEOUT_MS: 3000,

  // `docker compose up` may need to pull an image (minutes on a slow link).
  DOCKER_PULL_TIMEOUT_MS: 10 * 60 * 1000,

  // tar/cp/chown over a full data volume (observed: ~17GB took ~26 minutes
  // for tar -czf on this host) — the 60s default in lib/exec.js is nowhere
  // near enough. Found this the hard way: a backup-volume call timed out
  // mid-Upgrade and the panel's endpoint treated the timeout as a clean
  // failure, which is fine — but only because it happened at step 1, before
  // anything got stopped. Applies to backup-volume, copy-volume, copy-world,
  // copy-system.
  LONG_IO_TIMEOUT_MS: 30 * 60 * 1000,
};
