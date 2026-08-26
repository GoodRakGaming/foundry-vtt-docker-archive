'use strict';
const { getFriendlyName } = require('./names');

// actor is passed in by index.js and is ALWAYS derived from which unix
// socket accepted the connection — never from request params. That is the
// only thing that makes this log trustworthy (spec 3b: "actor определяется
// сокетом, а не аргументом запроса").
function auditLog(db, { actor, ip, action, from = null, to = null, result, detail = null }) {
  const friendlyName = getFriendlyName(db, ip, actor);
  db.prepare(
    `INSERT INTO audit_log (ts, actor, ip, friendly_name, action, from_ver, to_ver, result, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Date.now(), actor, ip || null, friendlyName, action, from, to, result, detail);
}

module.exports = { auditLog };
