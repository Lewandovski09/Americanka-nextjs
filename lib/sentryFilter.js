// Errors that are not the app's own — scripts a visitor's browser puts
// into the page (extensions, userscripts, in-app browsers). Dropped in
// the browser before they reach Sentry (instrumentation-client.js), so
// every Sentry e-mail is about the site itself.
//
// A frame from the app's own files (/_next/…) always keeps the event:
// if an extension makes OUR code fail, that is still worth seeing.
// Pure (see sentryFilter.test).

export const FOREIGN_SCRIPT_RE =
  /^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:|^webkit-masked-url:|\/executors\/\d+\.js|^(app|webpack):\/\/\/executors\//i;

const frameFiles = (event) =>
  (event?.exception?.values || [])
    .flatMap((v) => v?.stacktrace?.frames || [])
    .map((f) => String(f?.filename || f?.abs_path || ''))
    .filter(Boolean);

/** True when the error comes only from scripts that are not the app's. */
export function isForeignError(event) {
  const files = frameFiles(event);
  if (files.length === 0) return false;
  if (files.some((f) => f.includes('/_next/'))) return false;
  return files.some((f) => FOREIGN_SCRIPT_RE.test(f));
}

/** Sentry's beforeSend: drop foreign errors, keep everything else. */
export function dropForeignErrors(event) {
  return isForeignError(event) ? null : event;
}
