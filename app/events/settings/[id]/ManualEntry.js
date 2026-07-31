'use client';

// «Заявити вручну» — the admin signs people up straight into the open
// league, without waiting for them to apply in the app. Pair formats ask
// for two players (or one, when the pair is still looking for a partner);
// solo formats for one.
//
// The picked people land in the roster of the league currently open on
// the «Розподіл» tab, and get an application row marked as distributed
// there — so «Перенести»/«✕» work on them like on anyone else.
//
// Only players the event has not taken yet are offered: anyone with an
// open application (their own or as somebody's partner) or a place in
// any of the leagues is out of the list.

import { useState } from 'react';
import PlayerAvatar from '@/components/PlayerAvatar';
import PlayerPicker from '@/components/PlayerPicker';
import { GenderMark } from '../../shared';
import styles from '../../event.module.css';

export default function ManualEntry({ category, isPair, mix, takenIds = [], busy, post }) {
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const [alone, setAlone] = useState(false);

  const catLabel = `${category.gender === 'M' ? 'Ч · ' : category.gender === 'F' ? 'Ж · ' : ''}${
    category.category_label || 'категорію'
  }`;

  function reset() {
    setP1(null);
    setP2(null);
    setAlone(false);
  }

  async function submit() {
    const ok = await post('/api/admin/members/add', {
      categoryId: category.id,
      playerId: p1.id,
      partnerId: alone ? null : p2?.id || null,
      seekingPartner: isPair && alone,
    });
    if (ok) reset();
  }

  const ready = !!p1 && (!isPair || alone || !!p2);

  // Mix takes a man in the first column and a woman in the second; a
  // same-gender league takes whoever it is split by. Narrowing the
  // pickers keeps an impossible pair from being entered at all.
  const gender1 = mix ? 'M' : category.gender || null;
  const gender2 = mix ? 'F' : category.gender || null;

  return (
    <div className={styles.poolBox}>
      <div className={styles.poolTitle}>Заявити вручну — {catLabel}</div>
      <div className={styles.hint}>
        {isPair
          ? 'Виберіть обох гравців — пара одразу потрапляє у склад ліги.'
          : 'Виберіть гравця — він одразу потрапляє у склад ліги.'}
      </div>

      <div className={isPair && !alone ? styles.manualGrid : ''}>
        <Slot
          picked={p1}
          gender={gender1}
          excludeIds={[...takenIds, p2?.id].filter(Boolean)}
          busy={busy}
          onPick={setP1}
          onClear={() => setP1(null)}
        />
        {isPair && !alone && (
          <Slot
            picked={p2}
            gender={gender2}
            excludeIds={[...takenIds, p1?.id].filter(Boolean)}
            busy={busy}
            onPick={setP2}
            onClear={() => setP2(null)}
          />
        )}
      </div>

      {isPair && (
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={alone}
            onChange={(e) => {
              setAlone(e.target.checked);
              if (e.target.checked) setP2(null);
            }}
          />
          <span>Без напарника (шукає пару)</span>
        </label>
      )}

      <button className={styles.btnPrimary} disabled={busy || !ready} onClick={submit}>
        {busy ? 'Додавання…' : 'Заявити'}
      </button>
    </div>
  );
}

function Slot({ picked, gender, excludeIds, busy, onPick, onClear }) {
  if (!picked) {
    return <PlayerPicker gender={gender} excludeIds={excludeIds} disabled={busy} onPick={onPick} />;
  }
  return (
    <div className={styles.regRow}>
      <span className={styles.regNames}>
        <GenderMark gender={picked.gender} />
        <PlayerAvatar player={picked} size={24} />
        {picked.full_name}
      </span>
      <button className={styles.miniRemove} disabled={busy} title="Вибрати іншого" onClick={onClear}>
        ✕
      </button>
    </div>
  );
}
