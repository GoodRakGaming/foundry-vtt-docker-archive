'use strict';
const jobs = require('../lib/jobs');
const { OpError } = require('../lib/errors');

async function jobStatus(params) {
  const job = jobs.getJob(params.jobId);
  if (!job) throw new OpError(`неизвестная задача '${params.jobId}'`);
  return job;
}

module.exports = jobStatus;
