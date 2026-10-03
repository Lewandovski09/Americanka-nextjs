'use client';

// The two header cards — Ело and AVP — shown on the home page, the own
// profile and another player's page. They used to be three hand-copied
// blocks; now one component, and each card says which season it is for.
// `styles` is the page's CSS module (all three define the same classes).

import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export default function HeaderStatCards({ styles, player, stats }) {
  if (!player || player.elo == null) return null;

  const eloSeason = stats?.eloSeason || null;
  const avpSeason = stats?.avpSeason || null;
  const delta = stats?.eloSeasonDelta ?? null;

  const playerCategory = categoryForElo(player.elo);
  const categoryIndex = playerCategory ? SKILL_CATEGORIES.findIndex((c) => c.id === playerCategory.id) : -1;
  const nextCategory =
    categoryIndex >= 0 && categoryIndex < SKILL_CATEGORIES.length - 1 ? SKILL_CATEGORIES[categoryIndex + 1] : null;
  const eloProgressPct = playerCategory
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(((player.elo - playerCategory.range[0]) / (playerCategory.range[1] - playerCategory.range[0])) * 100)
        )
      )
    : 0;

  return (
    <div className={styles.headerStatsRow}>
      <div className={styles.headerStatCard}>
        <div className={styles.headerStatLabel} style={oneLine} title={eloSeason ? `Ело — ${eloSeason.name}` : undefined}>
          Ело{eloSeason ? ` · ${eloSeason.name}` : ''}
        </div>
        <div className={styles.headerStatValue}>
          {player.elo}
          {delta != null && delta !== 0 && (
            <span
              title="Зміна за поточний сезон"
              style={{ fontSize: 11, fontWeight: 700, marginLeft: 6, color: delta > 0 ? '#5fd38d' : '#ff8a7a' }}
            >
              {delta > 0 ? `+${delta}` : delta} за сезон
            </span>
          )}
        </div>
        {playerCategory && (
          <div className={styles.headerStatBar}>
            <div className={styles.headerStatBarFill} style={{ width: `${eloProgressPct}%` }} />
          </div>
        )}
        <div className={styles.headerStatMeta}>
          {stats?.eloRank ? `№${stats.eloRank}` : ''}
          {nextCategory
            ? ` · ${nextCategory.range[0] - player.elo} до Кат. ${nextCategory.id}`
            : playerCategory
            ? ' · Найвища категорія'
            : ''}
        </div>
      </div>

      {avpSeason && (
        <div className={`${styles.headerStatCard} ${styles.headerStatCardAvp}`}>
          <div className={styles.headerStatLabelAvp} style={oneLine} title={`AVP — ${avpSeason.name}`}>
            AVP · {avpSeason.name}
          </div>
          <div className={styles.headerStatValueAvp}>{stats?.avpStanding?.points ?? 0}</div>
          <div className={styles.headerStatMetaAvp}>
            {stats?.avpStanding ? `№${stats.avpStanding.rank} сезону` : 'Ще немає очок у сезоні'}
          </div>
        </div>
      )}
    </div>
  );
}
