const SITES = Object.freeze({
  pos: { title: 'RESTOR POS', origin: 'https://pos.restor.uz', appId: 'uz.restor.pos' },
  admin: { title: 'RESTOR Admin', origin: 'https://app.restor.uz', appId: 'uz.restor.admin' },
});

function isAppUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function allowPermission(permission, requestingUrl, origin) {
  return permission === 'clipboard-sanitized-write' && isAppUrl(requestingUrl, origin);
}

module.exports = { SITES, isAppUrl, isExternalUrl, allowPermission };
