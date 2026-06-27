'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { computeStandings } from '@/lib/tournamentEngine';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './detail.module.css';

const TABS = { TABLE: 'table', MATCHES: 'matches', CHAT: 'chat' };

export default function TournamentDetailPage({ params }) {
  const { id } = params;
  const { player } = useCurrentPlayer();

  const [tournament, setTournament] = useState(null);
  const [tournamentPlayers, setTournamentPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tab, setTab] = useState(TABS.TABLE);
  const [scoreModal, setScoreModal] = useState(null); // { matchId, teamAName, teamBName, pointsToWin }
  const [chatText, setChatText] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: t } = await supabase
      .from('tournaments')
      .select('*, tournament_formats(points_to_win, round_count)')
      .eq('id', id)
      .single();
    setTournament(t);

    const { data: tps } = await supabase
      .from('tournament_players')
      .select('player_id, elo_at_start, players(full_name, photo_url)')
      .eq('tournament_id', id);
    setTournamentPlayers(tps || []);

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

  function playerById(pid) {
    return tournamentPlayers.find((tp) => tp.player_id === pid)?.players;
  }

  async function handleSubmitScore() {
    const { matchId, scoreA, scoreB } = scoreModal;
    const res = await fetch(`/api/matches/${matchId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoreA: Number(scoreA), scoreB: Number(scoreB) }),
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
      <div className={styles.meta}>
        Раунд {Math.max(1, Math.ceil(playedCount / 2))}/{tournament.tournament_formats.round_count} · {playedCount}/
        {matches.length} ігор
      </div>

      <div className={styles.tabs}>
        <TabBtn active={tab === TABS.TABLE} onClick={() => setTab(TABS.TABLE)}>
          Таблиця
        </TabBtn>
        <TabBtn active={tab === TABS.MATCHES} onClick={() => setTab(TABS.MATCHES)}>
          Ігри
        </TabBtn>
        <TabBtn active={tab === TABS.CHAT} onClick={() => setTab(TABS.CHAT)}>
          Чат
        </TabBtn>
      </div>

      {tab === TABS.TABLE && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Гравець</th>
              <th>В</th>
              <th>Рах.</th>
              <th>+/-</th>
              <th>Ело</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const diff = s.gamesFor - s.gamesAgainst;
              return (
                <tr key={s.player.id} className={s.player.id === player?.id ? styles.meRow : ''}>
                  <td style={i < 3 ? { color: 'var(--rust)', fontWeight: 800 } : undefined}>{i + 1}</td>
                  <td className={styles.nameCell}>
                    <PlayerAvatar player={playerById(s.player.id)} size={22} />
                    {s.player.full_name.split(' ')[0]}
                  </td>
                  <td>{s.wins}</td>
                  <td>
                    {s.gamesFor}:{s.gamesAgainst}
                  </td>
                  <td className={diff > 0 ? styles.positive : diff < 0 ? styles.negative : ''}>
                    {diff > 0 ? '+' : ''}
                    {diff}
                  </td>
                  <td className={s.eloDelta > 0 ? styles.positive : s.eloDelta < 0 ? styles.negative : ''}>
                    {s.eloDelta > 0 ? '+' : ''}
                    {s.eloDelta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === TABS.MATCHES && (
        <div>
          {groupByRound(matches).map(([round, roundMatches]) => (
            <div key={round}>
              <div className={styles.roundLabel}>Раунд {round}</div>
              {roundMatches.map((m) => {
                const teamA = m.team_a_players.map(playerById);
                const teamB = m.team_b_players.map(playerById);
                const nameA = teamA.map((p) => p?.full_name?.split(' ')[0]).join(' + ');
                const nameB = teamB.map((p) => p?.full_name?.split(' ')[0]).join(' + ');

                return (
                  <div
                    key={m.id}
                    className={`${styles.matchRow} ${!m.played ? styles.matchRowPending : ''}`}
                    onClick={() =>
                      !m.played &&
                      setScoreModal({
                        matchId: m.id,
                        nameA,
                        nameB,
                        scoreA: '',
                        scoreB: '',
                        pointsToWin: tournament.tournament_formats.points_to_win,
                      })
                    }
                  >
                    <span>{nameA}</span>
                    <span className={styles.matchScore}>{m.played ? `${m.score_a}:${m.score_b}` : 'vs'}</span>
                    <span>{nameB}</span>
                  </div>
                );
              })}
            </div>
          ))}

          {allDone && player?.is_admin && (
            <button className={styles.finishBtn} onClick={handleFinish}>
              Зберегти результати турніру
            </button>
          )}
        </div>
      )}

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
            <div className={styles.modalSub}>Сума має дорівнювати {scoreModal.pointsToWin}</div>
            <div className={styles.scoreInputs}>
              <input
                className={styles.scoreInput}
                type="number"
                value={scoreModal.scoreA}
                onChange={(e) => {
                  const v = e.target.value;
                  setScoreModal((prev) => ({
                    ...prev,
                    scoreA: v,
                    scoreB: v !== '' ? String(prev.pointsToWin - Number(v)) : '',
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
                    scoreA: v !== '' ? String(prev.pointsToWin - Number(v)) : '',
                  }));
                }}
              />
            </div>
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

function TabBtn({ active, onClick, children }) {
  return (
    <button className={`${styles.tabBtn} ${active ? styles.tabBtnOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
