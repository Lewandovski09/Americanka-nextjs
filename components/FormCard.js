'use client';

// «Твоя форма» — the block at the top of the home page (variant 5 of the
// mock-ups: the form guide of FIFA/FC + the goal ring of Apple Fitness).
// It shows what the profile does NOT: the last five games as В/П tiles, a
// ring of progress to the next category, how many wins that is, and the
// partner who wins most with you.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { loadPlayerGamesShared, partnerStatsFrom } from '@/lib/playerGames';
import { categoryForElo, eloForecast, SKILL_CATEGORIES } from '@/lib/elo';
import { getCached, setCached } from '@/lib/clientCache';
import styles from './FormCard.module.css';

const surname = (p) => p?.last_name?.trim() || p?.full_name || '—';

function winsWord(n) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'перемога';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'перемоги';
  return 'перемог';
}

export default function FormCard({ player }) {
  const key = player?.id ? `formcard:${player.id}` : null;
  const [data, setData] = useState(() => (key && getCached(key)) || null);

  useEffect(() => {
    if (!player?.id) return;
    let alive = true;
    loadPlayerGamesShared(createClient(), player.id).then(({ games, people }) => {
      const last5 = [...games].sort((a, b) => new Date(b.played_at) - new Date(a.played_at)).slice(0, 5).reverse();
      // Best partner: the most wins together, at least 2 games.
      const partners = partnerStatsFrom(games, people).filter((p) => p.games_together >= 2);
      partners.sort(
        (a, b) => b.wins_together / b.games_together - a.wins_together / a.games_together || b.games_together - a.games_together
      );
      const value = { last5, best: partners[0] || null };
      setCached(key, value);
      if (alive) setData(value);
    });
    return () => {
      alive = false;
    };
  }, [player?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!player || player.elo == null) return null;

  // Progress to the next category (or, in the top one, to its upper edge).
  const cat = categoryForElo(player.elo);
  const idx = cat ? SKILL_CATEGORIES.findIndex((c) => c.id === cat.id) : -1;
  const next = idx >= 0 && idx < SKILL_CATEGORIES.length - 1 ? SKILL_CATEGORIES[idx + 1] : null;
  const goal = next ? next.range[0] : cat?.range[1];
  const from = cat?.range[0] ?? 0;
  const left = goal != null ? Math.max(0, goal - player.elo) : 0;
  const pct = goal ? Math.min(100, Math.max(0, Math.round(((player.elo - from) / (goal - from)) * 100))) : 100;
  const perWin = Math.max(1, eloForecast(player.elo, player.elo).win);
  const wins = Math.ceil(left / perWin);

  const last5 = data?.last5 || [];

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.label}>Твоя форма</span>
        <div className={styles.form} aria-label="Останні 5 ігор">
          {last5.length === 0 && <span className={styles.noGames}>ще немає ігор</span>}
          {last5.map((g, i) => (
            <span key={i} className={g.won ? styles.win : styles.loss} title={g.won ? 'Перемога' : 'Поразка'}>
              {g.won ? 'В' : 'П'}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.ring} style={{ background: `conic-gradient(#ffd66b 0 ${pct}%, rgba(255,255,255,0.14) ${pct}% 100%)` }}>
          <div className={styles.ringIn}>
            <span className={styles.ringPct}>{pct}%</span>
            <span className={styles.ringSub}>{next ? `до кат. ${next.id}` : left > 0 ? `до ${goal}` : 'максимум'}</span>
          </div>
        </div>
        <div className={styles.text}>
          {next || left > 0 ? (
            <>
              <div className={styles.headline}>
                {next ? 'До наступної категорії' : `До ${goal}`} — {left} Ело
              </div>
              <div className={styles.sub}>
                ≈ {wins} {winsWord(wins)} над рівними суперниками
              </div>
            </>
          ) : (
            <div className={styles.headline}>Найвища категорія — так тримати!</div>
          )}
          {data?.best && (
            <div className={styles.sub}>
              Найкращий напарник: <b>{surname(data.best.partner)}</b> · {data.best.wins_together}/{data.best.games_together}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
