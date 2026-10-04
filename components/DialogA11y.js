'use client';

// Keyboard behaviour for every popup in the app, in one place, so no
// popup has to wire it up by hand. A popup is an element with
// role="dialog" whose backdrop carries data-dismiss (a tap on the
// backdrop already closes it).
//
// • When a popup opens, focus moves into it; when it closes, focus
//   returns to whatever opened it. Opened from the keyboard, focus goes
//   to its first field or button; opened by a tap, to the popup itself —
//   so a phone does not throw up the on-screen keyboard uninvited.
// • Tab / Shift+Tab stay inside the top-most popup instead of wandering
//   to the page behind it.
// • Escape closes the top-most popup (taps its backdrop).
//
// Mounted once in the root layout — so it works on every page, the
// login and registration screens included. Renders nothing.

import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function topDialog() {
  const all = document.querySelectorAll('[role="dialog"]');
  return all.length ? all[all.length - 1] : null;
}

function focusablesIn(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export default function DialogA11y() {
  useEffect(() => {
    const openers = new WeakMap(); // dialog → element focused before it opened
    const known = new Set();
    let viaKeyboard = false;
    const onPointer = () => (viaKeyboard = false);

    function sync() {
      const now = new Set(document.querySelectorAll('[role="dialog"]'));
      // newly opened
      now.forEach((d) => {
        if (known.has(d)) return;
        known.add(d);
        openers.set(d, document.activeElement);
        if (!d.contains(document.activeElement)) {
          const first = viaKeyboard ? focusablesIn(d)[0] : null;
          if (!d.hasAttribute('tabindex')) d.setAttribute('tabindex', '-1');
          (first || d).focus({ preventScroll: true });
        }
      });
      // closed
      [...known].forEach((d) => {
        if (now.has(d)) return;
        known.delete(d);
        const back = openers.get(d);
        if (back && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
      });
    }

    function onKey(e) {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') viaKeyboard = true;
      if (e.key === 'Escape') {
        const backdrops = document.querySelectorAll('[data-dismiss]');
        const top = backdrops[backdrops.length - 1];
        if (top) {
          e.preventDefault();
          top.click();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const d = topDialog();
      if (!d) return;
      const items = focusablesIn(d);
      if (items.length === 0) {
        e.preventDefault();
        d.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = d.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }

    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    sync();
    return () => {
      mo.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  return null;
}
