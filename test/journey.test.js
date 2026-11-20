const test = require('node:test');
const assert = require('node:assert/strict');
const { anggotaPeneliti } = require('../src/nama');

test('refs extraction including peneliti_ref', () => {
  const refs = r => [...new Set([r.peneliti_ref, ...anggotaPeneliti(r).map(a => a.ref)].filter(Boolean))];

  const r1 = { peneliti_ref: 'dosen-a', anggota_peneliti: [{ nama: 'Budi', ref: 'dosen-b' }] };
  assert.deepEqual(refs(r1), ['dosen-a', 'dosen-b']);

  const r2 = { peneliti_ref: '', anggota_peneliti: [{ nama: 'Budi', ref: 'dosen-b' }] };
  assert.deepEqual(refs(r2), ['dosen-b']);

  const r3 = { peneliti_ref: 'dosen-a', anggota_peneliti: [] };
  assert.deepEqual(refs(r3), ['dosen-a']);

  const r4 = { peneliti_ref: '', anggota_peneliti: [] };
  assert.deepEqual(refs(r4), []);

  // Deduplication
  const r5 = { peneliti_ref: 'dosen-a', anggota_peneliti: [{ nama: 'A', ref: 'dosen-a' }] };
  assert.deepEqual(refs(r5), ['dosen-a']);
});
