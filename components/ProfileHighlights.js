'use client';

// The profile's «game-style» block, under the season switch, in this
// order:
//   1. «Шафа трофеїв» — shelves of cups for 1st / 2nd / 3rd places
//      (replaces the old list «Турнірів зіграно · 1-і · 2-і · 3-і місця»);
//   2. two tiles: peak Ело and the longest win streak;
//   3. «Напарники й суперники» — best partner, the opponent you lose to
//      most, the one you beat most.
// Everything follows the season switch (a season or all time) and is
// computed in memory from what the profile has already loaded: the
// tournament history, the Ело log and the game list (lib/playerGames).

import PlayerAvatar from '@/components/PlayerAvatar';
import { inSeason } from '@/lib/seasons';
import styles from './ProfileHighlights.module.css';

const KYIV = 'Europe/Kyiv';

function shortDate(d) {
  return d ? new Date(d).toLocaleDateString('uk', { day: 'numeric', month: 'short', timeZone: KYIV }) : '';
}

function gamesWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'гра';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'гри';
  return 'ігор';
}

function winsWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'перемога';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'перемоги';
  return 'перемог';
}

const surname = (u) => u?.last_name?.trim() || u?.full_name || '—';

// ── 1. Trophy cabinet ─────────────────────────────────────────────

const SHELVES = [
  { place: 1, title: 'Перші місця', medal: '🥇', cup: '🏆', plank: 'plankGold' },
  { place: 2, title: 'Другі місця', medal: '🥈', cup: '🥈', plank: 'plankSilver' },
  { place: 3, title: 'Треті місця', medal: '🥉', cup: '🥉', plank: 'plankBronze' },
];

function TrophyCabinet({ history, games, scopeLabel, onOpenTournament }) {
  const wins = games.filter((g) => g.won).length;
  const winPct = games.length > 0 ? Math.round((wins / games.length) * 100) : 0;
  const podiums = history.filter((h) => h.placement >= 1 && h.placement <= 3).length;
  const podiumPct = history.length > 0 ? Math.round((podiums / history.length) * 100) : 0;

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.label}>Шафа трофеїв · {scopeLabel}</span>
        {games.length > 0 && (
          <span className={styles.headNote}>
            {games.length} {gamesWord(games.length)} · {winPct}% перемог
          </span>
        )}
      </div>

      {SHELVES.map((s) => {
        const items = history
          .filter((h) => h.placement === s.place)
          .slice()
          .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
        const empty = Math.max(0, 3 - items.length);
        return (
          <div key={s.place} className={styles.shelf}>
            <div className={styles.shelfHead}>
              <span>
                {s.medal} {s.title}
              </span>
              <b>{items.length}</b>
            </div>
            <div className={`${styles.cups} ${items.length === 0 ? styles.cupsEmpty : ''}`}>
              {items.map((h) => (
                <button
                  key={h.category_id}
                  type="button"
                  className={styles.cup}
                  onClick={() => onOpenTournament?.(h.category_id)}
                  title={h.tournament_name}
                >
                  <span className={styles.cupIco}>{s.cup}</span>
                  <span className={styles.cupName}>{h.tournament_name || 'Турнір'}</span>
                  <span className={styles.cupDate}>{shortDate(h.finished_at || h.scheduled_at)}</span>
                </button>
              ))}
              {Array.from({ length: empty }).map((_, i) => (
                <span key={`e${i}`} className={styles.slot}>
                  {i === 0 ? (items.length === 0 ? 'ще немає' : 'наступний') : ''}
                </span>
              ))}
            </div>
            <div className={`${styles.plank} ${styles[s.plank]}`} />
          </div>
        );
      })}

      <div className={styles.foot}>
        <div>
          <b>{history.length}</b>
          {history.length === 1 ? 'турнір' : history.length >= 2 && history.length <= 4 ? 'турніри' : 'турнірів'}
        </div>
        <div>
          <b>{podiums}</b>у призах
        </div>
        <div>
          <b>{podiumPct}%</b>подіумів
        </div>
      </div>
    </section>
  );
}

// ── 2. Personal records ───────────────────────────────────────────

