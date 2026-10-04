'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';
import { teamAWon } from '@/lib/formats/sets';
import PlayerAvatar from '@/components/PlayerAvatar';
import { PRIMARY_SPORT_ID, getSport } from '@/lib/sports';
import { getFormat } from '@/lib/formats';
import { loadClubSeasons, seasonDates } from '@/lib/seasons';
import { getCached, setCached, memoize } from '@/lib/clientCache';
import { gamesUk } from '@/lib/pluralize';
import styles from './rating.module.css';
import { pressable } from '@/lib/a11y';

// Seasons are scoped by sport and optionally by city (migration 043), so
// the chip says which one it is whenever that is not the default.
function seasonLabel(s) {
  const parts = [s.ends_on === null ? `${s.name} · зараз` : s.name];
  if (s.city?.name) parts.push(s.city.name);
  if (s.sport_id && s.sport_id !== PRIMARY_SPORT_ID) parts.push(getSport(s.sport_id)?.displayName || s.sport_id);
  return parts.join(' · ');
}

// PostgREST returns at most 1000 rows per request; tables that grow with
// every tournament (placements, matches, history) are read page by page.
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Loaders. Each returns the data for ALL genders and categories, so
// switching Чоловіки/Жінки or A–D is a filter in memory, not a request.
// Results go to clientCache, which outlives the page: coming back to
// «Рейтинг» from another section shows the last table at once.
// ─────────────────────────────────────────────────────────────

// Current Ело season: live ratings, Americanka tournaments played, and the
// change since the season opened. Five independent reads, all at once
// (this used to be six requests one after another).
async function loadEloCurrent(supabase, eloSeason) {
  // «турн.» counted in the database (migration 059); the old way — every
  // place, category and event downloaded and counted here — stays as the
  // fallback until that migration runs.
  const counted = await supabase.rpc('americanka_tournament_counts');
  if (!counted.error) {
    const [users, starts] = await Promise.all([
      fetchAll(() =>
        supabase
          .from('users')
          .select('id, full_name, login, elo, photo_url, gender')
          .eq('approval_status', 'approved')
          .order('elo', { ascending: false })
      ),
      eloSeason
        ? fetchAll(() => supabase.from('season_ratings').select('user_id, elo_start').eq('season_id', eloSeason.id))
        : Promise.resolve([]),
    ]);
    const countBy = new Map((counted.data || []).map((r) => [r.user_id, r.n]));
    const startBy = new Map(starts.map((r) => [r.user_id, r.elo_start]));
    return users.map((p) => {
      const start = startBy.get(p.id);
      return {
        ...p,
        tournaments_played: countBy.get(p.id) || 0,
        seasonDelta: start != null && p.elo != null ? p.elo - start : null,
      };
    });
  }

  const [users, placements, { data: cats }, { data: events }, starts] = await Promise.all([
    fetchAll(() =>
      supabase
        .from('users')
        .select('id, full_name, login, elo, photo_url, gender')
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
    ),
    fetchAll(() => supabase.from('tournament_placements').select('user_id, category_id')),
    supabase.from('tournament_categories').select('id, event_id'),
    supabase.from('tournament_events').select('id, format_kind'),
    eloSeason
      ? fetchAll(() => supabase.from('season_ratings').select('user_id, elo_start').eq('season_id', eloSeason.id))
      : Promise.resolve([]),
  ]);

  // Ело moves only on Americanka results (the score route's auto-Ело), so
  // «турн.» on this tab counts Americanka tournaments. The count comes
  // from tournament_placements, which is rewritten idempotently on every
  // finish — unlike an accumulating counter it cannot drift.
  const formatByEvent = new Map((events || []).map((ev) => [ev.id, ev.format_kind]));
  const americanka = new Set((cats || []).filter((t) => formatByEvent.get(t.event_id) === 'americanka').map((t) => t.id));
  const countByPlayer = new Map();
  placements.forEach((tp) => {
    if (!americanka.has(tp.category_id)) return;
    countByPlayer.set(tp.user_id, (countByPlayer.get(tp.user_id) || 0) + 1);
  });
  const startById = new Map(starts.map((r) => [r.user_id, r.elo_start]));

  return users.map((p) => {
    const start = startById.get(p.id);
    return {
      ...p,
      tournaments_played: countByPlayer.get(p.id) || 0,
      seasonDelta: start != null && p.elo != null ? p.elo - start : null,
    };
  });
}

