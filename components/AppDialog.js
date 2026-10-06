'use client';

// The app's own question / message window, instead of the browser's
// confirm() and alert(): those are grey system boxes (on iPhone the whole
// page turns grey behind them) that look nothing like the app.
//
//   if (!(await appConfirm('Видалити турнір?', { okText: 'Видалити', danger: true }))) return;
//   appAlert('Запрошення надіслано ✅');
//
// <AppDialogHost /> is mounted once in the root layout; it shows one
// window at a time, the next waits in a queue. Escape / a tap outside =
// «Скасувати» (components/DialogA11y handles the keyboard).

import { useEffect, useState } from 'react';
import styles from './AppDialog.module.css';

const queue = [];
let notify = null;

function push(item) {
  return new Promise((resolve) => {
    queue.push({ ...item, resolve });
    notify?.();
  });
}

/** Resolves true on «OK», false on «Скасувати» / outside tap / Escape. */
export function appConfirm(text, { title = null, okText = 'Так', cancelText = 'Скасувати', danger = false } = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return push({ kind: 'confirm', text, title, okText, cancelText, danger });
}

/** Resolves when the window is closed. */
export function appAlert(text, { title = null, okText = 'Добре' } = {}) {
  if (typeof window === 'undefined') return Promise.resolve();
  return push({ kind: 'alert', text, title, okText });
}

export default function AppDialogHost() {
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    notify = () => setCurrent((c) => c || queue[0] || null);
    notify();
    return () => {
      notify = null;
    };
  }, []);

  if (!current) return null;

  function close(answer) {
    queue.shift();
    current.resolve(current.kind === 'confirm' ? answer : undefined);
    setCurrent(queue[0] || null);
  }

  return (
    <div className={styles.backdrop} data-dismiss onClick={() => close(false)}>
      <div
        className={styles.box}
        role="dialog"
        aria-modal="true"
        aria-label={current.title || 'Повідомлення'}
        onClick={(e) => e.stopPropagation()}
      >
        {current.title && <div className={styles.title}>{current.title}</div>}
        <div className={styles.text}>{current.text}</div>
        <div className={styles.buttons}>
          {current.kind === 'confirm' && (
            <button type="button" className={styles.cancel} onClick={() => close(false)}>
              {current.cancelText}
            </button>
          )}
          <button
            type="button"
            className={`${styles.ok} ${current.danger ? styles.danger : ''}`}
            onClick={() => close(true)}
          >
            {current.okText}
          </button>
        </div>
      </div>
    </div>
  );
}
