// The «Записатися» button of a Telegram announcement opens this, not the
// registration page directly. Its only job: hand the tournament over to
// the installed app when there is one.
//
// • Already inside the installed app → straight to the registration page.
// • Android → the link is passed to the system (an intent:// link). An
//   installed Americanka app owns links to this site, so Android opens the
//   app; without it, the browser opens (Chrome, where the player is
//   usually signed in — not Telegram's own browser, where they never are).
//   If the hand-over does not happen (some in-app browsers ignore it),
//   the registration page opens right here after a moment.
// • iPhone / iPad / computer → the registration page. iOS has no way for a
//   link to open an app added to the home screen; the page says how to
//   find the tournament in the app.
//
// Plain HTML, no React: it is on screen for a split second.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GET(request, { params }) {
  const id = String(params.eventId || '');
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const target = `/events/register/${id}`;
  // Second visit, after the hand-over landed in the browser → no new hand-over.
  const handedOver = url.searchParams.get('handoff') === '1';

  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d2347">
<title>Americanka — відкриваємо…</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d2347;color:#fff;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  .box{max-width:340px;padding:24px;text-align:center}
  .logo{width:64px;height:64px;border-radius:16px;margin:0 auto 14px;display:block}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:0 0 16px;color:rgba(255,255,255,.8)}
  a.btn{display:block;padding:13px 16px;border-radius:999px;background:#e85d4a;color:#fff;
    font-weight:700;text-decoration:none;margin-top:10px}
  a.ghost{background:rgba(255,255,255,.12)}
  .hint{display:none;font-size:13px;margin-top:14px;color:rgba(255,255,255,.7)}
</style>
</head>
<body>
<div class="box">
  <img class="logo" src="/icons/icon-192.png" alt="">
  <h1>Відкриваємо турнір…</h1>
  <p id="msg">Зараз відкриється застосунок Americanka.</p>
  <a class="btn" id="go" href="${target}">Записатися на турнір</a>
  <div class="hint" id="ios">Додали Americanka на головний екран? Відкрийте застосунок звідти — турнір уже на головній.</div>
</div>
<script>
(function () {
  var target = ${JSON.stringify(target)};
  var handedOver = ${handedOver ? 'true' : 'false'};
  var ua = navigator.userAgent || '';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var android = /Android/i.test(ua);
  var ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (standalone || handedOver || (!android && !ios)) { location.replace(target); return; }

  if (android) {
    var back = location.origin + target;
    location.href = 'intent://' + location.host + location.pathname + '?handoff=1'
      + '#Intent;scheme=https;S.browser_fallback_url=' + encodeURIComponent(back) + ';end';
    // Handed over → this page is in the background now; when the player
    // comes back to Telegram they see the button. Not handed over → open here.
    setTimeout(function () {
      if (document.hidden) return;
      location.replace(target);
    }, 1500);
    document.getElementById('msg').textContent = 'Якщо застосунок не відкрився — натисніть кнопку.';
    return;
  }

  // iOS: links can't open a home-screen app — open the page here, with a hint.
  document.getElementById('msg').textContent = 'На iPhone посилання відкривається в браузері.';
  document.getElementById('ios').style.display = 'block';
  setTimeout(function () { location.replace(target); }, 4000);
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
