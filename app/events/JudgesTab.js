'use client';

// «Судді» tab — the judging crew of an event, assembled next to the
// roster (before the start) and still editable once the day is running.
//
// Any number of ordinary judges, exactly one head judge. Judges are
// picked from ALL registered players, not from the event's participants:
// whoever is free that day can judge. The crew belongs to the event, so
// the same people cover every league of it.

import PlayerAvatar from '@/components/PlayerAvatar';
import PlayerPicker from '@/components/PlayerPicker';
import styles from './event.module.css';

export default function JudgesTab({ event, judges, busy, post }) {
  const url = `/api/events/${event.id}/judges`;
  const head = judges.find((j) => j.is_head);

  return (
    <div className={styles.panel}>
      <div className={styles.hint}>
        Суддя вводить рахунок. Головний суддя, крім рахунку, переносить гру на інший корт і
        призначає суддю на кожну гру.
      </div>

      <div className={styles.poolTitle}>Бригада ({judges.length})</div>
      {judges.length === 0 && <div className={styles.empty}>Суддів ще немає</div>}
      {judges.map((j) => (
        <div key={j.user_id} className={styles.regRow}>
          <span className={styles.regNames}>
            <PlayerAvatar player={j.users} size={24} />
            {j.users?.full_name || j.user_id.slice(0, 8)}
            {j.is_head && <span className={styles.judgeBadge}>Головний</span>}
          </span>
          <div className={styles.memberControls}>
            <button
              className={styles.btnGhost}
              disabled={busy}
              onClick={() =>
                post(url, j.is_head ? { action: 'clear_head' } : { playerId: j.user_id, action: 'set_head' })
              }
            >
              {j.is_head ? 'Зняти головного' : 'Зробити головним'}
            </button>
            <button
              className={styles.miniRemove}
              disabled={busy}
              title="Прибрати з бригади"
              onClick={() => post(url, { playerId: j.user_id, action: 'remove' })}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {judges.length > 0 && !head && (
        <div className={styles.hint} style={{ marginTop: 10 }}>
          Головного суддю ще не призначено.
        </div>
      )}

      <div className={styles.poolTitle} style={{ marginTop: 18 }}>
        Додати суддю
      </div>
      <PlayerPicker
        excludeIds={judges.map((j) => j.user_id)}
        disabled={busy}
        onPick={(p) => post(url, { playerId: p.id, action: 'add' })}
      />
    </div>
  );
}
