'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { computeStandings } from '@/lib/tournamentEngine';
import { getFormat } from '@/lib/formats';
import { pointsTargetForStage } from '@/lib/formats/scoring';
import { aggregateScore, pointsDiffA, teamAWon } from '@/lib/formats/sets';
import { rankGroupDetailed } from '@/lib/formats/kingOfBeach';
import { stageWeight, stageLabel, groupTitle } from '@/lib/formats/stages';
import { computePlaces } from '@/app/events/shared';
import PlayerAvatar from '@/components/PlayerAvatar';
import BracketFlow from './BracketFlow';
import styles from './detail.module.css';

const TABS = { PLAYERS: 'players', TABLE: 'table', BRACKET: 'bracket', CHAT: 'chat' };

export default function TournamentDetailPage({ params }) {
  const { id } = params;
  const { player } = useCurrentPlayer();

  const [tournament, setTournament] = useState(null);
  const [tournamentPlayers, setTournamentPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tab, setTab] = useState(TABS.PLAYERS);
  const [playersView, setPlayersView] = useState(null); // 'list' | 'results'; null = auto by status
  const [bracketView, setBracketView] = useState(null); // 'v2' | 'v1'; null = auto
  const [scoreModal, setScoreModal] = useState(null); // { matchId, teamAName, teamBName, pointsToWin }
  const [chatText, setChatText] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: t } = await supabase
      .from('tournaments')
      .select('*, tournament_events(format_kind, points_to_win, points_mode, final_points_to_win)')
      .eq('id', id)
      .single();
    setTournament(t);

    const { data: tps } = await supabase
      .from('tournament_players')
      .select('player_id, elo_at_start, players(full_name, photo_url)')
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

  if (!tournament) return <div className={styles.loading}>Завантаження...</div>;

  const playersForEngine = tournamentPlayers.map((tp) => ({
    id: tp.player_id,
    elo_at_start: tp.elo_at_start,
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
  // «Сітка v2» (flowchart) needs bracket pointers to draw the lines.
  const hasFlow = matches.some((m) => m.winner_to_match_id);
  const bracketViewResolved = bracketView || (hasFlow ? 'v2' : 'v1');

  // Projected start time of every game: each court runs its own queue
  // from the category start time, and a game blocks its court for 30
  // minutes (партії до 15) or 45 minutes (до 21). So with two courts the
  // 9:00 slot holds games 1–2 and game 3 starts at 9:30 on court 1.
  const plannedByMatchId = {};
  if (tournament.scheduled_at) {
    const startMs = new Date(tournament.scheduled_at).getTime();
    const courtCursor = {};
    for (const m of orderedMatches) {
      const court = m.court || 1;
      const t = courtCursor[court] ?? startMs;
      plannedByMatchId[m.id] = t;
      const target = isSum ? 31 : pointsTargetForStage(scoringConfig, m.stage);
      courtCursor[court] = t + (target <= 15 ? 30 : 45) * 60000;
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

  // Short label for a match side: 'Ірина/Олена' (pair) or 'Максим'.
  function teamLabel(ids) {
    if (!ids || ids.length === 0) return '';
    return ids.map((pid) => playerById(pid)?.full_name?.split(' ')[0] || '—').join('/');
  }

  // An already-played game may be corrected, but only by the admin and
  // only while its stage is still the current one: once anything of a
  // later stage has been played (or the bracket match it feeds into is
  // decided), the score is locked. Mirrors the server-side check.
  function canEditScore(m) {
    if (!player?.is_admin || !m.played || tournament.status === 'done') return false;
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
    return (
      <tr
        key={m.id}
        className={`${clickable ? styles.schedRowPending : ''} ${future ? styles.schedRowFuture : ''}`}
        onClick={() => clickable && openScoreModal(m, nameA, nameB)}
      >
        <td>{i + 1}</td>
        <td>{planned ? planned.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
        <td>{m.court || 1}</td>
        <td className={styles.schedTeamCol}>{nameA}</td>
        <td className={styles.schedVs}>vs</td>
        <td className={styles.schedTeamCol}>{nameB}</td>
        <td className={diff > 0 ? styles.positive : diff < 0 ? styles.negative : ''}>
          {diff == null ? '' : diff > 0 ? `+${diff}` : diff}
        </td>
        <td className={styles.schedScore}>
          {agg ? `${agg[0]}:${agg[1]}` : ''}
          {editable && <span className={styles.editIcon}> ✎</span>}
        </td>
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
                    <th className={styles.schedTeamCol}>Команда 1</th>
                    <th />
                    <th className={styles.schedTeamCol}>Команда 2</th>
                    <th title="(+15) → 21:15, (-12) → 12:21">+/-</th>
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
                          <td colSpan={maxSets > 1 ? 11 : 8}>{sec.title}</td>
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

      {/* Interactive bracket. Two views: «Сітка v2» — a flowchart with
          winner-lines like the paper bracket (default when the matches
          carry bracket pointers), and the classic columns-of-blocks
          view. Pending games are highlighted and open the score dialog. */}
      {tab === TABS.BRACKET && matches.length > 0 && hasFlow && (
        <div className={styles.subTabs}>
          {[
            ['v2', 'Схема'],
            ['v1', 'Класична'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`${styles.subTab} ${bracketViewResolved === key ? styles.subTabOn : ''}`}
              onClick={() => setBracketView(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === TABS.BRACKET && hasFlow && bracketViewResolved === 'v2' && matches.length > 0 && (
        <BracketFlow
          matches={matches}
          nameOf={teamLabel}
          numberOf={gameNoById}
          openScore={openScoreModal}
          canEdit={canEditScore}
        />
      )}
      {tab === TABS.BRACKET && !(hasFlow && bracketViewResolved === 'v2') &&
        (matches.length === 0 ? (
          <div className={styles.loading}>Ігор ще немає</div>
        ) : (
          <div className={styles.bracketWrap}>
            <div className={styles.bracketRow}>
              {buildBracketColumns(matches).map((col) => (
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
                        />
                      ))}
                </div>
              ))}
            </div>
          </div>
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
                : `Партія до ${scoreModal.target}, різниця у 2 очки. 2-га і 3-тя партії — за потреби.`}
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
                    <span className={styles.setName}>{i + 1} сет</span>
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
    if (/^p\d+_\d+$/.test(stage)) {
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

// One group block: live mini-standings on top, the group's games below.
// A group whose stage hasn't started yet (no teams known) is grayed out.
function GroupCard({ title, solo, matches, nameOf, openScore, canEdit }) {
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
        <MatchCard key={m.id} m={m} nameOf={nameOf} openScore={openScore} editable={canEdit(m)} />
      ))}
    </div>
  );
}

// One match block. Both sides with their score; the winner highlighted.
// An empty side means "переможець попереднього матчу". A pending match
// with both sides known opens the score dialog; a played one does too
// when the admin may still correct it (editable). Matches of stages
// that haven't started yet are grayed out.
function MatchCard({ m, label, nameOf, openScore, editable }) {
  const agg = aggregateScore(m);
  const walkover = m.played && (!m.team_b_players || m.team_b_players.length === 0);
  const aWon = m.played && teamAWon(m);
  const ready = m.team_a_players?.length > 0 && m.team_b_players?.length > 0;
  const clickable = (!m.played && ready) || editable;
  const future = !m.played && !ready;
  return (
    <div
      className={`${styles.bracketCard} ${clickable ? styles.bracketCardPending : ''} ${
        future ? styles.cardFuture : ''
      }`}
      onClick={() => clickable && openScore(m, nameOf(m.team_a_players), nameOf(m.team_b_players))}
    >
      {editable && <span className={styles.editIcon}>✎</span>}
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
