'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTimeToMinutes,
  formatMinutesAsTime,
  isOpenAt,
  formatElapsed,
  secondsSince,
  minutesBetween,
} = require('../dist/index.js');

const TASHKENT = 'Asia/Tashkent'; // UTC+5, no DST

test('parseTimeToMinutes handles valid and invalid input', () => {
  assert.equal(parseTimeToMinutes('09:30'), 570);
  assert.equal(parseTimeToMinutes('00:00'), 0);
  assert.equal(parseTimeToMinutes('23:59'), 1439);
  assert.equal(parseTimeToMinutes('24:00'), null);
  assert.equal(parseTimeToMinutes('9:5'), null);
  assert.equal(parseTimeToMinutes('nope'), null);
});

test('formatMinutesAsTime pads and wraps', () => {
  assert.equal(formatMinutesAsTime(570), '09:30');
  assert.equal(formatMinutesAsTime(1440), '00:00');
});

test('isOpenAt respects the branch timezone, not the server clock', () => {
  // Monday 09:00 UTC == Monday 14:00 in Tashkent.
  const monday14Tashkent = new Date('2026-09-28T09:00:00Z');
  const hours = [
    { dayOfWeek: 1, opensAt: '10:00', closesAt: '22:00', isClosed: false },
  ];
  assert.equal(isOpenAt(hours, TASHKENT, monday14Tashkent), true);

  // Monday 02:00 UTC == Monday 07:00 Tashkent — before opening.
  const monday07Tashkent = new Date('2026-09-28T02:00:00Z');
  assert.equal(isOpenAt(hours, TASHKENT, monday07Tashkent), false);
});

test('isOpenAt handles a window that crosses midnight', () => {
  // Open Monday 10:00 through Tuesday 02:00.
  const hours = [
    { dayOfWeek: 1, opensAt: '10:00', closesAt: '02:00', isClosed: false },
  ];

  // Tuesday 01:00 Tashkent == Monday 20:00 UTC.
  const tuesday01Tashkent = new Date('2026-09-28T20:00:00Z');
  assert.equal(isOpenAt(hours, TASHKENT, tuesday01Tashkent), true);

  // Tuesday 03:00 Tashkent == Monday 22:00 UTC — the window has closed.
  const tuesday03Tashkent = new Date('2026-09-28T22:00:00Z');
  assert.equal(isOpenAt(hours, TASHKENT, tuesday03Tashkent), false);
});

test('isOpenAt returns false for a day marked closed', () => {
  const hours = [
    { dayOfWeek: 1, opensAt: '10:00', closesAt: '22:00', isClosed: true },
  ];
  assert.equal(isOpenAt(hours, TASHKENT, new Date('2026-09-28T09:00:00Z')), false);
});

test('formatElapsed renders the KDS timer', () => {
  assert.equal(formatElapsed(272), '04:32');
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(3725), '1:02:05');
  assert.equal(formatElapsed(-5), '00:00');
});

test('secondsSince and minutesBetween measure forwards only where expected', () => {
  const start = new Date('2026-09-28T12:30:00Z');
  const now = new Date('2026-09-28T12:34:30Z');
  assert.equal(secondsSince(start, now), 270);
  assert.equal(minutesBetween(start, now), 5); // 4.5 rounds to 5
  assert.equal(secondsSince(now, start), 0);
});
