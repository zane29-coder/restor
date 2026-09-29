'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addMoney,
  subtractMoney,
  multiplyMoney,
  applyPercentage,
  calculateDiscount,
  splitMoney,
  formatMoney,
  parseMoney,
  calculateChange,
  assertAmount,
  MoneyError,
} = require('../dist/index.js');

test('addMoney sums integer minor units', () => {
  assert.equal(addMoney(100000, 56000), 156000);
  assert.equal(addMoney(), 0);
});

test('addMoney rejects floats — money never becomes a float', () => {
  assert.throws(() => addMoney(100.5, 1), MoneyError);
});

test('assertAmount rejects negatives and unsafe integers', () => {
  assert.throws(() => assertAmount(-1), MoneyError);
  assert.throws(() => assertAmount(Number.MAX_SAFE_INTEGER + 2), MoneyError);
  assert.equal(assertAmount(0), 0);
});

test('subtractMoney clamps at zero so a total never goes negative', () => {
  assert.equal(subtractMoney(10000, 3000), 7000);
  assert.equal(subtractMoney(3000, 10000), 0);
});

test('multiplyMoney requires a whole quantity', () => {
  assert.equal(multiplyMoney(25000, 3), 75000);
  assert.throws(() => multiplyMoney(25000, 1.5), MoneyError);
});

test('applyPercentage rounds half-up', () => {
  assert.equal(applyPercentage(1005, 50), 503); // 502.5 -> 503
  assert.equal(applyPercentage(100000, 20), 20000);
  assert.throws(() => applyPercentage(1000, 120), MoneyError);
});

test('calculateDiscount honours the cap and never exceeds the amount', () => {
  assert.equal(calculateDiscount(200000, 20, 30000), 30000);
  assert.equal(calculateDiscount(200000, 20, null), 40000);
  assert.equal(calculateDiscount(1000, 100, 999999), 1000);
});

test('splitMoney distributes the remainder and sums back exactly', () => {
  assert.deepEqual(splitMoney(100, 3), [34, 33, 33]);
  const parts = splitMoney(156000, 7);
  assert.equal(parts.reduce((a, b) => a + b, 0), 156000);
});

test('formatMoney groups UZS without decimals', () => {
  assert.equal(formatMoney(156000), '156 000 UZS');
  assert.equal(formatMoney(156000, 'UZS', { withCurrency: false }), '156 000');
});

test('parseMoney reverses user-entered formatting', () => {
  assert.equal(parseMoney('156 000'), 156000);
  // UZS has no subunit, so a comma can only be a thousands separator.
  assert.equal(parseMoney('156,000 UZS'), 156000);
  assert.equal(parseMoney('156.000'), 156000);
  assert.throws(() => parseMoney('abc'), MoneyError);
  assert.throws(() => parseMoney(''), MoneyError);
});

test('parseMoney treats the final separator as decimal only for subunit currencies', () => {
  assert.equal(parseMoney('12.50', 'USD'), 1250);
  assert.equal(parseMoney('12,50', 'USD'), 1250);
  // Three trailing digits cannot be cents, so this is grouping.
  assert.equal(parseMoney('1,234', 'USD'), 123400);
  assert.equal(parseMoney('1,234.56', 'USD'), 123456);
});

test('parseMoney keeps a negative sign for adjustments', () => {
  assert.equal(parseMoney('-50 000'), -50000);
});

test('calculateChange never returns a negative', () => {
  assert.equal(calculateChange(200000, 156000), 44000);
  assert.equal(calculateChange(100000, 156000), 0);
});