function records({ games, history, eloLog, people }) {
  const sorted = games.slice().sort((a, b) => new Date(a.played_at) - new Date(b.played_at));

  // Peak Ело — the highest rating after a game.
  let peak = null;
  for (const r of eloLog) {
    if (r.elo_after == null) continue;
    if (!peak || r.elo_after > peak.elo) peak = { elo: r.elo_after, at: r.created_at };
  }

  // Longest win streak, and when it ended.
  let streak = { n: 0, at: null };
  let run = 0;
  for (const g of sorted) {
    run = g.won ? run + 1 : 0;
    if (run > streak.n) streak = { n: run, at: g.played_at };
  }

  // Best tournament by Ело gained.
  let bestT = null;
  for (const h of history) {
    if (h.elo_delta == null || h.elo_delta <= 0) continue;
    if (!bestT || h.elo_delta > bestT.elo_delta) bestT = h;
  }

  // Best score — the biggest winning margin.
  let bestS = null;
  for (const g of sorted) {
    if (!g.won || g.pointsFor == null) continue;
    const margin = g.pointsFor - g.pointsAgainst;
    if (!bestS || margin > bestS.margin) bestS = { margin, g };
  }

  // Most games in one day.
  const byDay = new Map();
  for (const g of sorted) {
    if (!g.played_at) continue;
    const day = new Date(g.played_at).toLocaleDateString('uk', { timeZone: KYIV });
    const d = byDay.get(day) || { n: 0, w: 0, at: g.played_at };
    d.n += 1;
    if (g.won) d.w += 1;
    byDay.set(day, d);
  }
  let bestDay = null;
  for (const d of byDay.values()) if (!bestDay || d.n > bestDay.n || (d.n === bestDay.n && d.w > bestDay.w)) bestDay = d;

  const partnerName = bestS?.g.partners?.length ? surname(people[bestS.g.partners[0]]) : null;
  return { peak, streak, bestT, bestS, partnerName, bestDay };
}

function Records({ games, history, eloLog, people }) {
  const r = records({ games, history, eloLog, people });
  // Just two tiles, no heading: the peak rating and the longest run of wins.
  return (
    <div className={styles.rec}>
      <div className={`${styles.tile} ${styles.tBlue}`}>
        <span className={styles.tEmoji}>📈</span>
        <div className={styles.tK}>Пік Ело</div>
        <div className={styles.tV}>{r.peak ? r.peak.elo : '—'}</div>
        <div className={styles.tM}>{r.peak ? shortDate(r.peak.at) : 'ще немає ігор з Ело'}</div>
      </div>
      <div className={`${styles.tile} ${styles.tCoral}`}>
        <span className={styles.tEmoji}>🔥</span>
        <div className={styles.tK}>Серія перемог</div>
        <div className={styles.tV}>{r.streak.n}</div>
        <div className={styles.tM}>{r.streak.n > 0 ? `поспіль · ${shortDate(r.streak.at)}` : 'ще попереду'}</div>
      </div>
    </div>
  );
}

// ── 3. Partners & rivals ──────────────────────────────────────────

function rivals(games, people) {
  const partners = new Map();
  const opponents = new Map();
  const bump = (map, id, won) => {
    const r = map.get(id) || { id, games: 0, wins: 0 };
    r.games += 1;
    if (won) r.wins += 1;
    map.set(id, r);
  };
  for (const g of games) {
    (g.partners || []).forEach((id) => bump(partners, id, g.won));
    (g.opponents || []).forEach((id) => bump(opponents, id, g.won));
  }
  const rate = (r) => r.wins / r.games;
  const withPerson = (r) => (r ? { ...r, losses: r.games - r.wins, person: people[r.id] || { id: r.id, full_name: '—' } } : null);

  const ps = [...partners.values()];
  const pool = ps.some((r) => r.games >= 2) ? ps.filter((r) => r.games >= 2) : ps;
  const bestPartner = pool.sort((a, b) => rate(b) - rate(a) || b.games - a.games)[0] || null;

  const os = [...opponents.values()];
  const nemesis =
    os
      .filter((r) => r.games - r.wins >= 1)
      .sort((a, b) => b.games - b.wins - (a.games - a.wins) || rate(a) - rate(b) || b.games - a.games)[0] || null;
  const rest = os.filter((r) => r.id !== nemesis?.id && r.wins >= 1);
  const favPool = rest.some((r) => r.wins >= 2) ? rest.filter((r) => r.wins >= 2) : rest;
  const favourite = favPool.sort((a, b) => b.wins - a.wins || a.games - a.wins - (b.games - b.wins))[0] || null;

  return { bestPartner: withPerson(bestPartner), nemesis: withPerson(nemesis), favourite: withPerson(favourite) };
}

