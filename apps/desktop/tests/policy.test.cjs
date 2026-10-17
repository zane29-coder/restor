const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SITES, isAppUrl, isExternalUrl, allowPermission } = require('../policy.cjs');
test('navigation remains inside the selected HTTPS app origin', () => {
  assert.equal(isAppUrl('https://pos.restor.uz/orders/1', SITES.pos.origin), true);
  for (const url of ['https://pos.restor.uz.evil.test', 'http://pos.restor.uz', 'https://evil@pos.restor.uz', 'javascript:alert(1)', 'file:///C:/Windows', 'blob:https://pos.restor.uz/fake', 'https://app.restor.uz']) assert.equal(isAppUrl(url, SITES.pos.origin), false, url);
});
test('external links cannot invoke executables or local protocols', () => {
  assert.equal(isExternalUrl('https://restor.uz'), true);
  for (const url of ['file:///C:/a.exe', 'ms-settings:privacy', 'javascript:alert(1)', 'https://user:pass@restor.uz', 'http://restor.uz', 'invalid']) assert.equal(isExternalUrl(url), false, url);
});
test('copy buttons can write text only for the trusted app; reads and hardware stay denied', () => {
  assert.equal(allowPermission('clipboard-sanitized-write', SITES.admin.origin, SITES.admin.origin), true);
  assert.equal(allowPermission('clipboard-sanitized-write', 'https://evil.test', SITES.admin.origin), false);
  for (const permission of ['clipboard-read', 'media', 'geolocation', 'usb']) assert.equal(allowPermission(permission, SITES.admin.origin, SITES.admin.origin), false);
});
