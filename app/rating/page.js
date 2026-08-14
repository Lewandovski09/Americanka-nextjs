'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';
import { teamAWon } from '@/lib/formats/sets';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './rating.module.css';

export default function RatingPage() {
  const { player } = useCurrentPlayer();
  const [tab, setTab] = useState('rating'); // 'rating' | 'avp' | 'stats'
  const [gender, setGender] = useState('M');
  const [category, setCategory] = useState('all');
  const [players, setPlayers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // ── AVP season standings ──
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [avpRows, setAvpRows] = useState([]);
  const [avpLoading, setAvpLoading] = useState(false);

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

  // ── Club-wide statistics (Статистика tab) ──
  const [clubStatsLoaded, setClubStatsLoaded] = useState(false);
  const [clubStreaks, setClubStreaks] = useState([]);
  const [clubTournamentWins, setClubTournamentWins] = useState([]);
  const [clubEloGains, setClubEloGains] = useState([]);

  // Switching tabs used to refetch everything from scratch every single
  // time, even flipping straight back to a tab shown seconds ago —
  // that round-trip is what actually made tab switching feel slow, not
  // rendering. These caches make a repeat visit instant (last-known
  // data renders immediately) while a fresh fetch still runs quietly
  // underneath to catch anything that changed — a manual approval, a
  // new result — without the visible spinner/blank-state coming back
  // every time.
  const ratingCacheRef = useRef({}); // `${gender}:${category}` -> players[]
  const avpCacheRef = useRef({}); // seasonId -> rows[]

  useEffect(() => {
    if (tab !== 'rating') return;
    const cacheKey = `${gender}:${category}`;
    const cached = ratingCacheRef.current[cacheKey];
    if (cached) setPlayers(cached); // show the last-known list instantly

    async function load() {
      const supabase = createClient();
      let query = supabase
        .from('players')
        .select('id, full_name, login, elo, photo_url')
        .eq('gender', gender)
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false });

      if (category !== 'all') {
        const catDef = SKILL_CATEGORIES.find((c) => c.id === category);
        query = query.gte('elo', catDef.range[0]).lt('elo', catDef.range[1]);
      }

      const { data } = await query;

      // Real tournament count, not the players.tournaments_played
      // counter — that column accumulates by +1 per finishCategory
      // call with no protection against being bumped twice for the
      // same tournament (the same class of drift partner_stats had).
      // tournament_placements is written idempotently (cleared and
      // rewritten each time a category finishes) and is exactly the
      // "did this player actually place in this tournament" source of
      // truth already fixed and backfilled earlier — counting rows in
      // it directly can't drift the way an accumulating counter can.
      //
      // Scoped to Americanka specifically here: Ело itself is now only
      // ever driven by Americanka results (see the score route's
      // auto-Ело), so "tournaments played" on THIS tab means
      // Americanka tournaments, not every format combined — AVP's own
      // tab already shows the all-formats count via tournaments_counted.
      const ids = (data || []).map((p) => p.id);
      const { data: placements } = ids.length
        ? await supabase.from('tournament_placements').select('player_id, tournament_id').in('player_id', ids)
        : { data: [] };

      const tIds = [...new Set((placements || []).map((tp) => tp.tournament_id))];
      const { data: tours } = tIds.length
        ? await supabase.from('tournaments').select('id, event_id').in('id', tIds)
        : { data: [] };
      const eventIds = [...new Set((tours || []).map((t) => t.event_id).filter(Boolean))];
      const { data: events } = eventIds.length
        ? await supabase.from('tournament_events').select('id, format_kind').in('id', eventIds)
        : { data: [] };
      const formatByEvent = new Map((events || []).map((ev) => [ev.id, ev.format_kind]));
      const formatByTournament = new Map((tours || []).map((t) => [t.id, formatByEvent.get(t.event_id)]));

      const countByPlayer = new Map();
      (placements || []).forEach((tp) => {
        if (formatByTournament.get(tp.tournament_id) !== 'americanka') return;
        countByPlayer.set(tp.player_id, (countByPlayer.get(tp.player_id) || 0) + 1);
      });
      const withCounts = (data || []).map((p) => ({ ...p, tournaments_played: countByPlayer.get(p.id) || 0 }));

      ratingCacheRef.current[cacheKey] = withCounts;
      setPlayers(withCounts);
    }
    load();
  }, [gender, category, tab]);

  // Seasons are loaded once — the newest first, and the newest is what
  // the tab opens on.
  useEffect(() => {
    if (tab !== 'avp' || seasons.length > 0) return;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('avp_seasons')
        .select('id, name, starts_on, ends_on')
        .order('starts_on', { ascending: false });
      setSeasons(data || []);
      setSeasonId((prev) => prev || data?.[0]?.id || null);
    }
    load();
  }, [tab, seasons.length]);

  // The standings view sums the ledger, so it holds points but no
  // profiles — the players are fetched alongside and joined here.
  useEffect(() => {
    if (tab !== 'avp' || !seasonId) return;
    const cached = avpCacheRef.current[seasonId];
    if (cached) {
      setAvpRows(cached); // instant on a repeat visit — no spinner
    } else {
      setAvpLoading(true);
    }

    async function load() {
      const supabase = createClient();
      const { data: standings } = await supabase
        .from('avp_standings')
        .select('player_id, points, tournaments_counted')
        .eq('season_id', seasonId)
        .order('points', { ascending: false });

      const ids = (standings || []).map((s) => s.player_id);
      const { data: profiles } = ids.length
        ? await supabase
            .from('players')
            .select('id, full_name, login, photo_url, gender, elo')
            .in('id', ids)
        : { data: [] };

      const byId = new Map((profiles || []).map((p) => [p.id, p]));
      const rows = (standings || [])
        .map((s) => ({ ...s, player: byId.get(s.player_id) }))
        .filter((s) => s.player);
      avpCacheRef.current[seasonId] = rows;
      setAvpRows(rows);
      setAvpLoading(false);
    }
    load();
  }, [tab, seasonId]);

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
        .from('players')
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
        .from('players')
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

  // Club-wide leaderboards for the Статистика tab — loaded once, lazily,
  // the first time the tab is opened (same lazy pattern the rating/AVP
  // tabs already use). Each of the three is one club-wide query rather
  // than one query per player, so this stays fast regardless of how
  // many people are in the club.
  useEffect(() => {
    if (tab !== 'stats' || clubStatsLoaded) return;
    async function loadClubStats() {
      const supabase = createClient();
      const since3mo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      // ── Longest current win streaks ──
      // Fetched from a bounded recent window (3 months, same window as
      // the Ело-gain stat below) rather than truly "all games ever" —
      // a real active streak will always be inside a recent window;
      // reaching back further would cost a much bigger query for
      // streaks nobody would actually be riding any more.
      const { data: recentMatches } = await supabase
        .from('matches')
        .select('team_a_players, team_b_players, set1, set2, set3, played_at')
        .eq('played', true)
        .gte('played_at', since3mo)
        .order('played_at', { ascending: false })
        .limit(500);

      const gamesByPlayer = new Map();
      (recentMatches || []).forEach((m) => {
        const aWon = teamAWon(m);
        [...(m.team_a_players || [])].forEach((id) => {
          if (!gamesByPlayer.has(id)) gamesByPlayer.set(id, []);
          gamesByPlayer.get(id).push({ won: aWon, played_at: m.played_at });
        });
        [...(m.team_b_players || [])].forEach((id) => {
          if (!gamesByPlayer.has(id)) gamesByPlayer.set(id, []);
          gamesByPlayer.get(id).push({ won: !aWon, played_at: m.played_at });
        });
      });

      const streakByPlayer = [];
      for (const [playerId, games] of gamesByPlayer.entries()) {
        games.sort((a, b) => new Date(b.played_at) - new Date(a.played_at));
        let streak = 0;
        for (const g of games) {
          if (!g.won) break;
          streak++;
        }
        if (streak >= 2) streakByPlayer.push({ playerId, streak });
      }
      streakByPlayer.sort((a, b) => b.streak - a.streak);
      const topStreaks = streakByPlayer.slice(0, 5);

      // ── Most GAMES won, every format EXCEPT Americanka ──
      // Not "won the whole tournament" (that's placement=1 in
      // tournament_placements) — individual match wins, the same way
      // get_player_format_stats counts games_won for one player, just
      // summed across the whole club and every non-Americanka format
      // at once. Separate queries + a JS-side join, same proven
      // pattern as the rating tab's own tournament count above —
      // safer than relying on nested-filter syntax (`!inner` +
      // dotted-path `.neq()`) that isn't used anywhere else in this
      // codebase and hasn't been verified to work as expected here.
      const { data: allTournaments } = await supabase.from('tournaments').select('id, event_id');
      const { data: allEvents } = await supabase.from('tournament_events').select('id, format_kind');
      const formatByEvent = new Map((allEvents || []).map((ev) => [ev.id, ev.format_kind]));
      const nonAmerIds = (allTournaments || [])
        .filter((t) => formatByEvent.get(t.event_id) && formatByEvent.get(t.event_id) !== 'americanka')
        .map((t) => t.id);

      const { data: nonAmerMatches } = nonAmerIds.length
        ? await supabase
            .from('matches')
            .select('team_a_players, team_b_players, set1, set2, set3')
            .in('tournament_id', nonAmerIds)
            .eq('played', true)
        : { data: [] };

      const winsByPlayer = new Map();
      (nonAmerMatches || []).forEach((m) => {
        const aWon = teamAWon(m);
        const winners = aWon ? m.team_a_players : m.team_b_players;
        (winners || []).forEach((id) => {
          winsByPlayer.set(id, (winsByPlayer.get(id) || 0) + 1);
        });
      });
      const topWins = [...winsByPlayer.entries()]
        .map(([playerId, wins]) => ({ playerId, wins }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 5);

      // ── Biggest Ело gain, last 3 months ──
      // reason='tournament_result' only — elo_history also holds
      // 'initial_approval' (a standard starting value logged when a
      // player is approved, the same round number for everyone,
      // nothing to do with playing) and 'admin_adjustment' (manual
      // corrections). Neither reflects "gained from playing", which is
      // the whole point of this leaderboard.
      const { data: eloRows } = await supabase
        .from('elo_history')
        .select('player_id, delta')
        .eq('reason', 'tournament_result')
        .gte('created_at', since3mo);
      const gainByPlayer = new Map();
      (eloRows || []).forEach((r) => {
        gainByPlayer.set(r.player_id, (gainByPlayer.get(r.player_id) || 0) + r.delta);
      });
      const topGains = [...gainByPlayer.entries()]
        .map(([playerId, gain]) => ({ playerId, gain }))
        .filter((r) => r.gain > 0)
        .sort((a, b) => b.gain - a.gain)
        .slice(0, 5);

      // One shared name/avatar lookup for everyone appearing in any list.
      const allIds = [
        ...new Set([...topStreaks.map((r) => r.playerId), ...topWins.map((r) => r.playerId), ...topGains.map((r) => r.playerId)]),
      ];
      const { data: profiles } = allIds.length
        ? await supabase.from('players').select('id, full_name, login, photo_url').in('id', allIds)
        : { data: [] };
      const profileById = new Map((profiles || []).map((p) => [p.id, p]));

      setClubStreaks(topStreaks.map((r) => ({ ...r, player: profileById.get(r.playerId) })).filter((r) => r.player));
      setClubTournamentWins(topWins.map((r) => ({ ...r, player: profileById.get(r.playerId) })).filter((r) => r.player));
      setClubEloGains(topGains.map((r) => ({ ...r, player: profileById.get(r.playerId) })).filter((r) => r.player));
      setClubStatsLoaded(true);
    }
    loadClubStats();
  }, [tab, clubStatsLoaded]);

  const filteredAvp = avpRows
    .filter((r) => r.player.gender === gender)
    .filter((r) => {
      const q = searchTerm.trim().toLowerCase();
      if (!q) return true;
      return r.player.login?.toLowerCase().includes(q) || r.player.full_name?.toLowerCase().includes(q);
    });

  const filteredPlayers = searchTerm.trim()
    ? players.filter(
        (p) =>
          p.login.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
          p.full_name.toLowerCase().includes(searchTerm.trim().toLowerCase())
      )
    : players;

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
      supabase.rpc('get_player_format_stats', { p_player_id: loginA.id }),
      supabase.rpc('get_player_format_stats', { p_player_id: loginB.id }),
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
        <button className={`${styles.tabBtn} ${tab === 'rating' ? styles.tabBtnOn : ''}`} onClick={() => setTab('rating')} aria-pressed={tab === 'rating'}>
          Ело
        </button>
        <button className={`${styles.tabBtn} ${tab === 'avp' ? styles.tabBtnOn : ''}`} onClick={() => setTab('avp')} aria-pressed={tab === 'avp'}>
          AVP
        </button>
        <button className={`${styles.tabBtn} ${tab === 'stats' ? styles.tabBtnOn : ''}`} onClick={() => setTab('stats')} aria-pressed={tab === 'stats'}>
          Статистика
        </button>
      </div>

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

          <div className={styles.chipsRow}>
            <button className={`${styles.chip} ${category === 'all' ? styles.chipOn : ''}`} onClick={() => setCategory('all')} aria-pressed={category === 'all'}>
              Всі
            </button>
            {['A', 'B', 'C', 'D'].map((c) => (
              <button key={c} className={`${styles.chip} ${category === c ? styles.chipOn : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
                {c}
              </button>
            ))}
          </div>

          {filteredPlayers.length === 0 && <div className={styles.empty}>Немає гравців</div>}

          {filteredPlayers.map((p, i) => (
            <a
              key={p.id}
              href={p.id === player?.id ? '/profile' : `/players/${p.id}`}
              className={`${styles.playerRow} ${p.id === player?.id ? styles.meRow : ''}`}
            >
              <div className={styles.rank} style={i === 0 ? { color: 'var(--rust)', fontWeight: 800 } : undefined}>{i + 1}</div>
              <PlayerAvatar player={p} size={36} />
              <div className={styles.playerInfo}>
                <div className={styles.playerName}>{highlightMatch(p.full_name, searchTerm.trim())}</div>
                <div className={styles.playerMeta}>@{highlightMatch(p.login, searchTerm.trim())} · {p.tournaments_played} турн.</div>
              </div>
              <div className={styles.playerEloBox}>
                <div className={styles.playerElo}>{p.elo}</div>
                <div className={styles.playerCat}>{categoryForElo(p.elo)?.label}</div>
              </div>
            </a>
          ))}

          <div className={styles.sectionLabel}>Шкала рівнів</div>
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

          {seasons.length > 1 && (
            <div className={styles.chipsRow}>
              {seasons.map((s) => (
                <button
                  key={s.id}
                  className={`${styles.chip} ${seasonId === s.id ? styles.chipOn : ''}`}
                  onClick={() => setSeasonId(s.id)}
                  aria-pressed={seasonId === s.id}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {seasons.length === 0 && !avpLoading && (
            <div className={styles.empty}>Сезон ще не створено</div>
          )}
          {avpLoading && <div className={styles.empty}>Завантаження...</div>}
          {!avpLoading && seasons.length > 0 && filteredAvp.length === 0 && (
            <div className={styles.empty}>У цьому сезоні ще немає нарахованих очок</div>
          )}

          {filteredAvp.map((r, i) => (
            <a
              key={r.player_id}
              href={r.player_id === player?.id ? '/profile' : `/players/${r.player_id}`}
              className={`${styles.playerRow} ${r.player_id === player?.id ? styles.meRow : ''}`}
            >
              <div className={styles.rank} style={i === 0 ? { color: 'var(--rust)', fontWeight: 800 } : undefined}>
                {i + 1}
              </div>
              <PlayerAvatar player={r.player} size={36} />
              <div className={styles.playerInfo}>
                <div className={styles.playerName}>{highlightMatch(r.player.full_name, searchTerm.trim())}</div>
                <div className={styles.playerMeta}>
                  @{highlightMatch(r.player.login, searchTerm.trim())} · {r.tournaments_counted} турн.
                </div>
              </div>
              <div className={styles.playerEloBox}>
                <div className={styles.playerElo}>{r.points}</div>
                <div className={styles.playerCat}>очок</div>
              </div>
            </a>
          ))}
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className={styles.sectionLabel}>Клубна статистика</div>

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>Найдовші серії перемог</div>
            {clubStreaks.length === 0 && <div className={styles.empty}>Ще немає активних серій</div>}
            {clubStreaks.map((r, i) => (
              <div key={r.playerId} className={styles.clubStatRow}>
                <span className={styles.clubStatRank}>{i + 1}.</span>
                <PlayerAvatar player={r.player} size={24} />
                <span className={styles.clubStatName}>{r.player.full_name}</span>
                <span className={styles.clubStatValue}>{r.streak}</span>
              </div>
            ))}
          </div>

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>Найбільше перемог у турнірах (крім Американки)</div>
            {clubTournamentWins.length === 0 && <div className={styles.empty}>Ще немає даних</div>}
            {clubTournamentWins.map((r, i) => (
              <div key={r.playerId} className={styles.clubStatRow}>
                <span className={styles.clubStatRank}>{i + 1}.</span>
                <PlayerAvatar player={r.player} size={24} />
                <span className={styles.clubStatName}>{r.player.full_name}</span>
                <span className={styles.clubStatValue}>{r.wins}</span>
              </div>
            ))}
          </div>

          <div className={styles.clubStatCard}>
            <div className={styles.clubStatTitle}>Найбільший приріст Ело за 3 місяці</div>
            {clubEloGains.length === 0 && <div className={styles.empty}>Ще немає даних</div>}
            {clubEloGains.map((r, i) => (
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

function CompareResult({ playerA, playerB, statsA, statsB }) {
  const allFormats = Array.from(new Set([...statsA.map((s) => s.format_name), ...statsB.map((s) => s.format_name)]));

  function findStat(stats, formatName) {
    return stats.find((s) => s.format_name === formatName);
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

      {allFormats.length === 0 && <div className={styles.empty}>Ще немає завершених турнірів у жодного з гравців</div>}

      {allFormats.map((format) => {
        const a = findStat(statsA, format);
        const b = findStat(statsB, format);
        const winRateA = a && a.games_played > 0 ? Math.round((a.games_won / a.games_played) * 100) : 0;
        const winRateB = b && b.games_played > 0 ? Math.round((b.games_won / b.games_played) * 100) : 0;

        return (
          <div key={format} className={styles.compareFormatRow}>
            <div className={styles.compareFormatName}>{format}</div>
            <div className={styles.compareStatsGrid}>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateA}%</div>
                <div className={styles.compareStatSmall}>{a?.tournaments_played ?? 0} турн. · {a?.games_played ?? 0} ігор</div>
              </div>
              <div className={styles.compareStatCol}>
                <div className={styles.compareStatBig}>{winRateB}%</div>
                <div className={styles.compareStatSmall}>{b?.tournaments_played ?? 0} турн. · {b?.games_played ?? 0} ігор</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
