/*
 * _engine.js — how every test in this folder finds the code under test.
 *
 * WHY AN INDIRECTION RATHER THAN require('../assets/x.js'). A test suite is only
 * worth having if it has been SEEN to go red, and the honest way to see that is
 * to break the engine, not to break the test. Every module below is resolved
 * through ENGINE_DIR, so a mutation run is:
 *
 *     npm run test:prove-red        (tools/prove-red.js)
 *
 * which copies assets/ to a scratch directory, makes one deliberate edit per
 * test file, and reports which suites noticed. Nothing in assets/ is touched:
 * every file there is vendored into the portal and drift-checked by status.js,
 * so an edit here would show up as portal drift the next morning.
 *
 * Unset, ENGINE_DIR is the real engine, which is what CI and `npm test` run.
 */
'use strict';
const path = require('path');

const ENGINE_DIR = process.env.ENGINE_DIR
  ? path.resolve(process.env.ENGINE_DIR)
  : path.join(__dirname, '..', 'assets');

const load = (name) => require(path.join(ENGINE_DIR, name));

module.exports = { ENGINE_DIR, load };
