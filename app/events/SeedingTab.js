'use client';

// «Посів» tab — shared by the pre-start settings page (next to
// «Розподіл» / «Налаштування») and the running-event one, since a league
// inside a live event can still be waiting for its own start.
//
// The list is the category roster in seed order — position 1 at the top.
// Until the admin saves, the numbers shown are only a suggestion (the
// distribution order); `slot_index` in the database stays empty. Saving
// writes the whole column at once, and the bracket builder reads it when
// the category starts — an unsaved league is seeded by that same
// distribution order, so this tab is optional. After the start the
// seeding is baked into the matches, so the list becomes read-only.
//
// A Double Elimination category shows its WHOLE grid (16 or 32 places),
// so a short field leaves visible empty places — dragged wherever the
// admin wants them. Each one becomes a round-1 bye, i.e. a free pass for
// whoever sits opposite it in the bracket. Every other system plays
// exactly the roster it has, so its list is a dense 1…N (see seedSlots).
//
// Reordering runs on Pointer Events, not HTML5 drag-and-drop: the latter
// never fires on a phone, which is where the seeding is actually done.
// Touch drags from the ☰ handle (the only spot where scrolling is
// disabled), a mouse can grab the row anywhere.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerAvatar from '@/components/PlayerAvatar';
import { placeIntoSlots, seedCapacity } from '@/lib/formats/seedSlots';
import { seedRoster } from './shared';
import styles from './event.module.css';

// How close to the top/bottom of the screen a drag has to get before the
// page starts following it, and how fast it then scrolls.
const EDGE = 70;
const EDGE_SPEED = 12;

// The signature the «unsaved changes» check compares: only WHERE the real
// rows sit matters — swapping two empty places changes nothing.
const signature = (list) => list.map((r) => (r.empty ? '' : r.key)).join('|');

