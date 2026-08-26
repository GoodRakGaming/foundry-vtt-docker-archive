'use strict';

// User-facing, expected failure (bad input, guard tripped, etc).
// Anything else thrown is treated as an internal error by the dispatcher.
class OpError extends Error {}

module.exports = { OpError };
