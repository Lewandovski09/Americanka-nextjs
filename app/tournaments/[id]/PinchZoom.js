'use client';

// A table that opens fitted to the screen width — everything visible at
// once, no sideways scrolling — and is zoomed with two fingers, the way a
// photo is. Replaces the old «− 100% +» buttons.
//
// Why a component and not the browser's own pinch: the app's viewport is
// locked (maximumScale: 1, so iOS does not jump-zoom into every input and
// the installed app feels native), which also switches the page pinch off
// on Android. Here the pinch only scales the table.
//
// transform: scale (not CSS zoom) so the natural size can be measured
// reliably; the wrapper's height follows the scaled height so there is no
// blank space under a shrunk table.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX_ZOOM = 3; // relative to «fits the screen»

export default function PinchZoom({ children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0, box: 0 }); // natural table size, wrapper width
  const [userScale, setUserScale] = useState(null); // null = fitted
  const gesture = useRef(null);

  const measure = useCallback(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const next = { w: inner.offsetWidth, h: inner.offsetHeight, box: outer.clientWidth };
    // Only on a real change — this runs after every render.
    setSize((prev) => (prev.w === next.w && prev.h === next.h && prev.box === next.box ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, children]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (outerRef.current) ro.observe(outerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const fit = size.w > 0 && size.box > 0 ? Math.min(1, size.box / size.w) : 1;
  const scale = userScale ?? fit;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Two-finger pinch. Non-passive listeners: the move must be able to
  // stop the page from scrolling while the fingers are zooming.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    function onStart(e) {
      if (e.touches.length === 2) {
        gesture.current = { d: dist(e.touches), s: scaleRef.current };
      }
    }
    function onMove(e) {
      if (e.touches.length !== 2 || !gesture.current) return;
      e.preventDefault();
      const next = gesture.current.s * (dist(e.touches) / gesture.current.d);
      const min = fitRef.current;
      const max = fitRef.current * MAX_ZOOM;
      const clamped = Math.min(max, Math.max(min, next));
      // Back at the fitted size = follow the screen again on rotation.
      setUserScale(Math.abs(clamped - min) < 0.01 ? null : clamped);
    }
    function onEnd(e) {
      if (e.touches.length < 2) gesture.current = null;
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      style={{
        marginTop: 8,
        overflowX: scale > fit + 0.001 ? 'auto' : 'hidden',
        overflowY: 'hidden',
        height: size.h ? size.h * scale : undefined,
        touchAction: 'pan-x pan-y',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        ref={innerRef}
        style={{
          width: 'max-content',
          // A narrow table still spans the screen; a wide one is measured
          // at its own width and scaled down to fit.
          minWidth: size.box || undefined,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
