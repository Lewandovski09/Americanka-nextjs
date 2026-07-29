'use client';

// Pick any registered player: type a name (or a login) and choose from
// the results. Used wherever the choice is NOT limited to the people
// already in a tournament — judging is the case: whoever is free that
// day can be handed a game.
//
// Reads `players` straight from the client; RLS already limits that to
// approved profiles' public fields.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import PlayerAvatar from './PlayerAvatar';
import styles from './PlayerPicker.module.css';

export default function PlayerPicker({
  placeholder = 'Ім’я або логін…',
  excludeIds = [],
  disabled = false,
  limit = 20,
  onPick,
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    // PostgREST parses `or=(...)` as a comma-separated list, so a comma
    // (or a bracket) in the query would break the filter — drop them.
    const q = query.trim().replace(/[,()%]/g, '');

    const timer = setTimeout(async () => {
      setLoading(true);
      const supabase = createClient();
      let request = supabase
        .from('players')
        .select('id, full_name, login, photo_url, gender')
        .eq('approval_status', 'approved')
        .order('full_name')
        .limit(limit);
      if (q) request = request.or(`full_name.ilike.%${q}%,login.ilike.%${q}%`);

      const { data } = await request;
      if (!alive) return;
      setRows(data || []);
      setLoading(false);
    }, query ? 250 : 0);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, limit]);

  const visible = rows.filter((p) => !excludeIds.includes(p.id));

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.list}>
        {loading && visible.length === 0 && <div className={styles.empty}>Пошук…</div>}
        {!loading && visible.length === 0 && <div className={styles.empty}>Нікого не знайдено</div>}
        {visible.map((p) => (
          <button
            key={p.id}
            className={styles.row}
            disabled={disabled}
            onClick={() => onPick(p)}
          >
            <PlayerAvatar player={p} size={24} />
            <span className={styles.name}>{p.full_name}</span>
            <span className={styles.login}>{p.login}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
