// A tiny in-memory cache that lives for the whole browser tab, not for
// one page. App Router keeps the JS context alive across client-side
// navigations, so whatever is stored here is still there when the player
// comes back to a section: the last-known data renders instantly and a
// fresh fetch refreshes it quietly underneath (stale-while-revalidate).
//
// Page-level useRef caches were lost the moment the page unmounted —
// i.e. on every bottom-nav tap — which is why every section reloaded
// from a blank state each time.

const store = new Map();

export function getCached(key) {
  return store.has(key) ? store.get(key) : undefined;
}

export function setCached(key, value) {
  store.set(key, value);
  return value;
}

/**
 * Deduplicates concurrent loads of the same key and keeps the result for
 * `ttlMs`. Use for small reference data many components need at once
 * (the current seasons, say) so the page fires one request, not five.
 */
const inflight = new Map();
export function memoize(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(loader)
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function invalidate(prefix) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
