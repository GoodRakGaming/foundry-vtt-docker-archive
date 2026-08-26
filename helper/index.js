'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { openDb, startSelfRepair } = require('./db');
const { auditLog } = require('./audit');
const { dispatch, isAuditable } = require('./operations');

const db = openDb();
startSelfRepair(db);

// Full-volume migration (copy-volume / copy-volume-job / job-status) is
// admin-only: it stops the source instance outright and replaces the
// destination wholesale — that's the same weight class as deploy/delete,
// not a DM-safe operation. DM keeps only the single-world copy
// (copy-world/copy-system, never stops anything, never touches more than
// the one named world). Bulk copy-modules moved to admin too — it's a
// coarser, longer-running operation than the DM panel is meant to expose.
const DM_OPS = new Set(['health', 'start', 'stop', 'restart', 'apply-upstream', 'copy-world', 'copy-system', 'get-world-info', 'list-worlds', 'check-volume-empty', 'backup-volume', 'list-instances', 'get-state']);
const ADMIN_OPS = new Set([...DM_OPS, 'deploy', 'delete', 'read-logs', 'reconcile', 'get-config', 'set-upgrade-blocked', 'register-existing', 'copy-volume', 'copy-volume-job', 'job-status', 'copy-modules']);

async function handleRequest(line, actorType, allowed) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return { ok: false, error: 'invalid JSON request' };
  }

  const op = req.op;
  const params = req.params || {};
  const clientIp = typeof req.clientIp === 'string' ? req.clientIp : null;

  if (!allowed.has(op)) {
    return { ok: false, error: `operation '${op}' not permitted on ${actorType} socket` };
  }

  // actor is the socket that accepted the connection, full stop. Never
  // read req.actor / params.actor here — that field does not exist in the
  // protocol on purpose (spec 3b: audit log must not be forgeable by the
  // caller).
  const actor = actorType;

  let ok = true;
  let result;
  let errMsg = null;
  try {
    result = await dispatch(op, params, db);
  } catch (e) {
    ok = false;
    errMsg = (e && e.message) || String(e);
  }

  if (isAuditable(op)) {
    auditLog(db, {
      actor,
      ip: clientIp,
      action: op,
      from: params.src || params.from || null,
      to: params.dst || params.to || params.name || null,
      result: ok ? 'ok' : 'error',
      detail: ok ? null : errMsg,
    });
  }

  return ok ? { ok: true, data: result } : { ok: false, error: errMsg };
}

function createServer(actorType, sockPath) {
  const allowed = actorType === 'admin' ? ADMIN_OPS : DM_OPS;

  fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) {
        if (buf.length > 1024 * 1024) conn.destroy(); // guard against unbounded buffering
        return;
      }
      const line = buf.slice(0, nl);
      handleRequest(line, actorType, allowed)
        .then((res) => conn.end(JSON.stringify(res) + '\n'))
        .catch((e) => conn.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }) + '\n'));
    });
    conn.on('error', () => {});
  });

  server.listen(sockPath, () => {
    // Not 0777: the socket file mode is a secondary layer, the real
    // dm/admin separation is that each panel container only has the
    // matching socket bind-mounted into it at all (spec 3b).
    fs.chmodSync(sockPath, 0o660);
    console.log(`[helper] ${actorType} socket listening at ${sockPath}`);
  });

  return server;
}

createServer('dm', config.DM_SOCKET);
createServer('admin', config.ADMIN_SOCKET);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
