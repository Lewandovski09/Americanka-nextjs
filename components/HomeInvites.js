'use client';

// On the home page: «Вас запрошують у пару» — open pair invitations for
// the signed-in player (migrations 058, 061), each leading to its
// tournament, where it is accepted or declined.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './PairInvites.module.css';

export default function HomeInvites({ playerId }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!playerId) return;
    let alive = true;
    createClient()
      .from('pair_invites')
      .select('id, event_id, sender:users!pair_invites_from_user_fkey(full_name), event:tournament_events(name, status)')
      .eq('to_user', playerId)
      .eq('status', 'pending')
      .then(({ data }) => alive && setRows((data || []).filter((r) => r.event && r.event.status !== 'done')));
    return () => {
      alive = false;
    };
  }, [playerId]);

  if (rows.length === 0) return null;
  return (
    <section className={styles.card}>
      <div className={styles.title}>🤝 Вас запрошують у пару</div>
      {rows.map((r) => (
        <Link key={r.id} href={`/events/register/${r.event_id}`} className={styles.row} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className={styles.body}>
            <div className={styles.name}>{r.sender?.full_name || 'Гравець'}</div>
            <div className={styles.meta}>{r.event?.name || 'Турнір'} · відкрийте, щоб відповісти</div>
          </div>
          <span className={styles.yes}>Відповісти →</span>
        </Link>
      ))}
    </section>
  );
}
