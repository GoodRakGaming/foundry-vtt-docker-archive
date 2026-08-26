'use strict';
const net = require('net');

const DM_SOCKET = process.env.HELPER_SOCKET || '/run/foundry-helper-dm/dm.sock';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // covers slow copy-volume/backup-volume on large worlds

function callHelper(op, params = {}, clientIp = null, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(DM_SOCKET);
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`helper request '${op}' timed out`));
    }, timeoutMs);

    sock.on('connect', () => sock.write(JSON.stringify({ op, params, clientIp }) + '\n'));
    sock.on('data', (d) => (buf += d.toString('utf8')));
    sock.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error('invalid response from helper'));
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

module.exports = { callHelper };
