const test = require('node:test');
const assert = require('node:assert/strict');
const { angka, rupiah, JENIS, JENIS_KEYS, SUMBER } = require('../src/biaya');

test('biaya constants definition', () => {
  assert.ok(Array.isArray(JENIS));
  assert.equal(JENIS.length, 5);
  assert.deepEqual(JENIS_KEYS, ['skripsi', 'thesis', 'desertasi', 'dosen_mandiri', 'join_research']);
  assert.deepEqual(SUMBER, ['Mandiri', 'Hibah Internal', 'Hibah External']);
});

test('angka parser parses numeric strings, Indonesian format, and rupiah', () => {
  assert.equal(angka('5.000.000'), 5000000);
  assert.equal(angka('Rp 5.000.000'), 5000000);
  assert.equal(angka('Rp5000000'), 5000000);
  assert.equal(angka(5000000), 5000000);
  assert.equal(angka(''), 0);
  assert.equal(angka(null), 0);
  assert.ok(Number.isNaN(angka('-5000')));
  assert.ok(Number.isNaN(angka('abc')));
});

test('rupiah formats correctly', () => {
  assert.equal(rupiah(5000000), 'Rp 5.000.000');
  assert.equal(rupiah(0), 'Rp 0');
});
