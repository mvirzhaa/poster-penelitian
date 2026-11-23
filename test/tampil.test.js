const test = require('node:test');
const assert = require('node:assert/strict');
const { ELEMEN, KEYS, petaTampil, bacaTampil } = require('../src/tampil');

test('ELEMEN and KEYS definition', () => {
  assert.ok(Array.isArray(ELEMEN));
  assert.ok(ELEMEN.length >= 17);
  assert.ok(KEYS.includes('sumber_anggaran'));
  assert.ok(KEYS.includes('abstrak'));
  assert.ok(KEYS.includes('logo_apt'));
});

test('petaTampil returns default map when empty', () => {
  const p = petaTampil({});
  assert.equal(p.abstrak, true);
  assert.equal(p.sumber_anggaran, false);
  assert.equal(p.logo_apt, true);
});

test('petaTampil respects custom booleans', () => {
  const p = petaTampil({ abstrak: false, sumber_anggaran: true });
  assert.equal(p.abstrak, false);
  assert.equal(p.sumber_anggaran, true);
});

test('bacaTampil parses form input array or object', () => {
  assert.equal(bacaTampil({}), undefined);
  assert.equal(bacaTampil({ tampil_ada: '1', tampil: [] }), undefined);
  const fromForm = bacaTampil({ tampil_ada: '1', tampil: ['abstrak', 'logo_apt'] });
  assert.equal(fromForm.abstrak, true);
  assert.equal(fromForm.logo_apt, true);
  assert.equal(fromForm.sumber_anggaran, false);
  assert.equal(fromForm.anggaran, false);
});
