'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { callHelper } = require('./client');
const { validateArchive } = require('./lib/validateArchive');

// UPLOAD_DIR_LOCAL: path as seen inside this container (where multer writes).
// UPLOAD_DIR_HOST: the same bind-mounted directory as seen by the helper,
// which runs on the host, not in a container — the two differ only in
// prefix, never in content (spec 3b: paths passed to `deploy` must resolve
// to something the helper can actually read).
const UPLOAD_DIR_LOCAL = process.env.UPLOAD_DIR_LOCAL || '/uploads';
const UPLOAD_DIR_HOST = process.env.UPLOAD_DIR_HOST || '/opt/foundry/_uploads';
fs.mkdirSync(UPLOAD_DIR_LOCAL, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR_LOCAL,
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(8).toString('hex')}.zip`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 * 1024 }, // 3 GiB — real builds run 200-400MB, generous headroom
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function clientIp(req) {
  return req.headers['x-real-ip'] || req.socket.remoteAddress || null;
}

function respond(res, result) {
  if (result.ok) return res.json({ ok: true, data: result.data });
  res.status(400).json({ ok: false, error: result.error });
}

app.get('/api/instances', async (req, res) => {
  respond(res, await callHelper('list-instances', {}, clientIp(req)));
});

app.get('/api/state', async (req, res) => {
  respond(res, await callHelper('get-state', {}, clientIp(req)));
});

app.get('/api/config', async (req, res) => {
  respond(res, await callHelper('get-config', {}, clientIp(req)));
});

app.get('/api/health/:name', async (req, res) => {
  respond(res, await callHelper('health', { name: req.params.name }, clientIp(req)));
});

app.post('/api/backup/:name', async (req, res) => {
  respond(res, await callHelper('backup-volume', { name: req.params.name }, clientIp(req)));
});

// Copied over from the DM panel — the admin panel should not require
// hopping to the other panel for basic switch/start/stop, which is the
// whole point of an admin having every DM capability plus the
// destructive ones.
app.post('/api/switch', async (req, res) => {
  respond(res, await callHelper('apply-upstream', { name: req.body.name }, clientIp(req)));
});

app.post('/api/start/:name', async (req, res) => {
  respond(res, await callHelper('start', { name: req.params.name }, clientIp(req)));
});

app.post('/api/stop/:name', async (req, res) => {
  respond(res, await callHelper('stop', { name: req.params.name }, clientIp(req)));
});

app.get('/api/logs/:target', async (req, res) => {
  respond(res, await callHelper('read-logs', { target: req.params.target }, clientIp(req)));
});

app.post('/api/reconcile', async (req, res) => {
  respond(res, await callHelper('reconcile', {}, clientIp(req)));
});

app.post('/api/upgrade-blocked', async (req, res) => {
  // Deliberately NOT a helper op: upgrade_blocked is a plain admin-owned
  // registry flag, no filesystem/docker side effect, so it's fine to write
  // directly here — but only from THIS panel's own SQLite handle it does
  // not have (panel-admin has no DB access at all, same as panel-dm). Route
  // it through the helper too, for consistency of "only helper writes the
  // registry" (spec 3a).
  respond(res, await callHelper('set-upgrade-blocked', { name: req.body.name, blocked: !!req.body.blocked }, clientIp(req)));
});

app.post('/api/deploy', upload.single('archive'), async (req, res) => {
  const ip = clientIp(req);
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: 'архив не загружен' });

  const localPath = file.path;
  const hostPath = path.join(UPLOAD_DIR_HOST, path.basename(localPath));
  const cleanup = () => fs.rm(localPath, { force: true }, () => {});

  try {
    const check = await validateArchive(localPath);
    if (!check.valid) {
      cleanup();
      return res.status(400).json({
        ok: false,
        error: check.foundMainJs
          ? `архив содержит подозрительные пути: ${check.suspicious.join(', ')}`
          : 'в архиве нет resources/app/main.js — это не похоже на сборку Foundry',
      });
    }

    const result = await callHelper('deploy', {
      name: req.body.name,
      port: req.body.port,
      nodeImage: req.body.nodeImage,
      archivePath: hostPath,
    }, ip);

    cleanup();
    respond(res, result);
  } catch (e) {
    cleanup();
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

app.post('/api/delete', async (req, res) => {
  respond(res, await callHelper('delete', { name: req.body.name, withData: !!req.body.withData }, clientIp(req)));
});

app.get('/api/worlds/:name', async (req, res) => {
  respond(res, await callHelper('list-worlds', { name: req.params.name }, clientIp(req)));
});

// Foundry only scans Data/worlds, Data/systems, Data/modules once, at
// process startup — new files copied in later stay invisible in Setup
// until the process actually relaunches. If dst happens to be running
// right now, force that relaunch so the copy takes effect immediately;
// if it's stopped, there's nothing to do — its next normal start will
// pick everything up on its own.
async function restartIfRunning(dst, ip) {
  const health = await callHelper('health', { name: dst }, ip);
  if (!health.ok || !health.data.alive) return { restarted: false };
  const r = await callHelper('restart', { name: dst }, ip);
  return { restarted: r.ok, restartError: r.ok ? null : r.error };
}

// Точечная миграция одного мира — copied over from the DM panel so admins
// have the same non-disruptive tool without needing to switch panels.
// Same idempotent "copy if missing" semantics and the same
// compatibility-warning logic as the DM panel's version; see that file for
// the full rationale.
app.post('/api/copy-world', async (req, res) => {
  const { src, dst, worldName } = req.body;
  const ip = clientIp(req);
  if (!src || !dst || !worldName) {
    return res.status(400).json({ ok: false, error: 'src, dst и worldName обязательны' });
  }

  const info = await callHelper('get-world-info', { name: src, worldName }, ip);
  if (!info.ok) return respond(res, info);
  const { system: systemId, systemInfo } = info.data;

  let systemWarning = null;
  let systemResult = null;
  if (systemId) {
    if (systemInfo && systemInfo.compatibility && systemInfo.compatibility.maximum) {
      const dstMajor = parseInt(String(dst).replace(/[^0-9]/g, ''), 10);
      const maxMajor = parseInt(String(systemInfo.compatibility.maximum), 10);
      if (!isNaN(dstMajor) && !isNaN(maxMajor) && maxMajor < dstMajor) {
        systemWarning = `Система '${systemId}' ${systemInfo.version} заявляет совместимость максимум с ядром ${systemInfo.compatibility.maximum}, а целевая версия — ${dst}. Foundry может отказаться её загрузить или предупредить о несовместимости. Рекомендуется установить актуальную версию системы через Setup ${dst} → Game Systems вместо копирования этой.`;
      }
    }
    const sysCopy = await callHelper('copy-system', { src, dst, systemId }, ip);
    if (!sysCopy.ok) return respond(res, sysCopy);
    systemResult = sysCopy.data;
  }

  const worldCopy = await callHelper('copy-world', { src, dst, worldName }, ip);
  if (!worldCopy.ok) return respond(res, worldCopy);

  let restartInfo = { restarted: false };
  if (worldCopy.data.copied || (systemResult && systemResult.copied)) {
    restartInfo = await restartIfRunning(dst, ip);
  }

  res.json({
    ok: true,
    data: { ...worldCopy.data, system: systemId, systemResult, systemWarning, ...restartInfo },
  });
});

// Full-volume migration — admin-only (moved here from the DM panel): it
// stops the source instance outright and replaces the destination
// wholesale, the same weight class as deploy/delete. Split into three
// client-driven steps because the copy can run many minutes and a plain
// HTTP POST can't stream a progress bar back mid-request:
//   1. /api/upgrade/start  — checks + stop(src) + kick off the copy as a
//      background job on the helper, returns a jobId immediately
//   2. /api/job/:id        — the browser polls this to drive a progress bar
//   3. /api/upgrade/finish — once the job is done, restart(dst)
// Deliberately does NOT open the world or switch traffic itself.
//
// No backup-volume step here on purpose: copy-volume-job only ever READS
// from src (rsync src/ -> dst/), it never writes to or deletes anything
// under src, so src's live files already are the unmodified original —
// backing it up before stopping it protects against nothing this
// operation can do. The one thing a tar.gz snapshot would protect
// against — someone deleting src later — belongs on `delete`, not here;
// taking it at migration time just cost disk space and minutes on every
// run for no matching risk (see status.md Фаза 17/18 discussion).
app.post('/api/upgrade/start', async (req, res) => {
  const { src, dst } = req.body;
  const ip = clientIp(req);

  if (!src || !dst || src === dst) {
    return res.status(400).json({ ok: false, error: 'источник и назначение обязательны и должны различаться' });
  }

  const instances = await callHelper('list-instances', {}, ip);
  if (!instances.ok) return respond(res, instances);
  const srcInst = instances.data.instances.find((i) => i.name === src);
  if (!srcInst) return res.status(404).json({ ok: false, error: `неизвестный инстанс-источник '${src}'` });
  if (srcInst.upgrade_blocked) {
    return res.status(409).json({ ok: false, error: `upgrade для '${src}' заблокирован администратором (флаг upgrade_blocked) — эта версия намеренно закреплена` });
  }

  // Check Guard B's condition BEFORE backing up and stopping the source —
  // a doomed full-volume copy must not stop the active version for
  // nothing (found this the hard way: it very nearly did). "Empty" here
  // means no real worlds/systems/modules yet — see lib/guardB.js; a
  // freshly deployed instance always has a Data/ skeleton (shared-assets
  // mount points, possibly options.json) and still counts as empty.
  const emptyCheck = await callHelper('check-volume-empty', { name: dst }, ip);
  if (!emptyCheck.ok) return respond(res, emptyCheck);
  if (!emptyCheck.data.empty) {
    return res.status(409).json({
      ok: false,
      error: `в data/${dst} уже есть реальные данные (миры/системы/модули) — полная миграция всё равно отказала бы (Guard B), эта проверка нужна именно затем, чтобы не остановить ${src} впустую и не узнать об этом только потом. Используйте точечный перенос мира вместо этого, либо сначала очистите/переразверните ${dst}, если хотите чистую полную копию.`,
    });
  }

  const stopped = await callHelper('stop', { name: src }, ip);
  if (!stopped.ok) return respond(res, stopped);

  const job = await callHelper('copy-volume-job', { src, dst }, ip);
  if (!job.ok) return respond(res, job);

  res.json({ ok: true, data: { jobId: job.data.jobId, src, dst } });
});

app.get('/api/job/:jobId', async (req, res) => {
  respond(res, await callHelper('job-status', { jobId: req.params.jobId }, clientIp(req)));
});

app.post('/api/upgrade/finish', async (req, res) => {
  const { dst } = req.body;
  const ip = clientIp(req);
  if (!dst) return res.status(400).json({ ok: false, error: 'dst обязателен' });

  // Foundry only scans Data/worlds, Data/systems, Data/modules once, at
  // process startup — it never notices files that show up later. dst has
  // been running continuously since it was deployed (deploy() starts the
  // container as its last step), so a plain `start` here would be a no-op
  // (--no-recreate skips an already-running container) and the just-copied
  // content would stay invisible in Setup until someone happened to
  // restart it manually. `restart` unconditionally relaunches the
  // container so Foundry actually re-scans.
  const restarted = await callHelper('restart', { name: dst }, ip);
  if (!restarted.ok) return respond(res, restarted);

  res.json({
    ok: true,
    data: {
      dst,
      message: `${dst} перезапущен, чтобы Foundry пересканировал скопированные данные. Зайдите в Setup ${dst}, обновите систему и модули, откройте мир — Foundry смигрирует его. После проверки целостности нажмите «Сделать активной» (здесь же, в таблице инстансов).`,
    },
  });
});

// Bulk "copy every module that's missing" — moved here from the DM panel:
// coarser and longer-running than a single-world copy, so it belongs with
// the other admin-weight migration tools even though it never stops
// anything. A world may lean on modules copy-world doesn't know about
// (world.json only names the system, not which modules were active), so
// this stays a deliberate, explicit follow-up action rather than something
// baked silently into the world copy.
app.post('/api/copy-modules', async (req, res) => {
  const { src, dst } = req.body;
  const ip = clientIp(req);
  if (!src || !dst) {
    return res.status(400).json({ ok: false, error: 'src и dst обязательны' });
  }
  const result = await callHelper('copy-modules', { src, dst }, ip, 30 * 60 * 1000);
  if (!result.ok) return respond(res, result);

  let restartInfo = { restarted: false };
  if (result.data.copied > 0) {
    restartInfo = await restartIfRunning(dst, ip);
  }

  res.json({ ok: true, data: { ...result.data, ...restartInfo } });
});

const PORT = process.env.PORT || 8100;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[panel-admin] listening on 0.0.0.0:${PORT}`);
});
