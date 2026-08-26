'use strict';
const express = require('express');
const path = require('path');
const { callHelper } = require('./client');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Real client IP: nginx (system, in front of everything) sets X-Real-IP.
// This is a readability field for the audit log only — never used for
// authorization (spec 3c).
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

app.get('/api/health/:name', async (req, res) => {
  respond(res, await callHelper('health', { name: req.params.name }, clientIp(req)));
});

app.post('/api/switch', async (req, res) => {
  respond(res, await callHelper('apply-upstream', { name: req.body.name }, clientIp(req)));
});

app.post('/api/start/:name', async (req, res) => {
  respond(res, await callHelper('start', { name: req.params.name }, clientIp(req)));
});

app.post('/api/stop/:name', async (req, res) => {
  respond(res, await callHelper('stop', { name: req.params.name }, clientIp(req)));
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

// Точечная миграция одного мира вместе с его игровой системой (если её ещё
// нет в dst), без бэкапа/остановки всего тома-источника — используется,
// когда в data/dst уже что-то настроено вручную (например лицензия введена
// напрямую через Setup) и полный copy-volume перезаписал бы это.
// Идемпотентно: мир/система, уже присутствующие в dst, просто пропускаются
// (copied:false), не ошибка — повторный вызов безопасен.
// Совместимость системы с целевым ядром НЕ проверяется технически — только
// сравнивается заявленный system.json compatibility.maximum с номером
// целевой версии и возвращается предупреждением; решение копировать всё
// равно остаётся за вызывающим (человеком).
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

const PORT = process.env.PORT || 8099;
// 0.0.0.0 inside the container — the actual host-side restriction to
// localhost-only comes from docker-compose's `127.0.0.1:8099:8099` port
// publish, not from this bind address. Binding to 127.0.0.1 here would
// make the app unreachable through docker's port forwarding entirely
// (that DNATs to the container's own IP, not to its loopback).
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[panel-dm] listening on 0.0.0.0:${PORT}`);
});
