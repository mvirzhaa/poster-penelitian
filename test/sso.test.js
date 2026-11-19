const test = require('node:test');
const assert = require('node:assert');
const sso = require('../src/sso');

test('SSO module exports required functions', () => {
  assert.strictEqual(typeof sso.routes, 'function');
  assert.strictEqual(typeof sso.introspectToken, 'function');
  assert.strictEqual(typeof sso.syncSsoUser, 'function');
  assert.strictEqual(typeof sso.resolveProdiFromUnit, 'function');
});
