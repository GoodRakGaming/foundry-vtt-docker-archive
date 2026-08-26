'use strict';
const { randomUUID } = require('crypto');

// In-memory only — jobs don't survive a helper restart, which is fine:
// they track long shell commands (rsync/tar) that are themselves killed
// when the helper process exits, so there's nothing to resume anyway.
const jobs = new Map();

function createJob(type, meta = {}) {
  const id = randomUUID();
  jobs.set(id, {
    id,
    type,
    status: 'running', // running | done | error
    progress: 0,
    message: '',
    error: null,
    ...meta,
    startedAt: Date.now(),
    finishedAt: null,
  });
  return id;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

function getJob(id) {
  return jobs.get(id) || null;
}

// Finished jobs linger an hour (so a slow-to-poll client doesn't miss the
// final state) then get swept — this is progress reporting, not an audit
// trail, audit_log already covers the durable record.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { createJob, updateJob, getJob };
