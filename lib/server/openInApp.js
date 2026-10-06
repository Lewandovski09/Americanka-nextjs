// The hand-over page behind the buttons of the bot and the channel
// («Записатися», invitations): the page always opens in the BROWSER, at
// the site address where the player is signed in.
//
// The site has more than one address (both Vercel addresses of the
// project), and players signed in at either — the accounts are the same
// (one database), but a sign-in is kept per address. So the page visits
// the addresses in turn (a quick redirect each) and opens the page where
// it finds a sign-in (or the home-screen icon's mark,
// components/RegisterSW); otherwise at the main address.
//
// Addresses: NEXT_PUBLIC_SITE_URL (main) + SITE_ALIASES (comma list) +
// always the project's two Vercel addresses.

const DEFAULT_ADDRESSES = ['https://americanka-nextjs-fiqe.vercel.app', 'https://americanka-nextjs.vercel.app'];

export function siteAddresses() {
  const list = [process.env.NEXT_PUBLIC_SITE_URL, ...(process.env.SITE_ALIASES || '').split(',')]
    .map((x) => (x || '').trim().replace(/\/+$/, ''))
    // https only (plain http just for a local test server)
    .filter((x) => /^https:\/\/[a-z0-9.-]+$/i.test(x) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(x));
  return [...new Set([...list, ...DEFAULT_ADDRESSES])];
}

const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/;

export function isSafePath(p) {
  return typeof p === 'string' && SAFE_PATH.test(p) && !p.includes('..');
}

export function openInAppResponse(request, target) {
  if (!isSafePath(target)) return new Response('Not found', { status: 404 });
  const here = new URL(request.url).origin;
  const addresses = [...new Set([here, ...siteAddresses()])];

  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d2347">
<title>Americanka</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d2347;color:#fff;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  .box{max-width:340px;width:100%;padding:24px;text-align:center;box-sizing:border-box}
  .logo{width:64px;height:64px;border-radius:16px;margin:0 auto 14px;display:block}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:0 0 18px;color:rgba(255,255,255,.8)}
  a.btn{display:block;padding:14px 16px;border-radius:999px;background:#e85d4a;color:#fff;
    font-weight:700;text-decoration:none;margin-top:10px}
  a.ghost{background:rgba(255,255,255,.12);font-weight:600}
</style>
</head>
<body>
<div class="box">
  <img class="logo" src="/icons/icon-192.png" alt="">
  <p>Відкриваємо…</p>
  <noscript><a class="btn" href="${target}">Відкрити</a></noscript>
</div>
<script>
(function () {
  var target = ${JSON.stringify(target)};
  var addresses = ${JSON.stringify(addresses)};
  var main = ${JSON.stringify(siteAddresses()[0])};
  var here = location.origin;
  var q = new URLSearchParams(location.search);
  var ok = function (o) { return addresses.indexOf(o) >= 0; };
  var visited = (q.get('v') || '').split(',').filter(ok);
  var sessionAt = ok(q.get('s') || '') ? q.get('s') : '';
  var handedOver = q.get('handoff') === '1';

  var ua = navigator.userAgent || '';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var android = /Android/i.test(ua);
  var hasApp = false;
  try { hasApp = !!localStorage.getItem('americanka:app-installed'); } catch (e) {}
  var signedIn = document.cookie.split(';').some(function (c) {
    c = c.trim(); return c.indexOf('sb-') === 0 && c.indexOf('-auth-token') > 0 && c.split('=')[1];
  });

  if (standalone || handedOver) { location.replace(target); return; }

  // The app is installed from THIS address. Telegram opens a link in the
  // app by itself when the link is on the app's address (the bot's personal
  // messages are — migration 065); landing here means it was not, and from
  // Telegram's Chrome tab an app can't be started at all (a button for it
  // only fell back to the browser). So: the page right away, at this
  // address — the installed app and this browser share the sign-in.
  if (android && hasApp) { location.replace(target); return; }

  if (signedIn && !sessionAt) sessionAt = here;
  visited.push(here);

  // Not here — look at the next address of the site.
  var next = addresses.filter(function (o) { return visited.indexOf(o) < 0; })[0];
  if (next) {
    location.replace(next + '/open?to=' + encodeURIComponent(target)
      + '&v=' + encodeURIComponent(visited.join(',')) + '&s=' + encodeURIComponent(sessionAt));
    return;
  }

  // Every address checked, no app: open where the player is signed in.
  // (iPhone too: it can't open a home-screen app — straight to the page.)
  location.replace((sessionAt || main) + target);
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * The one button the bot puts under a message. The link goes over plain
 * http on purpose: no installed app claims http links, so Telegram always
 * opens it in the browser; the site switches to https by itself, and the
 * hand-over page opens the page where the player is signed in.
 */
export function browserButton(text, url) {
  return { inline_keyboard: [[{ text, url: url.replace(/^https:/, 'http:') }]] };
}

/** `${site}/open?to=/path` — a link through the hand-over page. */
export function appLink(site, path) {
  return `${site}/open?to=${encodeURIComponent(path)}`;
}