// A closed Ело season: its frozen table (migration 045).
async function loadEloArchived(supabase, seasonId) {
  const rows = await fetchAll(() =>
    supabase
      .from('season_ratings')
      .select('user_id, elo_start, elo_end, games_played, games_won, users(id, full_name, login, photo_url, gender, approval_status)')
      .eq('season_id', seasonId)
      .not('elo_end', 'is', null)
      .order('elo_end', { ascending: false })
  );
  return rows
    .filter((r) => r.users)
    .map((r) => ({
      ...r.users,
      elo: r.elo_end,
      seasonDelta: r.elo_start != null ? r.elo_end - r.elo_start : null,
      games: r.games_played,
      archived: true,
    }));
}

// The standings view sums the ledger, so it holds points but no profiles.
async function loadAvp(supabase, seasonId) {
  const standings = await fetchAll(() =>
    supabase
      .from('avp_standings')
      .select('user_id, points, tournaments_counted')
      .eq('season_id', seasonId)
      .order('points', { ascending: false })
  );
  const ids = standings.map((s) => s.user_id);
  // 100 ids per request: a season with hundreds of players would make one
  // URL too long for the server.
  const parts = [];
  for (let i = 0; i < ids.length; i += 100) parts.push(ids.slice(i, i + 100));
  const chunks = await Promise.all(
    parts.map((part) => supabase.from('users').select('id, full_name, login, photo_url, gender, elo').in('id', part))
  );
  const profiles = chunks.flatMap((c) => c.data || []);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  return standings.map((s) => ({ ...s, player: byId.get(s.user_id) })).filter((s) => s.player);
}

// Club leaderboards for the CURRENT season (the Ело season's dates):
// current win streaks, game wins outside Americanka, and Ело gained.
async function loadClubStats(supabase, season) {
  const from = season?.starts_on || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Counted in the database (migration 059): three short lists come back
  // instead of every game, every Ело change and every user of the season.
  const rpc = await supabase.rpc('club_stats', { p_from: from, p_to: season?.ends_on || null });
  if (!rpc.error && rpc.data) {
    const st = rpc.data;
    const ids = [...new Set([...st.streaks, ...st.wins, ...st.gains].map((r) => r.playerId))];
    const { data: people } = ids.length
      ? await supabase.from('users').select('id, full_name, login, photo_url, gender').in('id', ids)
      : { data: [] };
    const by = new Map((people || []).map((p) => [p.id, p]));
    const withP = (list) => list.map((r) => ({ ...r, player: by.get(r.playerId) })).filter((r) => r.player);
    return { streaks: withP(st.streaks), wins: withP(st.wins), gains: withP(st.gains) };
  }

  const to = season?.ends_on ? `${season.ends_on}T23:59:59.999Z` : null;

  const [matches, { data: cats }, { data: events }, eloRows, profiles] = await Promise.all([
    fetchAll(() => {
      let q = supabase
        .from('tournament_matches')
        .select('category_id, team_a_players, team_b_players, set1, set2, set3, played_at')
        .eq('played', true)
        .gte('played_at', from)
        .order('played_at', { ascending: false });
      return to ? q.lte('played_at', to) : q;
    }),
    supabase.from('tournament_categories').select('id, event_id'),
    supabase.from('tournament_events').select('id, format_kind'),
    fetchAll(() => {
      // tournament_result only: admin corrections and season resets are
      // not «gained from playing».
      let q = supabase.from('elo_history').select('user_id, delta').eq('reason', 'tournament_result').gte('created_at', from);
      return to ? q.lte('created_at', to) : q;
    }),
    fetchAll(() => supabase.from('users').select('id, full_name, login, photo_url, gender')),
  ]);

  const formatByEvent = new Map((events || []).map((ev) => [ev.id, ev.format_kind]));
  const formatByCat = new Map((cats || []).map((t) => [t.id, formatByEvent.get(t.event_id)]));

  // Streaks: newest first, counted back to the first loss.
  const gamesByPlayer = new Map();
  const winsByPlayer = new Map();
  matches.forEach((m) => {
    const aWon = teamAWon(m);
    (m.team_a_players || []).forEach((id) => {
      if (!gamesByPlayer.has(id)) gamesByPlayer.set(id, []);
      gamesByPlayer.get(id).push(aWon);
    });
    (m.team_b_players || []).forEach((id) => {
      if (!gamesByPlayer.has(id)) gamesByPlayer.set(id, []);
      gamesByPlayer.get(id).push(!aWon);
    });
    const kind = formatByCat.get(m.category_id);
    if (kind && kind !== 'americanka') {
      ((aWon ? m.team_a_players : m.team_b_players) || []).forEach((id) => {
        winsByPlayer.set(id, (winsByPlayer.get(id) || 0) + 1);
      });
    }
  });
  const streaks = [];
  for (const [playerId, results] of gamesByPlayer.entries()) {
    let streak = 0;
    for (const won of results) {
      if (!won) break;
      streak++;
    }
    if (streak >= 2) streaks.push({ playerId, streak });
  }
  streaks.sort((a, b) => b.streak - a.streak);

  const wins = [...winsByPlayer.entries()].map(([playerId, w]) => ({ playerId, wins: w })).sort((a, b) => b.wins - a.wins);

  const gainByPlayer = new Map();
  eloRows.forEach((r) => gainByPlayer.set(r.user_id, (gainByPlayer.get(r.user_id) || 0) + r.delta));
  const gains = [...gainByPlayer.entries()]
    .map(([playerId, gain]) => ({ playerId, gain }))
    .filter((r) => r.gain > 0)
    .sort((a, b) => b.gain - a.gain);

  const byId = new Map(profiles.map((p) => [p.id, p]));
  const withPlayer = (list) => list.map((r) => ({ ...r, player: byId.get(r.playerId) })).filter((r) => r.player);
  return { streaks: withPlayer(streaks), wins: withPlayer(wins), gains: withPlayer(gains) };
}

