'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhone,
  requirePhone,
  isValidPhone,
  formatPhone,
  maskPhone,
  PhoneError,
} = require('../dist/index.js');

test('normalizePhone accepts every common Uzbek input shape', () => {
  const expected = '+998901234567';
  assert.equal(normalizePhone('901234567'), expected);
  assert.equal(normalizePhone('+998 90 123 45 67'), expected);
  assert.equal(normalizePhone('998901234567'), expected);
  assert.equal(normalizePhone('8 90 123 45 67'), expected);
  assert.equal(normalizePhone('(90) 123-45-67'), expected);
});

test('normalizePhone returns null for input that cannot be a number', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('+1234567890123456789'), null);
});

test('requirePhone throws where normalizePhone returns null', () => {
  assert.equal(requirePhone('901234567'), '+998901234567');
  assert.throws(() => requirePhone('123'), PhoneError);
});

test('isValidPhone mirrors normalizePhone', () => {
  assert.equal(isValidPhone('901234567'), true);
  assert.equal(isValidPhone('12'), false);
});

test('formatPhone renders the local display grouping', () => {
  assert.equal(formatPhone('+998901234567'), '+998 90 123 45 67');
});

test('maskPhone keeps only the last two digits', () => {
  const masked = maskPhone('+998901234567');
  assert.match(masked, /67$/);
  assert.equal(masked.includes('9012345'), false);
});
