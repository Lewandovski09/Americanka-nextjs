'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { computeStandings } from '@/lib/tournamentEngine';
import { getFormat } from '@/lib/formats';
import { pointsTargetForStage, targetForSet } from '@/lib/formats/scoring';
import { aggregateScore, pointsDiffA, teamAWon } from '@/lib/formats/sets';
import { rankGroupDetailed } from '@/lib/formats/kingOfBeach';
import { stageWeight, stageLabel, groupTitle, isSharedPlaceStage } from '@/lib/formats/stages';
import { computePlaces } from '@/app/events/shared';
import { slotMinutes } from '@/lib/schedule';
import PlayerAvatar from '@/components/PlayerAvatar';
import PlayerPicker from '@/components/PlayerPicker';
import BracketFlow from './BracketFlow';
import styles from './detail.module.css';

const TABS = { PLAYERS: 'players', TABLE: 'table', BRACKET: 'bracket', CHAT: 'chat' };

// How a person is named on the schedule, in the bracket and in the
// «Суддя» column — by surname, the way a game is called out on court.
// `last_name` is NOT NULL but may be empty (a one-word profile), so the
// full name stands in for those.
function surnameOf(row) {
  return row?.last_name?.trim() || row?.full_name || '—';
}

export default function TournamentDetailPage({ params }) {
  const { id } = params;
  const { player } = useCurrentPlayer();
  const router = useRouter();

  const [tournament, setTournament] = useState(null);
  const [siblings, setSiblings] = useState([]); // the event's other leagues
  const [tournamentPlayers, setTournamentPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [messages, setMessages] = useState([]);
  const [judges, setJudges] = useState([]); // the event's judging crew
  const [judgeInfo, setJudgeInfo] = useState({}); // player id → profile, for the «Суддя» column
  const [tab, setTab] = useState(TABS.PLAYERS);
  const [playersView, setPlayersView] = useState(null); // 'list' | 'results'; null = auto by status
  // Bracket search: the picked player, the game to zoom in on, and a
  // counter so picking the same player twice re-centres the view.
  const [focus, setFocus] = useState(null); // { playerId, matchId, seq }
  const [scoreModal, setScoreModal] = useState(null); // { matchId, teamAName, teamBName, pointsToWin }
  // Time and court are moved one at a time: { field: 'time'|'court', matchId, … }
  const [slotModal, setSlotModal] = useState(null);
  const [judgeModal, setJudgeModal] = useState(null); // admin / head judge: { matchId, title, current }
  const [chatText, setChatText] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: t } = await supabase
      .from('tournaments')
      .select('*, tournament_events(format_kind, points_to_win, points_mode, final_points_to_win)')
      .eq('id', id)
      .single();
    setTournament(t);

    // The other leagues of the same event, for the switcher above the
    // tabs — same order as the admin pages (gender, then label).
    if (t?.event_id) {
      const { data: sibs } = await supabase
        .from('tournaments')
        .select('id, category_label, gender, status')
        .eq('event_id', t.event_id)
        .order('gender', { ascending: true })
        .order('category_label', { ascending: true });
      setSiblings(sibs || []);
    } else {
      setSiblings([]);
    }

    const { data: tps } = await supabase
      .from('tournament_players')
      .select('player_id, players(full_name, last_name, photo_url)')
      .eq('tournament_id', id);
    setTournamentPlayers(tps || []);

    // Pair formats keep participants in tournament_teams — load them too
    // so match sides and the score dialog can show names.
    const { data: tt } = await supabase
      .from('tournament_teams')
      .select(
        `player1_id, player2_id,
         p1:players!tournament_teams_player1_id_fkey(full_name, first_name, last_name, city, photo_url),
         p2:players!tournament_teams_player2_id_fkey(full_name, first_name, last_name, city, photo_url)`
      )
      .eq('tournament_id', id);
    setTeams(tt || []);

    const { data: m } = await supabase.from('matches').select('*').eq('tournament_id', id).order('round_number');
    setMatches(m || []);

    // The judging crew belongs to the EVENT — the same people cover
    // every league of the day. Head judge first (that's who the score
    // and court rules give the extra rights to).
    let crew = [];
    if (t?.event_id) {
      const { data: js } = await supabase
        .from('tournament_judges')
        .select('player_id, is_head, players(full_name, last_name, photo_url)')
        .eq('event_id', t.event_id)
        .order('is_head', { ascending: false })
        .order('created_at', { ascending: true });
      crew = js || [];
    }
    setJudges(crew);

    // Names for the «Суддя» column. Normally everyone assigned to a game
    // is in the crew; a legacy category (no event) or a judge dropped
    // from the crew is looked up separately so the cell never shows a
    // bare id.
    const info = {};
    crew.forEach((j) => {
      if (j.players) info[j.player_id] = j.players;
    });
    const missing = [...new Set((m || []).map((x) => x.judge_id).filter((pid) => pid && !info[pid]))];
    if (missing.length > 0) {
      const { data: extra } = await supabase
        .from('players')
        .select('id, full_name, last_name, photo_url')
        .in('id', missing);
      (extra || []).forEach((p) => {
        info[p.id] = p;
      });
    }
    setJudgeInfo(info);

    const { data: msgs } = await supabase
      .from('tournament_messages')
      .select('*, players(full_name)')
      .eq('tournament_id', id)
      .order('created_at');
    setMessages(msgs || []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: re-fetch matches when anyone updates a score, so the
  // live table updates for everyone watching, not just the submitter.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tournament-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${id}` }, load)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tournament_messages', filter: `tournament_id=eq.${id}` },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  // A player picked in the bracket search: bring their game into view.
  // The flowchart zooms and centres itself; this covers the classic
  // columns (and the group cards under the flowchart), whose blocks
  // carry a dom id.
  useEffect(() => {
    if (!focus?.matchId) return;
    const el = document.getElementById(`match-${focus.matchId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [focus?.matchId, focus?.seq]);

  if (!tournament) return <div className={styles.loading}>Завантаження...</div>;

  const playersForEngine = tournamentPlayers.map((tp) => ({
    id: tp.player_id,
    full_name: tp.players.full_name,
  }));
  const standings = computeStandings(playersForEngine, matches);
  const playedCount = matches.filter((m) => m.played).length;
  const allDone = playedCount === matches.length && matches.length > 0;
  // A finished category opens on its results; before that — on the roster.
  const playersViewResolved = playersView || (tournament.status === 'done' ? 'results' : 'list');

  // Scoring rule for the dialog: americanka is "sum to 31", everyone else
  // is "first to N, win by 2".
  const event = tournament.tournament_events;
  const format = getFormat(event?.format_kind);
  const isSum = format?.scoring === 'sum31';
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  // How many sets a match may have (king of the beach: strictly one).
  const maxSets = isSum ? 1 : format?.maxSets ?? 3;
  // Schedule table width, for the section header rows: №, час, корт,
  // суддя, команда 1, vs, команда 2, результат — plus «+/-» (solo
  // formats only) and the per-set columns.
  const schedColumns = 8 + (isPair ? 0 : 1) + (maxSets > 1 ? 3 : 0);
  const scoringConfig = {
    points_to_win: tournament.points_to_win ?? event?.points_to_win ?? 21,
    points_mode: event?.points_mode,
    final_points_to_win: event?.final_points_to_win,
  };

  // The schedule and the planned times follow the tournament order:
  // stage by stage, group by group (placeholders of future rounds
  // included, so the whole day is visible up front).
  const scheduleSections = buildScheduleSections(matches);
  const orderedMatches = scheduleSections.flatMap((s) => s.matches);

  // Game numbers shared by the schedule table and «Сітка v2», so «гра
  // №12» means the same match in both views.
  const gameNoById = {};
  orderedMatches.forEach((m, i) => {
    gameNoById[m.id] = i + 1;
  });
  // The flowchart bracket needs winner-pointers to draw its lines;
  // formats without them (americanka rounds, King groups) fall back to
  // the columns-of-blocks view.
  const hasFlow = matches.some((m) => m.winner_to_match_id);

  // Start time of every game. Normally it is stored on the match itself
  // (stamped at category start, movable by an admin). Games created
  // before that column existed have none — for those the old projection
  // stands in: each court runs its own queue from the category start
  // time, and a game blocks its court for one slot.
  const plannedByMatchId = {};
  {
    const startMs = tournament.scheduled_at ? new Date(tournament.scheduled_at).getTime() : null;
    const courtCursor = {};
    for (const m of orderedMatches) {
      const court = m.court || 1;
      const t = m.scheduled_at ? new Date(m.scheduled_at).getTime() : courtCursor[court] ?? startMs;
      if (t == null || Number.isNaN(t)) continue;
      plannedByMatchId[m.id] = t;
      const target = isSum ? 31 : pointsTargetForStage(scoringConfig, m.stage);
      courtCursor[court] = t + slotMinutes(target) * 60000;
    }
  }

  // Name/avatar lookup covering both solo (americanka/king) and pair
  // (tournament_teams) formats.
  const playerInfo = {};
  tournamentPlayers.forEach((tp) => {
    if (tp.players) playerInfo[tp.player_id] = tp.players;
  });
  teams.forEach((tt) => {
    if (tt.p1) playerInfo[tt.player1_id] = tt.p1;
    if (tt.p2) playerInfo[tt.player2_id] = tt.p2;
  });

  function playerById(pid) {
    return playerInfo[pid];
  }

  // Short label for a match side: 'Коваль/Мельник' (pair) or 'Коваль'.
  // Surnames, not first names — that is how the club calls a game out
  // loud and how the paper sheets are written. A one-word profile has an
  // empty last_name, so it falls back to whatever the profile has.
  function teamLabel(ids) {
    if (!ids || ids.length === 0) return '';
    return ids.map((pid) => surnameOf(playerById(pid))).join('/');
  }

  // Everyone playing this category, for the bracket search box.
  const searchablePlayers = Object.entries(playerInfo)
    .map(([pid, p]) => ({ id: pid, full_name: p?.full_name || '—', photo_url: p?.photo_url || null }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'uk'));

  // The game to jump to for a player: the one they are about to play
  // (first game still without a score), or — if everything of theirs is
  // done — the last one they played.
  function activeMatchFor(pid) {
    const mine = orderedMatches.filter((m) =>
      [...(m.team_a_players || []), ...(m.team_b_players || [])].includes(pid)
    );
    if (mine.length === 0) return null;
    return mine.find((m) => !m.played) || mine[mine.length - 1];
  }

  function focusOnPlayer(pid) {
    const m = pid ? activeMatchFor(pid) : null;
    setFocus(pid ? { playerId: pid, matchId: m?.id || null, seq: (focus?.seq || 0) + 1 } : null);
  }

  // Who is running this day. The head judge shares the "on the court"
  // powers with the admin — correcting a score, moving a game to a free
  // court, saying who judges it; the timetable stays the admin's.
  const isAdmin = !!player?.is_admin;
  const isHeadJudge = judges.some((j) => j.is_head && j.player_id === player?.id);
  const live = tournament.status !== 'done';

  // An already-played game may be corrected, but only by the admin or
  // the head judge, and only while its stage is still the current one:
  // once anything of a later stage has been played (or the bracket match
  // it feeds into is decided), the score is locked. Mirrors the
  // server-side check.
  function canEditScore(m) {
    if (!(isAdmin || isHeadJudge) || !m.played || !live) return false;
    const downstream = [m.winner_to_match_id, m.loser_to_match_id].filter(Boolean);
    if (downstream.length > 0) {
      return downstream.every((id) => !matches.find((x) => x.id === id)?.played);
    }
    const s = m.stage || '';
    // Leaf bracket matches (final, placement games) feed nothing further.
    if (m.is_final || /^p\d+_\d+$/.test(s) || s === 'gf') return true;
    if (!s) return true; // americanka: no stages until the manual finish
    const w = stageWeight(s);
    return !matches.some((x) => x.played && x.stage && stageWeight(x.stage) > w);
  }

  // Time and court of a single game are theirs to move — the day slips,
  // a court frees up early. Nothing else on the schedule shifts: only
  // the game that was touched moves.
  const courts = tournament.courts?.length ? tournament.courts : [1];
  // The timetable stays the admin's; moving a game to a free court is the
  // head judge's call on the day — so the two cells open on their own.
  const canEditTime = isAdmin && live;
  const canEditCourt = (isAdmin || isHeadJudge) && live;
  const canAssignJudge = (isAdmin || isHeadJudge) && live;

  function judgeName(pid) {
    if (!pid) return '';
    return surnameOf(judgeInfo[pid]);
  }

  // «Час» — only the clock is editable. The DAY the game is played on is
  // never in question (nobody moves a game to another date from here), so
  // it is kept aside and the hours/minutes are put back onto it — which
  // also means a category that runs past midnight keeps its own day.
  function openTimeModal(m, planned) {
    // No stored time and no projection (a category with no start time at
    // all) — fall back to the day of the category itself.
    const base = planned || (tournament.scheduled_at ? new Date(tournament.scheduled_at) : new Date());
    setSlotModal({ field: 'time', matchId: m.id, day: base, time: toTimeInput(base) });
  }

  function openCourtModal(m) {
    setSlotModal({ field: 'court', matchId: m.id, court: m.court || 1 });
  }

  // One field per request: whatever is left out keeps its value (and the
  // head judge's court-only request stays a court-only request).
  async function saveSlot(patch) {
    const res = await fetch(`/api/matches/${slotModal.matchId}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!data.success) {
      setSlotModal((prev) => ({ ...prev, error: data.error }));
      return;
    }
    setSlotModal(null);
    load();
  }

  function handleSaveTime() {
    const [h, min] = (slotModal.time || '').split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(min)) {
      setSlotModal((prev) => ({ ...prev, error: 'Вкажіть час' }));
      return;
    }
    const when = new Date(slotModal.day);
    when.setHours(h, min, 0, 0);
    saveSlot({ scheduledAt: when.toISOString() });
  }

  async function handleSaveJudge(playerId) {
    const res = await fetch(`/api/matches/${judgeModal.matchId}/judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    const data = await res.json();
    if (!data.success) {
      setJudgeModal((prev) => ({ ...prev, error: data.error }));
      return;
    }
    setJudgeModal(null);
    load();
  }

  // One row of the schedule table. Placeholder games (future rounds
  // whose teams are not decided yet) show '· · ·' and are not clickable.
  function renderScheduleRow(m, i) {
    const ready = m.team_a_players?.length > 0 && m.team_b_players?.length > 0;
    const walkover = m.played && !(m.team_b_players?.length > 0);
    const nameA = teamLabel(m.team_a_players) || '· · ·';
    const nameB = walkover ? 'прохід' : teamLabel(m.team_b_players) || '· · ·';
    const diff = m.played ? pointsDiffA(m) : null;
    const agg = m.played ? aggregateScore(m) : null;
    const planned = plannedByMatchId[m.id] ? new Date(plannedByMatchId[m.id]) : null;
    const editable = canEditScore(m);
    const clickable = (!m.played && ready) || editable;
    const future = !m.played && !ready;
    // The time and the court are moved SEPARATELY — one is the timetable
    // (admin), the other is what happens on the day (admin or head
    // judge), and they are almost never changed together. Both cells
    // swallow the click instead of bubbling to the row, which opens the
    // score.
    const timeProps = canEditTime
      ? {
          className: styles.slotCell,
          title: 'Змінити час',
          onClick: (e) => {
            e.stopPropagation();
            openTimeModal(m, planned);
          },
        }
      : {};
    const courtProps = canEditCourt
      ? {
          className: styles.slotCell,
          title: 'Змінити корт',
          onClick: (e) => {
            e.stopPropagation();
            openCourtModal(m);
          },
        }
      : {};
    // Same idea for the judge cell: it belongs to the admin and the head
    // judge, so it swallows the click instead of opening the score.
    const judgeProps = canAssignJudge
      ? {
          className: styles.slotCell,
          title: 'Призначити суддю',
          onClick: (e) => {
            e.stopPropagation();
            setJudgeModal({
              matchId: m.id,
              title: `${nameA} — ${nameB}`,
              current: m.judge_id || null,
            });
          },
        }
      : {};
    return (
      <tr
        key={m.id}
        className={`${clickable ? styles.schedRowPending : ''} ${future ? styles.schedRowFuture : ''}`}
        onClick={() => clickable && openScoreModal(m, nameA, nameB)}
      >
        <td>{i + 1}</td>
        <td {...timeProps}>
          {planned ? planned.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : '—'}
        </td>
        <td {...courtProps}>{m.court || 1}</td>
        <td {...judgeProps} className={`${judgeProps.className || ''} ${styles.judgeCell}`}>
          {m.judge_id ? judgeName(m.judge_id) : canAssignJudge ? '+' : '—'}
        </td>
        <td className={styles.schedTeamCol}>{nameA}</td>
        <td className={styles.schedVs}>vs</td>
        <td className={styles.schedTeamCol}>{nameB}</td>
        {!isPair && (
          <td className={diff > 0 ? styles.positive : diff < 0 ? styles.negative : ''}>
            {diff == null ? '' : diff > 0 ? `+${diff}` : diff}
          </td>
        )}
        <td className={styles.schedScore}>{agg ? `${agg[0]}:${agg[1]}` : ''}</td>
        {maxSets > 1 && (
          <>
            <td>{m.set1 ? m.set1.join(':') : ''}</td>
            <td>{m.set2 ? m.set2.join(':') : ''}</td>
            <td>{m.set3 ? m.set3.join(':') : ''}</td>
          </>
        )}
      </tr>
    );
  }

  // Shared opener for both the schedule table and the «Ігри» tab.
  // Americanka enters one sum-31 score; first-to formats enter up to
  // three sets (the 2nd/3rd are optional). A played match (admin edit)
  // opens prefilled with its current score.
  function openScoreModal(m, nameA, nameB) {
    const sets = [m.set1, m.set2, m.set3].map((s) => ({
      a: s?.[0] != null ? String(s[0]) : '',
      b: s?.[1] != null ? String(s[1]) : '',
    }));
    // Only the played sets are shown up front; the rest hide behind
    // «+ Додати партію» so the dialog stays one-row small.
    const filled = sets.filter((s) => s.a !== '' && s.b !== '').length;
    setScoreModal({
      matchId: m.id,
      nameA,
      nameB,
      scoreA: sets[0].a,
      scoreB: sets[0].b,
      sets,
      visibleSets: Math.max(1, filled),
      mode: isSum ? 'sum' : 'free',
      target: isSum ? 31 : pointsTargetForStage(scoringConfig, m.stage),
      // The deciding third set is the short one (15), whatever the
      // first two are played to.
      decider: isSum ? 31 : targetForSet(pointsTargetForStage(scoringConfig, m.stage), 2),
    });
  }

  async function handleSubmitScore() {
    const { matchId, mode, scoreA, scoreB } = scoreModal;
    const sets =
      mode === 'sum'
        ? [[Number(scoreA), Number(scoreB)]]
        : scoreModal.sets
            .filter((s) => s.a !== '' && s.b !== '')
            .map((s) => [Number(s.a), Number(s.b)]);
    if (sets.length === 0) {
      setScoreModal((prev) => ({ ...prev, error: 'Введіть рахунок першої партії' }));
      return;
    }
    const res = await fetch(`/api/matches/${matchId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sets }),
    });
    const data = await res.json();
    if (!data.success) {
      setScoreModal((prev) => ({ ...prev, error: data.error }));
      return;
    }
    setScoreModal(null);
    load();
  }

  async function handleFinish() {
    const res = await fetch(`/api/tournaments/${id}/finish`, { method: 'POST' });
    const data = await res.json();
    if (data.success) load();
  }

  // «Результати» view: placement rows [{ place, ids }] for the format at
  // hand. Only decided placements are listed — participants still in the
  // running don't show up until they finish or are knocked out.
  function resultRows() {
    if (matches.length === 0) return [];
    // Americanka: nobody is ever knocked out, so places exist only once
    // every game has been played.
    if (!matches.some((m) => m.stage)) {
      if (!allDone) return [];
      return standings.map((s, i) => ({ place: i + 1, ids: [s.player.id] }));
    }
    if (matches.some((m) => /^kr\d+$/.test(m.stage || ''))) return kingResults(matches);
    if (matches.some((m) => m.stage === 'gf' || /^(wb|lb)\d+$/.test(m.stage || ''))) return deResults(matches);
    // Crosses playoffs (incl. the file format): places come from the
    // final and the pX_Y placement matches.
    return computePlaces(matches, teams).map((p) => ({ place: p.place, ids: p.players }));
  }

  async function handleSendChat() {
    if (!chatText.trim() || !player) return;
    const supabase = createClient();
    await supabase.from('tournament_messages').insert({ tournament_id: id, player_id: player.id, text: chatText.trim() });
    setChatText('');
    load();
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>{tournament.name}</h2>

      {/* Leagues of the same event (Лайт / Медіум, ♂ / ♀) — switching
          just opens that category's page. */}
      {siblings.length > 1 && (
        <div className={styles.leagueTabs}>
          {siblings.map((c) => (
            <button
              key={c.id}
              className={`${styles.leagueTab} ${c.id === tournament.id ? styles.leagueTabOn : ''}`}
              onClick={() => c.id !== tournament.id && router.push(`/tournaments/${c.id}`)}
            >
              {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
              {c.category_label || 'Категорія'}
              {c.status === 'scheduled' && <span className={styles.leagueTabNote}> · не почалась</span>}
            </button>
          ))}
        </div>
      )}

      <div className={styles.tabs}>
        <TabBtn active={tab === TABS.PLAYERS} onClick={() => setTab(TABS.PLAYERS)}>
          Учасники
        </TabBtn>
        <TabBtn active={tab === TABS.TABLE} onClick={() => setTab(TABS.TABLE)}>
          Таблиця
        </TabBtn>
        <TabBtn active={tab === TABS.BRACKET} onClick={() => setTab(TABS.BRACKET)}>
          Сітка
        </TabBtn>
        <TabBtn active={tab === TABS.CHAT} onClick={() => setTab(TABS.CHAT)}>
          Чат
        </TabBtn>
      </div>

      {/* Participants tab: «Заявки» (who is registered) / «Результати»
          (who took which place). Results open by default once the
          category is finished. */}
      {tab === TABS.PLAYERS && (
        <>
          <div className={styles.subTabs}>
            {[
              ['list', 'Заявки'],
              ['results', 'Результати'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`${styles.subTab} ${playersViewResolved === key ? styles.subTabOn : ''}`}
                onClick={() => setPlayersView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === TABS.PLAYERS && playersViewResolved === 'results' && (
        <>
          {(() => {
            const rows = resultRows().filter((r) => r.ids?.length > 0);
            if (rows.length === 0) return <div className={styles.loading}>Результатів ще немає</div>;
            return (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Місце</th>
                    <th>{isPair ? 'Пара' : 'Гравець'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.ids.includes(player?.id) ? styles.meRow : ''}>
                      <td className={styles.placeCell}>
                        {r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place}
                      </td>
                      <td className={styles.nameCell}>
                        {r.ids.map((pid) => (
                          <PlayerAvatar key={pid} player={playerById(pid)} size={22} />
                        ))}
                        {r.ids.map((pid) => playerById(pid)?.full_name || '—').join(' / ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </>
      )}

      {tab === TABS.PLAYERS && playersViewResolved === 'list' && (
        <>
          {/* Solo formats: live standings double as the participant list.
              Pair formats: the registered pairs. */}
          {isPair ? (
            teams.length === 0 ? (
              <div className={styles.loading}>Учасників ще немає</div>
            ) : (
              <div className={styles.pairTableWrap}>
                <table className={`${styles.table} ${styles.pairTable}`}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th />
                      <th>Прізвище 1</th>
                      <th>Ім&apos;я 1</th>
                      <th>Місто 1</th>
                      <th>Прізвище 2</th>
                      <th>Ім&apos;я 2</th>
                      <th>Місто 2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((tt, i) => (
                      <tr
                        key={i}
                        className={[tt.player1_id, tt.player2_id].includes(player?.id) ? styles.meRow : ''}
                      >
                        <td>{i + 1}</td>
                        <td className={styles.pairAvatarCell}>
                          <span className={styles.avatarStack}>
                            <PlayerAvatar player={tt.p1} size={26} />
                            <PlayerAvatar player={tt.p2} size={26} />
                          </span>
                        </td>
                        <td>{tt.p1?.last_name || '—'}</td>
                        <td>{tt.p1?.first_name || '—'}</td>
                        <td className={styles.pairCityCell}>{tt.p1?.city || '—'}</td>
                        <td>{tt.p2?.last_name || '—'}</td>
                        <td>{tt.p2?.first_name || '—'}</td>
                        <td className={styles.pairCityCell}>{tt.p2?.city || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : standings.length === 0 ? (
            <div className={styles.loading}>Учасників ще немає</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Гравець</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.player.id} className={s.player.id === player?.id ? styles.meRow : ''}>
                    <td>{i + 1}</td>
                    <td className={styles.nameCell}>
                      <PlayerAvatar player={playerById(s.player.id)} size={22} />
                      {s.player.full_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Game schedule: every match in play order. Клік по незіграній
          грі відкриває введення рахунку. */}
      {tab === TABS.TABLE &&
        (matches.length === 0 ? (
            <div className={styles.loading}>Ігор ще немає</div>
          ) : (
            <div className={styles.schedWrap}>
              <table className={styles.schedTable}>
                <thead>
                  <tr>
                    <th>№ гри</th>
                    <th>Час</th>
                    <th>Корт</th>
                    <th>Суддя</th>
                    <th className={styles.schedTeamCol}>Команда 1</th>
                    <th />
                    <th className={styles.schedTeamCol}>Команда 2</th>
                    {/* Points differential is an americanka / King thing —
                        there it ranks the players. Pair formats are decided
                        by sets, so the column only adds noise. */}
                    {!isPair && <th title="(+15) → 21:15, (-12) → 12:21">+/-</th>}
                    <th>Результат</th>
                    {maxSets > 1 && (
                      <>
                        <th>1 сет</th>
                        <th>2 сет</th>
                        <th>3 сет</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let gameNo = 0;
                    return scheduleSections.map((sec) => [
                      scheduleSections.length > 1 && (
                        <tr key={`h-${sec.key}`} className={styles.schedSection}>
                          <td colSpan={schedColumns}>{sec.title}</td>
                        </tr>
                      ),
                      ...sec.matches.map((m) => {
                        gameNo += 1;
                        const i = gameNo - 1;
                        return renderScheduleRow(m, i);
                      }),
                    ]);
                  })()}
                </tbody>
              </table>
            </div>
          ))}

      {/* Manual finish is an americanka-only action: staged formats
          (king rounds, group+playoff) finish through their own flows. */}
      {tab === TABS.TABLE && isSum && allDone && player?.is_admin && tournament.status !== 'done' && (
        <button className={styles.finishBtn} onClick={handleFinish}>
          Зберегти результати турніру
        </button>
      )}

      {/* Interactive bracket: the flowchart with winner-lines like the
          paper sheet whenever the matches carry bracket pointers, the
          classic columns-of-blocks otherwise (americanka rounds, King
          groups). Pending games are highlighted and open the score
          dialog. The search above jumps to a player's current game. */}
      {tab === TABS.BRACKET && matches.length > 0 && (
        <BracketSearch
          players={searchablePlayers}
          focus={focus}
          onPick={focusOnPlayer}
          onClear={() => setFocus(null)}
        />
      )}
      {tab === TABS.BRACKET && hasFlow && matches.length > 0 && (
        <BracketFlow
          matches={matches}
          nameOf={teamLabel}
          numberOf={gameNoById}
          openScore={openScoreModal}
          canEdit={canEditScore}
          focusId={focus?.matchId || null}
          focusSeq={focus?.seq || 0}
        />
      )}
      {tab === TABS.BRACKET &&
        (matches.length === 0 ? (
          <div className={styles.loading}>Ігор ще немає</div>
        ) : (
          // Under the flowchart only the group stage is left to draw —
          // the knockout part is already up there.
          (() => {
            const cols = buildBracketColumns(matches).filter((col) => !hasFlow || col.groups);
            if (cols.length === 0) return null;
            return (
              <div className={styles.bracketWrap}>
                <div className={styles.bracketRow}>
                  {cols.map((col) => (
                    <div key={col.key} className={styles.bracketCol}>
                      <div className={styles.bracketColTitle}>{col.title}</div>
                      {col.groups
                        ? col.groups.map((g) => (
                            <GroupCard
                              key={g.index}
                              title={g.title}
                              solo={!isPair}
                              matches={g.matches}
                              nameOf={teamLabel}
                              openScore={openScoreModal}
                              canEdit={canEditScore}
                              focusId={focus?.matchId || null}
                            />
                          ))
                        : col.matches.map((m) => (
                            <MatchCard
                              key={m.id}
                              m={m}
                              label={col.withLabels ? stageLabel(m.stage) : null}
                              nameOf={teamLabel}
                              openScore={openScoreModal}
                              editable={canEditScore(m)}
                              focused={focus?.matchId === m.id}
                            />
                          ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        ))}

      {tab === TABS.CHAT && (
        <div>
          <div className={styles.chatBox}>
            {messages.map((m) => (
              <div key={m.id} className={m.player_id === player?.id ? styles.chatMsgMine : styles.chatMsg}>
                <div className={styles.chatName}>{m.players.full_name.split(' ')[0]}</div>
                <div className={styles.chatText}>{m.text}</div>
              </div>
            ))}
          </div>
          <div className={styles.chatBar}>
            <input
              className={styles.chatInput}
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder="Написати повідомлення..."
            />
            <button className={styles.chatSend} onClick={handleSendChat}>
              →
            </button>
          </div>
        </div>
      )}

      {slotModal && (
        <div className={styles.modalOverlay} onClick={() => setSlotModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>{slotModal.field === 'time' ? 'Час гри' : 'Корт'}</div>
            <div className={styles.modalSub}>
              Змінюється лише ця гра — решта розкладу залишається на місці.
            </div>

            {slotModal.field === 'time' ? (
              <>
                <label className={styles.slotLabel}>
                  Початок ·{' '}
                  {slotModal.day.toLocaleDateString('uk', { day: 'numeric', month: 'long' })}
                </label>
                <input
                  className={styles.slotInput}
                  type="time"
                  value={slotModal.time}
                  autoFocus
                  onChange={(e) => setSlotModal((prev) => ({ ...prev, time: e.target.value, error: null }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTime()}
                />
                {slotModal.error && <div className={styles.errMsg}>{slotModal.error}</div>}
                <button className={styles.btnPrimary} onClick={handleSaveTime}>
                  Зберегти
                </button>
              </>
            ) : (
              <>
                {/* One tap is the whole edit — no «Зберегти» to hunt for. */}
                <div className={styles.slotCourts}>
                  {courts.map((c) => (
                    <button
                      key={c}
                      className={`${styles.subTab} ${slotModal.court === c ? styles.subTabOn : ''}`}
                      onClick={() => saveSlot({ court: c })}
                    >
                      Корт {c}
                    </button>
                  ))}
                </div>
                {slotModal.error && <div className={styles.errMsg}>{slotModal.error}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Who judges this game. The crew of the event is offered first,
          but the pick is not limited to it — anybody registered can be
          handed a game, and joins the crew by being picked. */}
      {judgeModal && (
        <div className={styles.modalOverlay} onClick={() => setJudgeModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Суддя гри</div>
            <div className={styles.modalSub}>{judgeModal.title}</div>

            {judges.length > 0 && (
              <>
                <label className={styles.slotLabel}>Бригада турніру</label>
                <div className={styles.judgeQuick}>
                  {judges.map((j) => (
                    <button
                      key={j.player_id}
                      className={`${styles.subTab} ${
                        judgeModal.current === j.player_id ? styles.subTabOn : ''
                      }`}
                      onClick={() => handleSaveJudge(j.player_id)}
                    >
                      {surnameOf(j.players)}
                      {j.is_head ? ' ★' : ''}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className={styles.slotLabel}>Будь-який гравець</label>
            <PlayerPicker limit={12} onPick={(p) => handleSaveJudge(p.id)} />

            {judgeModal.error && <div className={styles.errMsg}>{judgeModal.error}</div>}
            {judgeModal.current && (
              <button className={styles.judgeClear} onClick={() => handleSaveJudge(null)}>
                Прибрати суддю
              </button>
            )}
          </div>
        </div>
      )}

      {scoreModal && (
        <div className={styles.modalOverlay} onClick={() => setScoreModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Рахунок гри</div>
            <div className={styles.modalTeams}>
              <span>{scoreModal.nameA || '—'}</span>
              <span className={styles.modalVs}>проти</span>
              <span>{scoreModal.nameB || '—'}</span>
            </div>
            <div className={styles.modalSub}>
              {scoreModal.mode === 'sum'
                ? `Сума має дорівнювати ${scoreModal.target}`
                : maxSets === 1
                ? `Одна партія до ${scoreModal.target}, різниця у 2 очки.`
                : scoreModal.decider === scoreModal.target
                ? `Партія до ${scoreModal.target}, різниця у 2 очки. 2-га і 3-тя партії — за потреби.`
                : `Партії до ${scoreModal.target}, вирішальна третя — до ${scoreModal.decider}. Різниця у 2 очки; 2-га і 3-тя — за потреби.`}
            </div>
            {scoreModal.mode === 'sum' ? (
              <div className={styles.scoreInputs}>
                <input
                  className={styles.scoreInput}
                  type="number"
                  value={scoreModal.scoreA}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Americanka auto-fills the complement to the sum.
                    setScoreModal((prev) => ({
                      ...prev,
                      scoreA: v,
                      scoreB: v !== '' ? String(prev.target - Number(v)) : prev.scoreB,
                    }));
                  }}
                />
                <span>:</span>
                <input
                  className={styles.scoreInput}
                  type="number"
                  value={scoreModal.scoreB}
                  onChange={(e) => {
                    const v = e.target.value;
                    setScoreModal((prev) => ({
                      ...prev,
                      scoreB: v,
                      scoreA: v !== '' ? String(prev.target - Number(v)) : prev.scoreA,
                    }));
                  }}
                />
              </div>
            ) : (
              <>
                {scoreModal.sets.slice(0, Math.min(scoreModal.visibleSets, maxSets)).map((s, i) => (
                  <div key={i} className={styles.setRow}>
                    <span className={styles.setName}>
                      {i + 1} сет
                      {maxSets > 1 && (
                        <span className={styles.setTarget}>до {targetForSet(scoreModal.target, i)}</span>
                      )}
                    </span>
                    <input
                      className={styles.scoreInput}
                      type="number"
                      value={s.a}
                      onChange={(e) =>
                        setScoreModal((prev) => ({
                          ...prev,
                          sets: prev.sets.map((x, xi) => (xi === i ? { ...x, a: e.target.value } : x)),
                        }))
                      }
                    />
                    <span>:</span>
                    <input
                      className={styles.scoreInput}
                      type="number"
                      value={s.b}
                      onChange={(e) =>
                        setScoreModal((prev) => ({
                          ...prev,
                          sets: prev.sets.map((x, xi) => (xi === i ? { ...x, b: e.target.value } : x)),
                        }))
                      }
                    />
                    {i > 0 && i === scoreModal.visibleSets - 1 ? (
                      <button
                        className={styles.setRemove}
                        title="Прибрати партію"
                        onClick={() =>
                          // Hide the row and drop its score so it isn't submitted.
                          setScoreModal((prev) => ({
                            ...prev,
                            visibleSets: prev.visibleSets - 1,
                            sets: prev.sets.map((x, xi) => (xi === i ? { a: '', b: '' } : x)),
                          }))
                        }
                      >
                        ✕
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
                {scoreModal.visibleSets < maxSets && (
                  <button
                    className={styles.addSetBtn}
                    onClick={() => setScoreModal((prev) => ({ ...prev, visibleSets: prev.visibleSets + 1 }))}
                  >
                    + Додати партію
                  </button>
                )}
              </>
            )}
            {scoreModal.error && <div className={styles.errMsg}>{scoreModal.error}</div>}
            <button className={styles.btnPrimary} onClick={handleSubmitScore}>
              Зберегти
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Date → value for <input type="time"> in local time.
function toTimeInput(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function groupByRound(matches) {
  const map = new Map();
  matches.forEach((m) => {
    if (!map.has(m.round_number)) map.set(m.round_number, []);
    map.get(m.round_number).push(m);
  });
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

// Schedule sections: one per stage, and per group inside grouped stages
// («Раунд 1 · Група А»). Derived from the same column structure as the
// bracket so both views list the games in identical order.
function buildScheduleSections(matches) {
  const sections = [];
  for (const col of buildBracketColumns(matches)) {
    if (col.groups) {
      for (const g of col.groups) {
        sections.push({
          key: `${col.key}-${g.index}`,
          title: col.groups.length > 1 ? `${col.title} · ${g.title}` : col.title,
          matches: g.matches,
        });
      }
    } else {
      sections.push({ key: col.key, title: col.title, matches: col.matches });
    }
  }
  return sections;
}

// ── Bracket view («Сітка») ─────────────────────────────────────

// Arrange the matches into ordered columns: the group stage and King
// rounds become columns of group cards; knockout stages become columns
// of match cards; every placement match (pX_Y) is collected into one
// final «Матчі за місця» column. Americanka has no stages — it gets a
// column per round instead.
function buildBracketColumns(matches) {
  if (!matches.some((m) => m.stage)) {
    return groupByRound(matches).map(([round, ms]) => ({
      key: `r${round}`,
      title: `Раунд ${round}`,
      matches: ms,
    }));
  }

  const stages = [...new Set(matches.map((m) => m.stage || 'group'))].sort(
    (a, b) => stageWeight(a) - stageWeight(b)
  );
  const cols = [];
  const placeMatches = [];
  for (const stage of stages) {
    const ms = matches
      .filter((m) => (m.stage || 'group') === stage)
      .sort(
        (a, b) => (a.group_index ?? 0) - (b.group_index ?? 0) || (a.round_number || 0) - (b.round_number || 0)
      );
    if (isSharedPlaceStage(stage)) {
      placeMatches.push(...ms);
      continue;
    }
    const isKingRound = /^kr\d+$/.test(stage);
    if (stage === 'group' || isKingRound) {
      const idxs = [...new Set(ms.map((m) => m.group_index ?? 0))].sort((a, b) => a - b);
      cols.push({
        key: stage,
        // The last King round is a single group of 4 — that's the final.
        title: isKingRound && idxs.length === 1 ? 'Фінал' : stageLabel(stage),
        groups: idxs.map((gi) => ({
          index: gi,
          title: groupTitle(gi),
          matches: ms.filter((m) => (m.group_index ?? 0) === gi),
        })),
      });
    } else {
      cols.push({ key: stage, title: stageLabel(stage), matches: ms });
    }
  }
  if (placeMatches.length > 0) {
    cols.push({ key: 'places', title: 'Матчі за місця', matches: placeMatches, withLabels: true });
  }
  return cols;
}

// ── Results («Результати») ────────────────────────────────────

const winnerLoserOf = (m) =>
  teamAWon(m)
    ? { w: m.team_a_players, l: m.team_b_players }
    : { w: m.team_b_players, l: m.team_a_players };

// King of the Beach placements: everyone is ranked by the last round
// they reached, and inside it by their performance (wins, points diff).
// The final four take places 1-4 by the final-round ranking, those
// knocked out a round earlier take 5+, and so on. Players whose fate
// isn't decided yet (their round is still being played, or they'd
// advance from it) are not listed — their places stay reserved.
function kingResults(matches) {
  const lastRound = {};
  for (const m of matches) {
    const kr = /^kr(\d+)$/.exec(m.stage || '');
    if (!kr) continue;
    const r = Number(kr[1]);
    for (const pid of [...(m.team_a_players || []), ...(m.team_b_players || [])]) {
      lastRound[pid] = Math.max(lastRound[pid] || 0, r);
    }
  }
  const rounds = [...new Set(Object.values(lastRound))].sort((a, b) => b - a);

  const out = [];
  let place = 1;
  for (const r of rounds) {
    const rm = matches.filter((m) => m.stage === `kr${r}`);
    const stayedIds = Object.keys(lastRound).filter((pid) => lastRound[pid] === r);

    // Placements of this round are decided only once it's fully played
    // AND its stayers are really out: either this was the final (a single
    // group of 4) or the next round has been dealt without them.
    const complete = rm.length > 0 && rm.every((m) => m.played);
    const isFinal = new Set(rm.map((m) => m.group_index ?? 0)).size === 1;
    const nextDealt = matches.some((m) => m.stage === `kr${r + 1}` && m.team_a_players?.length > 0);
    if (!complete || !(isFinal || nextDealt)) {
      place += stayedIds.length; // keep their places reserved
      continue;
    }

    // Rank each group of the round, then merge the stayers across groups.
    const stats = [];
    for (const gi of [...new Set(rm.map((m) => m.group_index ?? 0))]) {
      const gm = rm.filter((m) => (m.group_index ?? 0) === gi);
      const ids = [...new Set(gm.flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])]))];
      stats.push(...rankGroupDetailed(ids, gm));
    }
    const ranked = stats
      .filter((s) => stayedIds.includes(s.id))
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff);
    for (const s of ranked) out.push({ place: place++, ids: [s.id] });
  }
  return out;
}

// Double elimination placements: the final decides 1-2 and the bronze
// match 3-4 (the crossed-semifinal losers), then the losers of each
// lower-bracket round share a place, last round first (5-6, 7-8, 9-12,
// 13-16, …). Legacy grand-final brackets ('gf') have no bronze match —
// their shared places start at 3.
function deResults(matches) {
  const out = [];
  const legacy = matches.some((m) => m.stage === 'gf');
  const playedOut = legacy
    ? [['gf', 1, 2]]
    : [
        ['final', 1, 2],
        ['p3_4', 3, 4],
      ];
  for (const [stage, hi, lo] of playedOut) {
    const m = matches.find((x) => x.stage === stage && x.played);
    if (!m) continue;
    const { w, l } = winnerLoserOf(m);
    if (w?.length) out.push({ place: hi, ids: w });
    if (l?.length) out.push({ place: lo, ids: l });
  }
  let place = legacy ? 3 : 5;
  const lbRounds = [
    ...new Set(
      matches.filter((m) => /^lb\d+$/.test(m.stage || '')).map((m) => Number(m.stage.slice(2)))
    ),
  ].sort((a, b) => b - a);
  for (const r of lbRounds) {
    const losers = matches
      .filter((m) => m.stage === `lb${r}` && m.played)
      .map((m) => winnerLoserOf(m).l)
      .filter((l) => l?.length);
    for (const l of losers) out.push({ place, ids: l });
    place += losers.length;
  }
  return out;
}

// Rank the teams of one group (best first) by wins, then points diff.
function rankGroupTeams(groupMatches) {
  const stats = new Map();
  const keyOf = (ids) => [...(ids || [])].map(String).sort().join('|');
  for (const m of groupMatches) {
    for (const ids of [m.team_a_players, m.team_b_players]) {
      if (!ids?.length) continue;
      const k = keyOf(ids);
      if (!stats.has(k)) stats.set(k, { ids, wins: 0, diff: 0 });
    }
    if (!m.played) continue;
    const aWon = teamAWon(m);
    const d = pointsDiffA(m);
    const a = stats.get(keyOf(m.team_a_players));
    const b = stats.get(keyOf(m.team_b_players));
    if (a) {
      a.wins += aWon ? 1 : 0;
      a.diff += d;
    }
    if (b) {
      b.wins += aWon ? 0 : 1;
      b.diff -= d;
    }
  }
  return [...stats.values()].sort((x, y) => y.wins - x.wins || y.diff - x.diff);
}

// «Знайти гравця» over the bracket: type a name, pick from the players
// of this category, and their current game is centred and outlined in
// green. The picked player STAYS in the search field — avatar, name and
// a ✕ — and the game stays highlighted until that ✕ clears it.
function BracketSearch({ players, focus, onPick, onClear }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const found = q ? players.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 8) : [];
  const picked = focus ? players.find((p) => p.id === focus.playerId) : null;

  if (picked) {
    return (
      <div className={styles.searchWrap}>
        <div className={styles.searchSelected}>
          <PlayerAvatar player={picked} size={24} />
          <span className={styles.searchSelectedName}>{picked.full_name}</span>
          {!focus.matchId && <span className={styles.searchNote}>ігор немає</span>}
          <button className={styles.searchClear} onClick={onClear} aria-label="Прибрати гравця">
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.searchWrap}>
      <input
        className={styles.searchInput}
        value={query}
        placeholder="Знайти гравця у сітці…"
        onChange={(e) => setQuery(e.target.value)}
      />
      {found.length > 0 && (
        <div className={styles.searchList}>
          {found.map((p) => (
            <button
              key={p.id}
              className={styles.searchRow}
              onClick={() => {
                onPick(p.id);
                setQuery('');
              }}
            >
              <PlayerAvatar player={p} size={24} />
              <span className={styles.searchRowName}>{p.full_name}</span>
            </button>
          ))}
        </div>
      )}
      {q && found.length === 0 && <div className={styles.searchEmpty}>Нікого не знайдено</div>}
    </div>
  );
}

// One group block: live mini-standings on top, the group's games below.
// A group whose stage hasn't started yet (no teams known) is grayed out.
function GroupCard({ title, solo, matches, nameOf, openScore, canEdit, focusId }) {
  // King ranks the 4 individuals; pair formats rank the teams.
  const rows = solo
    ? rankGroupDetailed(
        [...new Set(matches.flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])]))],
        matches
      ).map((r) => ({ label: nameOf([r.id]), wins: r.wins, diff: r.diff }))
    : rankGroupTeams(matches).map((r) => ({ label: nameOf(r.ids), wins: r.wins, diff: r.diff }));

  const future = matches.every((m) => !(m.team_a_players?.length > 0));

  return (
    <div className={`${styles.groupCard} ${future ? styles.cardFuture : ''}`}>
      <div className={styles.bracketCardLabel}>{title}</div>
      <table className={styles.groupMini}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}.</td>
              <td className={styles.groupMiniName}>{r.label}</td>
              <td>{r.wins}В</td>
              <td className={r.diff > 0 ? styles.positive : r.diff < 0 ? styles.negative : ''}>
                {r.diff > 0 ? '+' : ''}
                {r.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          m={m}
          nameOf={nameOf}
          openScore={openScore}
          editable={canEdit(m)}
          focused={focusId === m.id}
        />
      ))}
    </div>
  );
}

// One match block. Both sides with their score; the winner highlighted.
// An empty side means "переможець попереднього матчу". A pending match
// with both sides known opens the score dialog; a played one does too
// when the admin may still correct it (editable). Matches of stages
// that haven't started yet are grayed out.
function MatchCard({ m, label, nameOf, openScore, editable, focused }) {
  const agg = aggregateScore(m);
  const walkover = m.played && (!m.team_b_players || m.team_b_players.length === 0);
  const aWon = m.played && teamAWon(m);
  const ready = m.team_a_players?.length > 0 && m.team_b_players?.length > 0;
  const clickable = (!m.played && ready) || editable;
  const future = !m.played && !ready;
  return (
    <div
      id={`match-${m.id}`}
      className={`${styles.bracketCard} ${clickable ? styles.bracketCardPending : ''} ${
        future ? styles.cardFuture : ''
      } ${focused ? styles.cardFocused : ''}`}
      onClick={() => clickable && openScore(m, nameOf(m.team_a_players), nameOf(m.team_b_players))}
    >
      {label && <div className={styles.bracketCardLabel}>{label}</div>}
      <div className={`${styles.bracketSide} ${aWon ? styles.bracketWinner : ''}`}>
        <span className={styles.bracketName}>{nameOf(m.team_a_players) || '· · ·'}</span>
        <span className={styles.bracketScore}>{agg ? agg[0] : ''}</span>
      </div>
      <div className={`${styles.bracketSide} ${m.played && !aWon ? styles.bracketWinner : ''}`}>
        <span className={styles.bracketName}>{walkover ? 'прохід' : nameOf(m.team_b_players) || '· · ·'}</span>
        <span className={styles.bracketScore}>{agg ? agg[1] : ''}</span>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button className={`${styles.tabBtn} ${active ? styles.tabBtnOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