// «Сезон 2026 · з 1 січ. 2026» — which season the list below belongs to.
function SeasonNote({ season, archived }) {
  if (!season) return null;
  return (
    <div className={styles.seasonNote}>
      <span className={styles.seasonNoteName}>{season.name}</span>
      <span>
        {seasonDates(season)}
        {archived ? ' · архів' : season.ends_on === null ? ' · поточний сезон' : ''}
      </span>
    </div>
  );
}

export default function RatingPage() {
  const { player } = useCurrentPlayer();
  const [tab, setTab] = useState(() => getCached('rating:tab') || 'rating'); // 'rating' | 'avp' | 'stats'
  const [gender, setGender] = useState('M');
  const [category, setCategory] = useState('all');
  const [showScale, setShowScale] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Every season of every track (for the chips) and the current club ones.
  const [seasons, setSeasons] = useState(() => getCached('rating:seasons') || []);
  const [club, setClub] = useState(() => getCached('seasons:club')?.value || null);
  const [seasonId, setSeasonId] = useState(() => getCached('seasons:club')?.value?.avp?.id || null); // AVP season shown
  // Ело tab: null = the current season (live ratings); a closed season's
  // id = its frozen final table from season_ratings (migration 045).
  const [eloSeasonId, setEloSeasonId] = useState(null);

  // Data, seeded from the tab-wide cache so a return visit is instant.
  // key -> rows; `undefined` for a key = not loaded yet.
  const [eloByKey, setEloByKey] = useState(() => ({ 'rating:elo:current': getCached('rating:elo:current') }));
  const [avpByKey, setAvpByKey] = useState({});
  const [clubStats, setClubStats] = useState(() => getCached('rating:stats') || null);

  // ── Compare players state ──
  const [loginA, setLoginA] = useState(null); // now holds the selected player object, not raw text
  const [loginB, setLoginB] = useState(null);
  const [queryA, setQueryA] = useState(''); // what's typed in the search box
  const [queryB, setQueryB] = useState('');
  const [suggestionsA, setSuggestionsA] = useState([]);
  const [suggestionsB, setSuggestionsB] = useState([]);
  const [compareError, setCompareError] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState(null); // { playerA, playerB, statsA, statsB }

  function openTab(t) {
    setTab(t);
    setCached('rating:tab', t);
  }

  // On open: seasons first (cached for the tab, usually instant), then
  // ALL THREE tabs load at once in the background — switching between
  // Ело / AVP / Статистика afterwards never waits for the network.
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    (async () => {
      const [clubSeasons, { data: allSeasons }] = await Promise.all([
        loadClubSeasons(supabase),
        supabase
          .from('avp_seasons')
          .select('id, name, kind, starts_on, ends_on, sport_id, city:cities(name)')
          .order('starts_on', { ascending: false }),
      ]);
      if (!alive) return;
      setClub(clubSeasons);
      setSeasons(setCached('rating:seasons', allSeasons || []));
      setSeasonId((prev) => prev || clubSeasons.avp?.id || (allSeasons || []).find((s) => (s.kind || 'avp') === 'avp')?.id || null);

      // The table first; the heavier club statistics right after it (so
      // the two don't compete for the first paint). Both are reused for a
      // few minutes when the page is opened again.
      memoize('rating:elo:current:fresh', 2 * 60 * 1000, () => loadEloCurrent(supabase, clubSeasons.elo))
        .then((rows) => {
          setCached('rating:elo:current', rows);
          if (alive) setEloByKey((m) => ({ ...m, 'rating:elo:current': rows }));
        })
        .finally(() =>
          memoize('rating:stats:fresh', 5 * 60 * 1000, () => loadClubStats(supabase, clubSeasons.elo)).then((st) => {
            setCached('rating:stats', st);
            if (alive) setClubStats(st);
          })
        );
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Ело: an archived season, loaded when its chip is picked (the current
  // table is loaded on open).
  const eloKey = eloSeasonId ? `rating:elo:${eloSeasonId}` : 'rating:elo:current';
  useEffect(() => {
    if (!eloSeasonId) return;
    const key = `rating:elo:${eloSeasonId}`;
    const cached = getCached(key);
    if (cached) setEloByKey((m) => ({ ...m, [key]: cached }));
    let alive = true;
    loadEloArchived(createClient(), eloSeasonId).then((rows) => {
      setCached(key, rows);
      if (alive) setEloByKey((m) => ({ ...m, [key]: rows }));
    });
    return () => {
      alive = false;
    };
  }, [eloSeasonId]);

  // AVP: the chosen season (the current one by default).
  useEffect(() => {
    if (!seasonId) return;
    const key = `rating:avp:${seasonId}`;
    const cached = getCached(key);
    if (cached) setAvpByKey((m) => ({ ...m, [key]: cached }));
    let alive = true;
    loadAvp(createClient(), seasonId).then((rows) => {
      setCached(key, rows);
      if (alive) setAvpByKey((m) => ({ ...m, [key]: rows }));
    });
    return () => {
      alive = false;
    };
  }, [seasonId]);

  // Typeahead for the two compare-player pickers — same debounced
  // search-then-select pattern as the admin panel's player search.
  useEffect(() => {
    if (queryA.trim().length < 2) {
      setSuggestionsA([]);
      return;
    }
    let active = true;
    const supabase = createClient();
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, login, photo_url, elo')
        .eq('approval_status', 'approved')
        .or(`login.ilike.%${queryA.trim()}%,full_name.ilike.%${queryA.trim()}%`)
        .limit(6);
      if (active) setSuggestionsA(data || []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryA]);

  useEffect(() => {
    if (queryB.trim().length < 2) {
      setSuggestionsB([]);
      return;
    }
    let active = true;
    const supabase = createClient();
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, login, photo_url, elo')
        .eq('approval_status', 'approved')
        .or(`login.ilike.%${queryB.trim()}%,full_name.ilike.%${queryB.trim()}%`)
        .limit(6);
      if (active) setSuggestionsB(data || []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryB]);

  const q = searchTerm.trim().toLowerCase();
  const matchesSearch = (p) => !q || p.login?.toLowerCase().includes(q) || p.full_name?.toLowerCase().includes(q);
  const catDef = category === 'all' ? null : SKILL_CATEGORIES.find((c) => c.id === category);
  const inCategory = (elo) => !catDef || (elo != null && elo >= catDef.range[0] && elo < catDef.range[1]);

  const eloRows = eloByKey[eloKey];
  const avpRows = seasonId ? avpByKey[`rating:avp:${seasonId}`] : [];
  const eloLoading = eloRows === undefined || eloRows === null;
  const avpLoading = seasonId ? avpRows === undefined : !club;
  const players = eloRows || [];
  const filteredPlayers = players.filter((p) => p.gender === gender && inCategory(p.elo) && matchesSearch(p));
  const filteredAvp = (avpRows || []).filter((r) => r.player.gender === gender && matchesSearch(r.player));

  // AVP and Ело seasons are two independent tracks (migration 045).
  const avpSeasons = seasons.filter((s) => (s.kind || 'avp') === 'avp');
  // Club-wide Ело seasons of the primary sport — the ones the Ело table has.
  const eloSeasons = seasons.filter(
    (s) => s.kind === 'elo' && (s.sport_id || PRIMARY_SPORT_ID) === PRIMARY_SPORT_ID && !s.city
  );
  const shownEloSeason = eloSeasonId ? eloSeasons.find((s) => s.id === eloSeasonId) : club?.elo || null;
  const shownAvpSeason = avpSeasons.find((s) => s.id === seasonId) || null;

  // Club leaderboards, same gender toggle as the Ело/AVP tabs — filtered
  // then capped to 5, in that order.
  const genderClubStreaks = (clubStats?.streaks || []).filter((r) => r.player?.gender === gender).slice(0, 5);
  const genderClubTournamentWins = (clubStats?.wins || []).filter((r) => r.player?.gender === gender).slice(0, 5);
  const genderClubEloGains = (clubStats?.gains || []).filter((r) => r.player?.gender === gender).slice(0, 5);

  async function handleCompare() {
    setCompareError('');
    setCompareResult(null);
    if (!loginA || !loginB) {
      setCompareError('Оберіть обох гравців');
      return;
    }

    setCompareLoading(true);
    const supabase = createClient();

    const [statsA, statsB] = await Promise.all([
      supabase.rpc('get_user_format_stats', { p_user_id: loginA.id }),
      supabase.rpc('get_user_format_stats', { p_user_id: loginB.id }),
    ]);

    setCompareLoading(false);
    setCompareResult({
      playerA: loginA,
      playerB: loginB,
      statsA: statsA.data || [],
      statsB: statsB.data || [],
    });
  }

  function highlightMatch(text, query) {
    if (!query || !text) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <b className={styles.matchHighlight}>{text.slice(idx, idx + query.length)}</b>
        {text.slice(idx + query.length)}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        {/* Elo and AVP answer different questions and sit side by side:
            Elo is how strong a player is, AVP is what they have won this
            season. Neither is derived from the other. */}
        <button className={`${styles.tabBtn} ${tab === 'rating' ? styles.tabBtnOn : ''}`} onClick={() => openTab('rating')} aria-pressed={tab === 'rating'}>
          Ело
        </button>
        <button className={`${styles.tabBtn} ${tab === 'avp' ? styles.tabBtnOn : ''}`} onClick={() => openTab('avp')} aria-pressed={tab === 'avp'}>
          AVP
        </button>
        <button className={`${styles.tabBtn} ${tab === 'stats' ? styles.tabBtnOn : ''}`} onClick={() => openTab('stats')} aria-pressed={tab === 'stats'}>
          Статистика
        </button>
      </div>

      {tab === 'rating' && <SeasonBanner title="Рейтинг Ело" season={shownEloSeason} archived={Boolean(eloSeasonId)} kind="elo" />}
      {tab === 'avp' && <SeasonBanner title="Рейтинг AVP" season={shownAvpSeason} kind="avp" />}
      {tab === 'stats' && <SeasonNote season={club?.elo} />}

      {tab === 'rating' && (
        <>
          <input
            className={styles.searchInput}
            placeholder="Пошук за нікнеймом або іменем..."
            aria-label="Пошук гравця за нікнеймом або іменем"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className={styles.row}>
            <button className={`${styles.genderBtn} ${gender === 'M' ? styles.genderBtnOn : ''}`} onClick={() => setGender('M')} aria-pressed={gender === 'M'}>
              Чоловіки
            </button>
            <button className={`${styles.genderBtn} ${gender === 'F' ? styles.genderBtnOn : ''}`} onClick={() => setGender('F')} aria-pressed={gender === 'F'}>
              Жінки
            </button>
          </div>

          {eloSeasons.length > 1 && (
            <div className={styles.chipsRow}>
              {eloSeasons.map((s) => {
                const id = s.ends_on === null ? null : s.id;
                return (
                  <button
                    key={s.id}
                    className={`${styles.chip} ${eloSeasonId === id ? styles.chipOn : ''}`}
                    onClick={() => setEloSeasonId(id)}
                    aria-pressed={eloSeasonId === id}
                  >
                    {s.name}
                    {s.ends_on === null ? ' · зараз' : ''}
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.chipsRow}>
            <button className={`${styles.chip} ${category === 'all' ? styles.chipOn : ''}`} onClick={() => setCategory('all')} aria-pressed={category === 'all'}>
              Всі
            </button>
            {['A', 'B', 'C', 'D'].map((c) => (
              <button key={c} className={`${styles.chip} ${category === c ? styles.chipOn : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
                {c}
              </button>
            ))}
            {/* The scale used to sit under the whole list — the more players,
                the further down it was. Now it opens right here on demand. */}
            <button
              className={`${styles.chip} ${showScale ? styles.chipOn : ''}`}
              onClick={() => setShowScale((v) => !v)}
              aria-expanded={showScale}
            >
              Шкала рівнів {showScale ? '▲' : '▼'}
            </button>
          </div>

          {showScale && (
            <div className={`${styles.scaleCard} riseIn`}>
              {SKILL_CATEGORIES.map((c) => (
                <div key={c.id} className={styles.scaleRow}>
                  <div className={styles.scaleHeader}>
                    <span>{c.id}</span>
                    <span>{c.range[0]}–{c.range[1]}</span>
                  </div>
                  <div className={styles.scaleBar}>
                    <div
                      className={styles.scaleFill}
                      style={{ width: `${Math.round(((c.range[1] - 800) / (2200 - 800)) * 100)}%`, background: c.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {eloLoading && <div className={styles.empty}>Завантаження...</div>}
          {!eloLoading && filteredPlayers.length === 0 && <div className={styles.empty}>Немає гравців</div>}

          {filteredPlayers.map((p, i) => (
            <a
              key={p.id}
              href={p.id === player?.id ? '/profile' : `/players/${p.id}`}
              id={p.id === player?.id ? 'rating-me' : undefined}
              className={`${styles.playerRow} ${p.id === player?.id ? styles.meRow : ''}`}
            >
              <RankBadge n={i + 1} />
              <PlayerAvatar player={p} size={36} />
              <div className={styles.playerInfo}>
                <div className={styles.playerName}>{highlightMatch(p.full_name, searchTerm.trim())}</div>
                <div className={styles.playerMeta}>
                  {categoryForElo(p.elo)?.label} ·{' '}
                  {p.archived ? gamesUk(p.games) : `${p.tournaments_played} турн.`}
                  {p.seasonDelta != null && p.seasonDelta !== 0 && (
                    <span className={p.seasonDelta > 0 ? styles.metaUp : styles.metaDown}>
                      {' '}
                      · {p.seasonDelta > 0 ? `+${p.seasonDelta}` : p.seasonDelta}
                    </span>
                  )}
                </div>
              </div>
              <ScorePill value={p.elo} kind="elo" />
            </a>
          ))}

        </>
      )}

      {tab === 'avp' && (
        <>
          <input
            className={styles.searchInput}
            placeholder="Пошук за нікнеймом або іменем..."
            aria-label="Пошук гравця за нікнеймом або іменем"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className={styles.row}>
            <button className={`${styles.genderBtn} ${gender === 'M' ? styles.genderBtnOn : ''}`} onClick={() => setGender('M')} aria-pressed={gender === 'M'}>
              Чоловіки
            </button>
            <button className={`${styles.genderBtn} ${gender === 'F' ? styles.genderBtnOn : ''}`} onClick={() => setGender('F')} aria-pressed={gender === 'F'}>
              Жінки
            </button>
          </div>

          {avpSeasons.length > 1 && (
            <div className={styles.chipsRow}>
              {avpSeasons.map((s) => (
                <button
                  key={s.id}
                  className={`${styles.chip} ${seasonId === s.id ? styles.chipOn : ''}`}
                  onClick={() => setSeasonId(s.id)}
                  aria-pressed={seasonId === s.id}
                >
                  {seasonLabel(s)}
                </button>
              ))}
            </div>
          )}

          {avpSeasons.length === 0 && !avpLoading && (
            <div className={styles.empty}>Сезон ще не створено</div>
          )}
          {avpLoading && <div className={styles.empty}>Завантаження...</div>}
          {!avpLoading && avpSeasons.length > 0 && filteredAvp.length === 0 && (
            <div className={styles.empty}>У цьому сезоні ще немає нарахованих очок</div>
          )}

          {filteredAvp.map((r, i) => (
            <a
              key={r.user_id}
              href={r.user_id === player?.id ? '/profile' : `/players/${r.user_id}`}
              id={r.user_id === player?.id ? 'rating-me' : undefined}
              className={`${styles.playerRow} ${r.user_id === player?.id ? styles.meRow : ''}`}
            >
              <RankBadge n={i + 1} />
              <PlayerAvatar player={r.player} size={36} />
              <div className={styles.playerInfo}>
                <div className={styles.playerName}>{highlightMatch(r.player.full_name, searchTerm.trim())}</div>
                <div className={styles.playerMeta}>
                  @{highlightMatch(r.player.login, searchTerm.trim())} · {r.tournaments_counted} турн.
                </div>
              </div>
              <ScorePill value={r.points} kind="avp" />
            </a>
          ))}
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className={styles.row}>
            <button className={`${styles.genderBtn} ${gender === 'M' ? styles.genderBtnOn : ''}`} onClick={() => setGender('M')} aria-pressed={gender === 'M'}>
              Чоловіки
            </button>
            <button className={`${styles.genderBtn} ${gender === 'F' ? styles.genderBtnOn : ''}`} onClick={() => setGender('F')} aria-pressed={gender === 'F'}>
              Жінки
            </button>
          </div>

          <div className={styles.sectionLabel}>Клубна статистика{club?.elo ? ` · ${club.elo.name}` : ''}</div>
          {!clubStats && <div className={styles.empty}>Завантаження...</div>}

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>Найдовші поточні серії перемог у сезоні</div>
            {clubStats && genderClubStreaks.length === 0 && <div className={styles.empty}>Ще немає активних серій</div>}
            {genderClubStreaks.map((r, i) => (
              <div key={r.playerId} className={styles.clubStatRow}>
                <span className={styles.clubStatRank}>{i + 1}.</span>
                <PlayerAvatar player={r.player} size={24} />
                <span className={styles.clubStatName}>{r.player.full_name}</span>
                <span className={styles.clubStatValue}>{r.streak}</span>
              </div>
            ))}
          </div>

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>Найбільше перемог в іграх за сезон (крім Americanka)</div>
            {clubStats && genderClubTournamentWins.length === 0 && <div className={styles.empty}>Ще немає даних</div>}
            {genderClubTournamentWins.map((r, i) => (
              <div key={r.playerId} className={styles.clubStatRow}>
                <span className={styles.clubStatRank}>{i + 1}.</span>
                <PlayerAvatar player={r.player} size={24} />
                <span className={styles.clubStatName}>{r.player.full_name}</span>
                <span className={styles.clubStatValue}>{r.wins}</span>
              </div>
            ))}
          </div>

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>
              Найбільший приріст Ело {club?.elo ? 'за сезон' : 'за 3 місяці'}
            </div>
            {clubStats && genderClubEloGains.length === 0 && <div className={styles.empty}>Ще немає даних</div>}
            {genderClubEloGains.map((r, i) => (
              <div key={r.playerId} className={styles.clubStatRow}>
                <span className={styles.clubStatRank}>{i + 1}.</span>
                <PlayerAvatar player={r.player} size={24} />
                <span className={styles.clubStatName}>{r.player.full_name}</span>
                <span className={styles.clubStatValuePositive}>+{r.gain}</span>
              </div>
            ))}
          </div>

          <div className={styles.sectionLabel}>Порівняти гравців</div>
          <div className={styles.compareCard}>
            <div className={styles.comparePickerRow}>
              <input
                className={styles.compareInput}
                placeholder="Гравець А — ім'я або логін"
                aria-label="Пошук гравця А для порівняння"
                value={loginA ? loginA.full_name : queryA}
                onChange={(e) => {
                  setLoginA(null);
                  setQueryA(e.target.value);
                }}
              />
              {!loginA && queryA.trim().length >= 2 && suggestionsA.length > 0 && (
                <div className={styles.compareSuggestions}>
                  {suggestionsA.map((p) => (
                    <div
                      key={p.id}
                      className={styles.compareSuggestionRow}
                      onClick={() => {
                        setLoginA(p);
                        setQueryA('');
                        setSuggestionsA([]);
                      }}
                      {...pressable(() => {
                        setLoginA(p);
                        setQueryA('');
                        setSuggestionsA([]);
                      })}
                    >
                      <PlayerAvatar player={p} size={24} />
                      <div>
                        <div className={styles.compareSuggestionName}>{p.full_name}</div>
                        <div className={styles.compareSuggestionLogin}>@{p.login}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.comparePickerRow}>
              <input
                className={styles.compareInput}
                placeholder="Гравець Б — ім'я або логін"
                aria-label="Пошук гравця Б для порівняння"
                value={loginB ? loginB.full_name : queryB}
                onChange={(e) => {
                  setLoginB(null);
                  setQueryB(e.target.value);
                }}
              />
              {!loginB && queryB.trim().length >= 2 && suggestionsB.length > 0 && (
                <div className={styles.compareSuggestions}>
                  {suggestionsB.map((p) => (
                    <div
                      key={p.id}
                      className={styles.compareSuggestionRow}
                      onClick={() => {
                        setLoginB(p);
                        setQueryB('');
                        setSuggestionsB([]);
                      }}
                      {...pressable(() => {
                        setLoginB(p);
                        setQueryB('');
                        setSuggestionsB([]);
                      })}
                    >
                      <PlayerAvatar player={p} size={24} />
                      <div>
                        <div className={styles.compareSuggestionName}>{p.full_name}</div>
                        <div className={styles.compareSuggestionLogin}>@{p.login}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className={styles.compareBtn} disabled={compareLoading} onClick={handleCompare}>
              {compareLoading ? 'Завантаження...' : 'Порівняти'}
            </button>
            {compareError && <div className={styles.searchError}>{compareError}</div>}
          </div>

          {compareResult && (
            <CompareResult
              playerA={compareResult.playerA}
              playerB={compareResult.playerB}
              statsA={compareResult.statsA}
              statsB={compareResult.statsB}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Leaderboard pieces, styled after a game leaderboard ──

// Place badge: gold / silver / bronze for the podium, a plain tile after.
function RankBadge({ n }) {
  const tone = n === 1 ? styles.rankGold : n === 2 ? styles.rankSilver : n === 3 ? styles.rankBronze : '';
  return <div className={`${styles.rankBadge} ${tone}`}>{n}</div>;
}

// The score on the right: a dark pill with the rating's emblem.
function ScorePill({ value, kind }) {
  return (
    <div className={styles.scorePill}>
      <span className={`${styles.scoreIcon} ${kind === 'avp' ? styles.scoreIconAvp : ''}`} aria-hidden="true">
        {kind === 'avp' ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
            <path d="M5 4h14v3a5 5 0 0 1-4 4.9V14h2v2H7v-2h2v-2.1A5 5 0 0 1 5 7V4Zm-3 1h2v2a3 3 0 0 0 1 2.2V11A5 5 0 0 1 2 7V5Zm18 0h2v2a5 5 0 0 1-3 4.6V9.2A3 3 0 0 0 20 7V5ZM8 18h8v2H8v-2Z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
          </svg>
        )}
      </span>
      <span className={styles.scoreNum}>{value}</span>
    </div>
  );
}

// The season banner over the list — scrolls away with it.
function SeasonBanner({ title, season, archived, kind }) {
  if (!season) return null;
  return (
    <div className={`${styles.banner} ${kind === 'avp' ? styles.bannerAvp : ''}`}>
      <span className={styles.bannerShine} aria-hidden="true" />
      <div className={styles.bannerEmblem} aria-hidden="true">
        {kind === 'avp' ? (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff">
            <path d="M5 4h14v3a5 5 0 0 1-4 4.9V14h2v2H7v-2h2v-2.1A5 5 0 0 1 5 7V4Zm-3 1h2v2a3 3 0 0 0 1 2.2V11A5 5 0 0 1 2 7V5Zm18 0h2v2a5 5 0 0 1-3 4.6V9.2A3 3 0 0 0 20 7V5ZM8 18h8v2H8v-2Z" />
          </svg>
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
          </svg>
        )}
      </div>
      <div className={styles.bannerRibbon}>{title}</div>
      <div className={styles.bannerSeason}>
        {season.name} · {seasonDates(season)}
        {archived ? ' · архів' : season.ends_on === null ? ' · поточний' : ''}
      </div>
    </div>
  );
}

// get_user_format_stats returns the format CODE since migration 049; the
// label comes from lib/formats (before 049 it was a ready-made name).
const statFormat = (s) => s.format_kind || s.format_name;
const formatTitle = (f) => getFormat(f)?.displayName || f;

function CompareResult({ playerA, playerB, statsA, statsB }) {
  const allFormats = Array.from(new Set([...statsA.map(statFormat), ...statsB.map(statFormat)]));

  function findStat(stats, format) {
    return stats.find((s) => statFormat(s) === format);
  }

  return (
    <div className={styles.compareResultCard}>
      <div className={styles.compareHeaderRow}>
        <div className={styles.comparePlayerCol}>
          <PlayerAvatar player={playerA} size={40} />
          <div className={styles.comparePlayerName}>{playerA.full_name}</div>
          <div className={styles.comparePlayerElo}>{playerA.elo} Ело</div>
        </div>
        <div className={styles.compareVs}>VS</div>
        <div className={styles.comparePlayerCol}>
          <PlayerAvatar player={playerB} size={40} />
          <div className={styles.comparePlayerName}>{playerB.full_name}</div>
          <div className={styles.comparePlayerElo}>{playerB.elo} Ело</div>
        </div>
      </div>

      <div className={styles.compareScope}>За весь час</div>
      {allFormats.length === 0 && <div className={styles.empty}>Ще немає завершених турнірів у жодного з гравців</div>}

      {allFormats.map((format) => {
        const a = findStat(statsA, format);
        const b = findStat(statsB, format);
        const winRateA = a && a.games_played > 0 ? Math.round((a.games_won / a.games_played) * 100) : 0;
        const winRateB = b && b.games_played > 0 ? Math.round((b.games_won / b.games_played) * 100) : 0;

        return (
          <div key={format} className={styles.compareFormatRow}>
            <div className={styles.compareFormatName}>{formatTitle(format)}</div>
            <div className={styles.compareStatsGrid}>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateA}%</div>
                <div className={styles.compareStatSmall}>{a?.tournaments_played ?? 0} турн. · {gamesUk(a?.games_played ?? 0)}</div>
              </div>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateB}%</div>
                <div className={styles.compareStatSmall}>{b?.tournaments_played ?? 0} турн. · {gamesUk(b?.games_played ?? 0)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