function RivalRow({ tone, title, r, note, onOpen }) {
  const pct = Math.round((r.wins / r.games) * 100);
  return (
    <button type="button" className={`${styles.rv} ${styles[tone]}`} onClick={() => onOpen?.(r.person)}>
      <PlayerAvatar player={r.person} size={36} />
      <span className={styles.rvB}>
        <span className={styles.rvT}>{title}</span>
        <span className={styles.rvN}>{r.person.full_name}</span>
        <span className={styles.rvM}>{note}</span>
      </span>
      <span className={styles.rvS}>
        {r.wins}–{r.losses}
        <span>{pct}%</span>
      </span>
    </button>
  );
}

function Rivals({ games, people, scopeLabel, gender, onOpenPartner, onOpenOpponent }) {
  const { bestPartner, nemesis, favourite } = rivals(games, people);
  const any = bestPartner || nemesis || favourite;
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.label}>Напарники й суперники · {scopeLabel}</span>
      </div>
      {!any && <div className={styles.empty}>З’явиться після перших ігор</div>}
      <div className={styles.riv}>
        {bestPartner && (
          <RivalRow
            tone="tG"
            title="🤝 Найкращий напарник"
            r={bestPartner}
            note={`${bestPartner.games} ${gamesWord(bestPartner.games)} разом`}
            onOpen={onOpenPartner}
          />
        )}
        {nemesis && (
          <RivalRow
            tone="tR"
            title="😤 Незручний суперник"
            r={nemesis}
            note={
              nemesis.losses === 1 && games.filter((g) => !g.won).length === 1
                ? `єдина поразка — проти ${nemesis.person.gender === 'F' ? 'неї' : 'нього'}`
                : `${nemesis.losses} ${nemesis.losses === 1 ? 'поразка' : nemesis.losses <= 4 ? 'поразки' : 'поразок'} у ${nemesis.games} ${gamesWord(nemesis.games)}`
            }
            onOpen={onOpenOpponent}
          />
        )}
        {favourite && (
          <RivalRow
            tone="tB"
            title="🎯 Улюблений суперник"
            r={favourite}
            note={favourite.losses === 0 ? (gender === 'F' ? 'жодного разу не програла' : 'жодного разу не програв') : `${favourite.wins} ${winsWord(favourite.wins)} у ${favourite.games} ${gamesWord(favourite.games)}`}
            onOpen={onOpenOpponent}
          />
        )}
      </div>
    </section>
  );
}

/**
 * @param {{
 *   history: object[],      // get_user_tournament_history (all time)
 *   eloLog: object[],       // get_user_elo_log (all time)
 *   games: object[],        // loadPlayerGames().games (all time)
 *   people: Record<string, object>,
 *   season: object | null,  // a season row, or null for all time
 *   onOpenTournament?: (categoryId: string) => void,
 *   onOpenPartner?: (person) => void,
 *   onOpenOpponent?: (person) => void,
 * }} props
 */
export default function ProfileHighlights({ history, eloLog, games, people, season, gender, onOpenTournament, onOpenPartner, onOpenOpponent }) {
  const within = (when) => !season || inSeason(when, season);
  const h = (history || []).filter((x) => within(x.scheduled_at));
  const l = (eloLog || []).filter((x) => within(x.created_at));
  const g = (games || []).filter((x) => within(x.played_at));
  const scopeLabel = season ? season.name : 'Весь час';

  return (
    <div className={styles.wrap}>
      <TrophyCabinet history={h} games={g} scopeLabel={scopeLabel} onOpenTournament={onOpenTournament} />
      <Records games={g} history={h} eloLog={l} people={people || {}} />
      <Rivals
        games={g}
        people={people || {}}
        scopeLabel={scopeLabel}
        gender={gender}
        onOpenPartner={onOpenPartner}
        onOpenOpponent={onOpenOpponent || onOpenPartner}
      />
    </div>
  );
}
