const test = require('node:test');
const assert = require('node:assert');
const sso = require('../src/sso');

test('SSO module exports required functions', () => {
  assert.strictEqual(typeof sso.routes, 'function');
  assert.strictEqual(typeof sso.introspectToken, 'function');
  assert.strictEqual(typeof sso.syncSsoUser, 'function');
  assert.strictEqual(typeof sso.resolveProdiFromUnit, 'function');
  assert.strictEqual(typeof sso.resolveAliasKode, 'function');
  assert.strictEqual(typeof sso.normalizeUnitName, 'function');
  assert.strictEqual(typeof sso.userMatchParams, 'function');
  assert.strictEqual(typeof sso.isInvolvedResearcher, 'function');
});

test('resolveAliasKode maps E-Portal unit codes and names to schema prodi codes', () => {
  assert.strictEqual(sso.resolveAliasKode('Teknik Informatika', 'FT_TI'), 'informatika');
  assert.strictEqual(sso.resolveAliasKode('Teknik Informatika', ''), 'informatika');
  assert.strictEqual(sso.resolveAliasKode('', 'FT_TI'), 'informatika');
  assert.strictEqual(sso.resolveAliasKode('Teknik Sipil', 'FT_TS'), 'teknik-sipil');
  assert.strictEqual(sso.resolveAliasKode('Sistem Informasi', ''), '');
});

test('normalizeUnitName strips common prefixes and parenthetical codes', () => {
  assert.strictEqual(sso.normalizeUnitName('Teknik Informatika'), 'informatika');
  assert.strictEqual(sso.normalizeUnitName('Prodi Sistem Informasi'), 'sistem informasi');
  assert.strictEqual(sso.normalizeUnitName('Pendidikan Agama Islam (PAI)'), 'pendidikan agama islam');
});

test('userMatchParams and isInvolvedResearcher match Journey email slug and real name', () => {
  const userEmailOnly = { id: 9, username: 'fitrah.satrya@gmail.com', email: 'fitrah.satrya@gmail.com', nama: 'fitrah.satrya@gmail.com' };
  assert.deepStrictEqual(sso.userMatchParams(userEmailOnly), { emailSlug: 'fitrah-satrya-gmail-com', nama: '' });

  const posterMain = { peneliti_ref: 'fitrah-satrya-gmail-com-2971', anggota_peneliti: [] };
  const posterMember = { peneliti_ref: '', anggota_peneliti: [{ nama: 'Fitrah Satrya', ref: 'fitrah-satrya-gmail-com-2971' }] };
  const posterOther = { peneliti_ref: 'orang-lain-123', anggota_peneliti: [] };

  assert.strictEqual(sso.isInvolvedResearcher(userEmailOnly, posterMain), true);
  assert.strictEqual(sso.isInvolvedResearcher(userEmailOnly, posterMember), true);
  assert.strictEqual(sso.isInvolvedResearcher(userEmailOnly, posterOther), false);

  const dummyUser = { id: 2, username: 'tu.informatika', nama: 'Staf TU Teknik Informatika' };
  assert.deepStrictEqual(sso.userMatchParams(dummyUser), { emailSlug: '', nama: '' });
});
