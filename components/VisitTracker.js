'use client';

// «I'm here» for the visitor statistics in admin → Огляд (migration 073).
// Straight to the database (no Vercel function per visit), at most once
// every few minutes per open tab, and again when the app comes back to
// the screen. The device id is a random string kept on the phone — no
// name, no address; once logged in, the database adds the player's id.
// Never blocks or breaks anything: every failure is silent.

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

const EVERY_MS = 4 * 60 * 1000;
const KEY = 'amk_vid';
let lastSent = 0;
let lastUser = undefined;

function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // private mode etc. — not counted, nothing breaks
  }
}

function ping(force = false) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!force && Date.now() - lastSent < EVERY_MS) return;
  const id = deviceId();
  if (!id) return;
  lastSent = Date.now();
  try {
    createClient()
      .rpc('track_visit', { p_visitor: id })
      .then(
        () => {},
        () => {}
      );
  } catch {
    /* never mind */
  }
}

/** Mounted once in AppShell; `userId` — the logged-in player (or null) once known. */
export default function VisitTracker({ pathname, userId, ready }) {
  // a page opened / changed; a fresh login counts at once
  useEffect(() => {
    if (!ready) return;
    const loggedInNow = lastUser !== undefined && lastUser !== userId;
    lastUser = userId;
    ping(loggedInNow);
  }, [pathname, userId, ready]);

  // back on the screen after a while
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && ping();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return null;
}
