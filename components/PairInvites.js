'use client';

// Pair invitations for one event (migration 058). Someone who found a
// player through «Шукаю пару» asks to play with them; the invited player
// sees it here and accepts or declines — nobody is put into a pair
// without saying yes. The inviter sees their pending request and can
// take it back.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './PairInvites.module.css';

export default function PairInvites({ eventId, version = 0, onChanged }) {
  const { player } = useCurrentPlayer();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!player?.id || !eventId) return;
    let alive = true;
    createClient()
      .from('pair_invites')
      .select(
        `id, from_user, to_user, status, created_at,
         sender:users!pair_invites_from_user_fkey(id, full_name, photo_url, elo),
         receiver:users!pair_invites_to_user_fkey(id, full_name, photo_url, elo)`
      )
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .or(`from_user.eq.${player.id},to_user.eq.${player.id}`)
      .order('created_at', { ascending: true })
      .then(({ data }) => alive && setRows(data || []));
    return () => {
      alive = false;
    };
  }, [eventId, player?.id, version, reload]);

  if (!player || rows.length === 0) return null;

  async function act(id, action) {
    setBusy(id);
    setError('');
    const res = await fetch(`/api/events/${eventId}/invites/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!data.success) setError(data.error || 'Сталася помилка');
    setReload((n) => n + 1);
    if (data.success) onChanged?.();
  }

  const incoming = rows.filter((r) => r.to_user === player.id);
  const outgoing = rows.filter((r) => r.from_user === player.id);

  return (
    <section className={styles.card}>
      {incoming.length > 0 && <div className={styles.title}>🤝 Вас запрошують у пару</div>}
      {incoming.map((r) => (
        <div key={r.id} className={styles.row}>
          <PlayerAvatar player={r.sender} size={34} />
          <div className={styles.body}>
            <div className={styles.name}>{r.sender?.full_name || 'Гравець'}</div>
            <div className={styles.meta}>{r.sender?.elo != null ? `Ело ${r.sender.elo} · ` : ''}хоче грати з вами</div>
          </div>
          <div className={styles.btns}>
            <button type="button" className={styles.yes} disabled={busy !== null} onClick={() => act(r.id, 'accept')}>
              Прийняти
            </button>
            <button type="button" className={styles.no} disabled={busy !== null} onClick={() => act(r.id, 'decline')}>
              Ні
            </button>
          </div>
        </div>
      ))}

      {outgoing.length > 0 && <div className={styles.title}>⏳ Очікують відповіді</div>}
      {outgoing.map((r) => (
        <div key={r.id} className={styles.row}>
          <PlayerAvatar player={r.receiver} size={34} />
          <div className={styles.body}>
            <div className={styles.name}>{r.receiver?.full_name || 'Гравець'}</div>
            <div className={styles.meta}>ваше запрошення ще не прийняте</div>
          </div>
          <button type="button" className={styles.no} disabled={busy !== null} onClick={() => act(r.id, 'cancel')}>
            Скасувати
          </button>
        </div>
      ))}
      {error && <div className={styles.error}>{error}</div>}
    </section>
  );
}
