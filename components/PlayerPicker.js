'use client';

// Pick any registered player: type a first name, a surname or a nick and
// choose from the results. Used wherever the choice is NOT limited to the
// people already in a tournament — judging is one case, the admin's
// manual entry and the partner choice on registration are others.
//
// Reads `players` straight from the client; RLS already limits that to
// approved profiles' public fields.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import PlayerAvatar from './PlayerAvatar';
import styles from './PlayerPicker.module.css';

// Fields a typed word is matched against: name, surname and both nicks.
const SEARCH_FIELDS = ['first_name', 'last_name', 'login', 'telegram_username'];

export default function PlayerPicker({
  placeholder = 'Ім’я, прізвище або нік…',
  excludeIds = [],
  gender = null, // 'M' / 'F' — narrows the list where the slot demands one
  disabled = false,
  limit = 20,
  onPick,
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // An array prop is a new object on every render — key the effect on the
  // ids themselves so it re-runs when the exclusions actually change.
  const excludeKey = excludeIds.filter(Boolean).join(',');

  useEffect(() => {
    let alive = true;
    const excluded = excludeKey ? excludeKey.split(',') : [];
    // PostgREST parses `or=(...)` as a comma-separated list, so a comma
    // (or a bracket) in the query would break the filter — drop them.
    const words = query
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[,()%*.]/g, ''))
      .filter(Boolean);

    const timer = setTimeout(async () => {
      setLoading(true);
      const supabase = createClient();
      let request = supabase
        .from('players')
        .select('id, full_name, login, telegram_username, photo_url, gender')
        .eq('approval_status', 'approved')
        .order('full_name')
        // The excluded ones are dropped below, so ask for enough rows to
        // still have `limit` of them left — otherwise a league that has
        // already signed up 20 people would show an empty list.
        .limit(limit + excluded.length);
      if (gender) request = request.eq('gender', gender);
      // Every typed word must match SOMETHING — chained .or() calls are
      // AND-ed by PostgREST — so «коваль петро» finds Петро Коваль no
      // matter which of the two you start with.
      for (const w of words) {
        request = request.or(SEARCH_FIELDS.map((f) => `${f}.ilike.%${w}%`).join(','));
      }

      const { data } = await request;
      if (!alive) return;
      setRows((data || []).filter((p) => !excluded.includes(p.id)).slice(0, limit));
      setLoading(false);
    }, query ? 250 : 0);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, limit, gender, excludeKey]);

  const visible = rows;

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        value={query}
        placeholder={placeholder}
        aria-label={placeholder || 'Пошук гравця'}
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
            <span className={`${styles.gender} ${p.gender === 'F' ? styles.genderF : styles.genderM}`}>
              {p.gender === 'F' ? '♀' : p.gender === 'M' ? '♂' : ''}
            </span>
            <PlayerAvatar player={p} size={24} />
            <span className={styles.name}>{p.full_name}</span>
            <span className={styles.login}>{p.login}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