export default function SeedingTab({ category, isPair, busy, post }) {
  const initial = useMemo(() => {
    const rows = seedRoster(category, isPair);
    // The empty places are ordinary list items (they drag and renumber
    // like everybody else); their keys only have to stay stable while the
    // list is being edited, which they do — the array is reordered, the
    // items themselves are not rebuilt.
    return placeIntoSlots(rows, seedCapacity(category)).map(
      (row, i) => row || { key: `__empty_${i}`, empty: true, name: 'Вільне місце (бай)', player: null }
    );
  }, [category, isPair]);
  const [order, setOrder] = useState(initial);
  const [menuFor, setMenuFor] = useState(null);
  const [moving, setMoving] = useState(null); // row being placed via the modal
  const [saved, setSaved] = useState(false);
  const [drag, setDrag] = useState(null); // { key, from, to, dy, height }
  // One frame right after a drop: the rows take their new places in the
  // layout AND lose their transforms at the same moment, so the
  // transition has to be off or every shifted row would slide in from a
  // position it never visually occupied.
  const [settling, setSettling] = useState(false);

  const locked = category.status !== 'scheduled';
  const savedOrder = useMemo(() => signature(initial), [initial]);

  // Mirrors of the drag state for the pointer handlers, which must not
  // re-subscribe on every move.
  const dragRef = useRef(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const rowRefs = useRef({});
  const scrollRaf = useRef(0);

  // Re-sync whenever the roster comes back from the server (another tab
  // moved somebody, or our own save just landed).
  useEffect(() => {
    setOrder(initial);
    setMenuFor(null);
  }, [initial]);

  const dirty = signature(order) !== savedOrder;
  const unseeded = initial.some((r) => !r.empty && r.slotIndex == null);
  const byes = initial.filter((r) => r.empty).length;

  const moveTo = useCallback((fromIdx, toIdx) => {
    setSaved(false);
    setOrder((prev) => {
      const next = [...prev];
      const [row] = next.splice(fromIdx, 1);
      next.splice(Math.max(0, Math.min(next.length, toIdx)), 0, row);
      return next;
    });
  }, []);

  // ── Drag ─────────────────────────────────────────────────────────
  // Positions are kept in PAGE coordinates so that auto-scrolling the
  // window during a drag doesn't shift the reference point under us.

  const applyPointer = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const pageY = d.clientY + window.scrollY;
    const dy = pageY - d.startPageY;
    const to = Math.max(
      0,
      Math.min(orderRef.current.length - 1, d.from + Math.round(dy / d.height))
    );
    dragRef.current = { ...d, dy, to };
    setDrag({ key: d.key, from: d.from, to, dy, height: d.height });
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = 0;
  }, []);

  const tickAutoScroll = useCallback(() => {
    const d = dragRef.current;
    if (!d) return stopAutoScroll();
    const fromTop = d.clientY;
    const fromBottom = window.innerHeight - d.clientY;
    let step = 0;
    if (fromTop < EDGE) step = -EDGE_SPEED * (1 - fromTop / EDGE);
    else if (fromBottom < EDGE) step = EDGE_SPEED * (1 - fromBottom / EDGE);
    if (step) {
      window.scrollBy(0, step);
      applyPointer(); // clientY is unchanged, pageY moved with the scroll
    }
    scrollRaf.current = requestAnimationFrame(tickAutoScroll);
  }, [applyPointer, stopAutoScroll]);

  function startDrag(e, key, index) {
    if (locked || busy || dragRef.current) return;
    const el = rowRefs.current[key];
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const height = el.getBoundingClientRect().height;
    dragRef.current = {
      pointerId: e.pointerId,
      key,
      from: index,
      to: index,
      height,
      startPageY: e.clientY + window.scrollY,
      clientY: e.clientY,
      dy: 0,
    };
    setDrag({ key, from: index, to: index, dy: 0, height });
    setMenuFor(null);
    scrollRaf.current = requestAnimationFrame(tickAutoScroll);
  }

  function onDragMove(e) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    dragRef.current = { ...d, clientY: e.clientY };
    applyPointer();
  }

  function endDrag(e) {
    const d = dragRef.current;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    dragRef.current = null;
    stopAutoScroll();
    setDrag(null);
    if (d.to !== d.from) {
      setSettling(true);
      moveTo(d.from, d.to);
      requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
    }
  }

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  // Where a row sits while a drag is in flight: the dragged one follows
  // the pointer, everyone between its old and new place steps aside.
  function shiftOf(i) {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.height;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.height;
    return 0;
  }

  // The place a row would get if the drag ended now — so the numbers
  // match what the eye sees instead of lagging a position behind.
  function placeOf(i) {
    if (!drag) return i;
    if (i === drag.from) return drag.to;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return i - 1;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return i + 1;
    return i;
  }

  async function save() {
    const ok = await post(`/api/admin/categories/${category.id}/seeding`, {
      // An empty place is sent as a hole so the server can keep the
      // places after it — that is the whole point of the grid.
      order: order.map((r) => (r.empty ? null : r.key)),
    });
    if (ok) setSaved(true);
  }

  if (order.every((r) => r.empty)) {
    return <div className={styles.empty}>У категорії ще немає {isPair ? 'пар' : 'учасників'}</div>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.hint}>
        {locked
          ? 'Категорію вже розпочато — посів зафіксовано в сітці.'
          : unseeded
          ? 'Посів не збережено — за замовчуванням порядок такий, як показано нижче: черга заявок. Змініть і збережіть за потреби.'
          : 'Посів №1 грає з останнім номером, №2 — з передостаннім і так далі.'}
      </div>
      {!locked && byes > 0 && (
        <div className={styles.hint}>
          Сітка на {initial.length} — {initial.length - byes}{' '}
          {isPair ? 'пар заявлено' : 'учасників заявлено'}, {byes} вільних місць. Перетягніть їх туди,
          де хочете бачити бай: суперник вільного місця проходить перше коло без гри.
        </div>
      )}

      <div className={styles.seedHead}>
        <span />
        <span>Місце</span>
        <span>{isPair ? 'Пара' : 'Гравець'}</span>
      </div>

      <div className={drag ? styles.seedListDragging : undefined}>
        {order.map((row, i) => {
          const isDragged = drag?.key === row.key;
          const shift = shiftOf(i);
          return (
            <div
              key={row.key}
              ref={(el) => {
                rowRefs.current[row.key] = el;
              }}
              className={`${styles.seedRow} ${isDragged ? styles.seedRowDragging : ''} ${
                row.empty ? styles.seedRowEmpty : ''
              }`}
              style={{
                transform: shift ? `translateY(${shift}px)` : undefined,
                // The dragged row must not lag behind the finger; the
                // ones stepping aside are the animation.
                transition: isDragged || settling ? 'none' : undefined,
              }}
              // A mouse can grab the row anywhere — except the ⋮ menu.
              onPointerDown={(e) => {
                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                if (e.target.closest(`.${styles.seedMenuWrap}`)) return;
                startDrag(e, row.key, i);
              }}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {locked ? (
                <span />
              ) : (
                <button
                  type="button"
                  className={styles.seedGrip}
                  disabled={busy}
                  aria-label="Перетягнути"
                  // Touch drags start here, and only here: this is the
                  // one element where the browser's own scrolling is off.
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startDrag(e, row.key, i);
                  }}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  ☰
                </button>
              )}

              <span className={styles.seedNum}>{placeOf(i) + 1}</span>
              <span className={`${styles.seedName} ${row.empty ? styles.seedNameEmpty : ''}`}>
                {row.player && <PlayerAvatar player={row.player} size={24} />}
                {row.name}
              </span>

              {!locked && (
                <span className={styles.seedMenuWrap}>
                  <button
                    className={styles.seedDots}
                    disabled={busy || !!drag}
                    onClick={() => setMenuFor(menuFor === row.key ? null : row.key)}
                    aria-label="Дії"
                  >
                    ⋮
                  </button>
                  {menuFor === row.key && (
                    <span className={styles.seedMenu}>
                      <button
                        className={styles.seedMenuItem}
                        onClick={() => {
                          setMoving({ row, index: i });
                          setMenuFor(null);
                        }}
                      >
                        Змінити місце на…
                      </button>
                      <button
                        className={styles.seedMenuItem}
                        disabled={i === 0}
                        onClick={() => {
                          moveTo(i, i - 1);
                          setMenuFor(null);
                        }}
                      >
                        ↑ Вище
                      </button>
                      <button
                        className={styles.seedMenuItem}
                        disabled={i === order.length - 1}
                        onClick={() => {
                          moveTo(i, i + 1);
                          setMenuFor(null);
                        }}
                      >
                        ↓ Нижче
                      </button>
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!locked && (
        <div className={styles.seedBar}>
          {dirty && <span className={styles.seedDirty}>Є незбережені зміни</span>}
          {!dirty && saved && <span className={styles.seedOk}>✓ Посів збережено</span>}
          <button className={styles.btnPrimary} disabled={busy || !dirty} onClick={save}>
            {busy ? 'Збереження…' : 'Зберегти посів'}
          </button>
        </div>
      )}

      {moving && (
        <MoveDialog
          row={moving.row}
          from={moving.index}
          total={order.length}
          onCancel={() => setMoving(null)}
          onConfirm={(place) => {
            moveTo(moving.index, place - 1);
            setMoving(null);
          }}
        />
      )}
    </div>
  );
}

// «Змінити місце на…» — the row takes the requested place and everybody
// between the old and the new position shifts by one.
function MoveDialog({ row, from, total, onCancel, onConfirm }) {
  const [value, setValue] = useState(String(from + 1));
  const place = Number(value);
  const valid = Number.isInteger(place) && place >= 1 && place <= total;

  return (
    <div className={styles.modalBack} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>{row.name}</div>
        <div className={styles.hint}>Поточне місце: {from + 1}. Куди перемістити (1–{total})?</div>
        <input
          className={styles.modalInput}
          type="number"
          min={1}
          max={total}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onConfirm(place);
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className={styles.modalRow}>
          <button className={styles.btnGhost} onClick={onCancel}>
            Скасувати
          </button>
          <button className={styles.btnPrimary} disabled={!valid} onClick={() => onConfirm(place)}>
            Перемістити
          </button>
        </div>
      </div>
    </div>
  );
}
