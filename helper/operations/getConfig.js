'use strict';
const config = require('../config');

// admin-only, read-only. Lets panel-admin render the deploy form's node
// image / port range from the same constants the helper validates
// against, instead of duplicating them client-side.
async function getConfig() {
  return {
    nodeAllowlist: config.NODE_ALLOWLIST,
    portMin: config.PORT_MIN,
    portMax: config.PORT_MAX,
  };
}

module.exports = getConfig;
