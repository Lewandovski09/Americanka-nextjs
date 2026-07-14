'use client';

// Pieces shared between the player-facing event page (registration) and
// the admin manage page (distribution / queue / reserve). Both render the
// same category panel — the player page just gets isAdmin=false.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { computeStandings } from '@/lib/tournamentEngine';
import { teamAWon, scoreLabel } from '@/lib/formats/sets';
import { stageWeight, stageLabel, groupTitle } from '@/lib/formats/stages';
import { BRACKET_SYSTEMS } from '@/lib/formats';

// Re-exported for the pages that historically imported them from here.
export { stageWeight, stageLabel };
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './event.module.css';

export const LOCATION_LABEL = { beach13: 'Beach 13', dynamo_sc: 'Dynamo SC' };

export function bracketLabel(id) {
  return BRACKET_SYSTEMS.find((b) => b.id === id)?.label || id;
}

// Loads the event, its categories (with rosters and matches) and the
// application queue. `load` is stable and safe to call after mutations.
export function useEventData(id) {
  const [event, setEvent] = useState(null);
  const [categories, setCategories] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: ev } = await supabase.from('tournament_events').select('*').eq('id', id).single();
    setEvent(ev);

    const { data: cats } = await supabase
      .from('tournaments')
      .select(
        `id, category_label, gender, status, max_participants, bracket_system, elo_min, elo_max, points_to_win,
         tournament_players(player_id, elo_at_start, players(full_name, photo_url)),
         tournament_teams(id, player1_id, player2_id,
           p1:players!tournament_teams_player1_id_fkey(full_name),
           p2:players!tournament_teams_player2_id_fkey(full_name)),
         matches(*)`
      )
      .eq('event_id', id)
      .order('gender', { ascending: true })
      .order('category_label', { ascending: true });
    setCategories(cats || []);

    const { data: apps } = await supabase
      .from('tournament_applications')
      .select(
        `id, player_id, partner_id, seeking_partner, requested_category, status, assigned_tournament_id,
         applicant:players!tournament_applications_player_id_fkey(full_name, photo_url, elo, gender),
         partner:players!tournament_applications_partner_id_fkey(full_name, elo)`
      )
      .eq('event_id', id)
      .order('created_at', { ascending: true });
    setApplications(apps || []);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { event, categories, applications, loading, load };
}

// POST helper with shared busy/error state; reloads data on success.
export function useEventPost(load) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function post(url, body) {
    setError('');
    setBusy(true);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setError(data.error || 'Сталася помилка');
      return false;
    }
    await load();
    return true;
  }

  return { post, busy, error };
}

// «Видалити турнір» — wipes the whole event (categories, matches,
// rosters, applications) after a confirm; the API refuses events that
// already awarded rating. Shared by both admin settings pages.
export function DeleteEventButton({ event, busy, post }) {
  const router = useRouter();
  return (
    <button
      className={styles.deleteBtn}
      disabled={busy}
      onClick={async () => {
        const ok = window.confirm(
          `Видалити турнір «${event.name}»? Всі категорії, матчі та заявки буде видалено без можливості відновлення.`
        );
        if (!ok) return;
        if (await post(`/api/events/${event.id}/delete`)) router.push('/tournaments');
      }}
    >
      Видалити турнір
    </button>
  );
}

export function CategoryTabs({ categories, activeId, onSelect }) {
  return (
    <div className={styles.catTabs}>
      {categories.map((c) => (
        <button
          key={c.id}
          className={`${styles.catTab} ${c.id === activeId ? styles.catTabOn : ''}`}
          onClick={() => onSelect(c.id)}
        >
          {c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}
          {c.category_label}
        </button>
      ))}
    </div>
  );
}

export function CategoryPanel({ category, format, isAdmin, allCategories, busy, onStart, onScore, onMove, onRemove }) {
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const teams = category.tournament_teams || [];
  const solos = category.tournament_players || [];
  const matches = category.matches || [];

  const registered = isPair ? teams.length : solos.length;
  const capacity = category.max_participants || format?.fixedParticipants || null;
  const pct = capacity ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
  const notStarted = category.status === 'scheduled';

  // Name lookup for match sides (works for both pair and solo formats).
  const nameById = {};
  solos.forEach((tp) => {
    if (tp.players?.full_name) nameById[tp.player_id] = tp.players.full_name;
  });
  teams.forEach((t) => {
    if (t.p1?.full_name) nameById[t.player1_id] = t.p1.full_name;
    if (t.p2?.full_name) nameById[t.player2_id] = t.p2.full_name;
  });

  const hasStages = matches.some((m) => m.stage);

  return (
    <div className={styles.panel}>
      <div className={styles.panelMeta}>
        {category.bracket_system && <span>Система: {bracketLabel(category.bracket_system)}</span>}
      </div>

      <div className={styles.progressRow}>
        <span className={styles.progressLabel}>
          {isPair ? 'Пар' : 'Учасників'}: {registered}
          {capacity ? `/${capacity}` : ''}
        </span>
        <span className={styles.statusBadge}>{category.status === 'scheduled' ? 'Реєстрація' : category.status}</span>
      </div>
      {capacity != null && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      )}

      {matches.length === 0 ? (
        <RegisteredList
          isPair={isPair}
          teams={teams}
          solos={solos}
          admin={isAdmin && notStarted}
          currentCategory={{ id: category.id, label: category.category_label, gender: category.gender }}
          allCategories={(allCategories || []).filter((c) => c.id !== category.id)}
          busy={busy}
          onMove={onMove}
          onRemove={onRemove}
        />
      ) : hasStages ? (
        <StageMatches
          matches={matches}
          nameById={nameById}
          isAdmin={isAdmin}
          busy={busy}
          onScore={onScore}
          maxSets={format?.maxSets ?? 3}
        />
      ) : (
        <Standings solos={solos} matches={matches} />
      )}

      {isPair &&
        matches.some(
          (m) =>
            m.played &&
            (m.is_final || /^p\d+_\d+$/.test(m.stage || '') || m.stage === 'qf' || m.stage === 'play_in')
        ) && <Placements matches={matches} teams={teams} nameById={nameById} />}

      {isAdmin && notStarted && (
        <button className={styles.btnPrimary} style={{ marginTop: 12 }} disabled={busy} onClick={onStart}>
          Розпочати категорію →
        </button>
      )}

      {!notStarted && (
        <Link href={`/tournaments/${category.id}`} className={styles.openLink}>
          Відкрити категорію →
        </Link>
      )}
    </div>
  );
}

// Order-independent identity for a team from its player ids.
function teamKey(ids) {
  return [...(ids || [])].filter(Boolean).map(String).sort().join('|');
}

const winnerLoser = (m) => {
  const aWon = teamAWon(m);
  return {
    w: aWon ? m.team_a_players : m.team_b_players,
    l: aWon ? m.team_b_players : m.team_a_players,
  };
};

// Final placement table. Two shapes:
//   • File format (groups_top1_bye_top23_crosses) — has play-in/qf stages:
//     placement by elimination round WITH TIES (5-8, 9-12, 13-16 each share
//     a place). Only the final and 3rd-place match are played out.
//   • Full-placement crosses (groups_crosses_1_2) — every 'final'/'pX_Y'
//     match awards unique places X (winner) and Y (loser).
// Inlined here to avoid pulling the bracket builder (which imports node
// 'crypto') into the client bundle. Also used by the category page's
// «Результати» view.
export function computePlaces(matches, teams) {
  const played = (matches || []).filter((m) => m.played);
  const isFileFormat = played.some((m) => m.stage === 'play_in' || m.stage === 'qf');
  const out = [];

  if (isFileFormat) {
    const finalM = played.find((m) => m.stage === 'final');
    if (finalM) {
      const { w, l } = winnerLoser(finalM);
      if (w?.length) out.push({ place: 1, players: w });
      if (l?.length) out.push({ place: 2, players: l });
    }
    const bronze = played.find((m) => /^p3_4$/.test(m.stage || ''));
    if (bronze) {
      const { w, l } = winnerLoser(bronze);
      if (w?.length) out.push({ place: 3, players: w });
      if (l?.length) out.push({ place: 4, players: l });
    }
    // QF losers tie 5th, play-in losers tie 9th (blocks, like the file).
    played
      .filter((m) => m.stage === 'qf')
      .forEach((m) => winnerLoser(m).l?.length && out.push({ place: 5, players: winnerLoser(m).l }));
    played
      .filter((m) => m.stage === 'play_in')
      .forEach((m) => winnerLoser(m).l?.length && out.push({ place: 9, players: winnerLoser(m).l }));
    // Group 4th = teams that never reached the play-in/qf → tie 13th.
    // Count every dealt play-in/qf pairing (not just the played ones), so
    // a team whose quarterfinal is still ahead isn't listed as knocked out.
    const advanced = new Set();
    (matches || [])
      .filter((m) => m.stage === 'play_in' || m.stage === 'qf')
      .forEach((m) => {
        advanced.add(teamKey(m.team_a_players));
        advanced.add(teamKey(m.team_b_players));
      });
    (teams || []).forEach((t) => {
      const key = teamKey([t.player1_id, t.player2_id]);
      if (key && !advanced.has(key)) out.push({ place: 13, players: [t.player1_id, t.player2_id] });
    });
    return out.sort((a, b) => a.place - b.place);
  }

  for (const m of played) {
    let hi;
    let lo;
    if (m.stage === 'final') {
      hi = 1;
      lo = 2;
    } else {
      const g = /^p(\d+)_(\d+)$/.exec(m.stage || '');
      if (!g) continue;
      hi = Number(g[1]);
      lo = Number(g[2]);
    }
    const { w, l } = winnerLoser(m);
    if (w?.length) out.push({ place: hi, players: w });
    if (l?.length) out.push({ place: lo, players: l });
  }
  return out.sort((a, b) => a.place - b.place);
}

function Placements({ matches, teams, nameById }) {
  const places = computePlaces(matches, teams);
  if (places.length === 0) return null;
  const teamName = (ids) =>
    (ids || []).map((id) => nameById[id]?.split(' ')[0] || String(id).slice(0, 5)).join(' + ');
  return (
    <div className={styles.stageBlock}>
      <div className={styles.stageTitle}>Місця</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Пара</th>
          </tr>
        </thead>
        <tbody>
          {places.map((p, i) => (
            <tr key={i}>
              <td>{p.place}</td>
              <td>{teamName(p.players)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Standings({ solos, matches }) {
  const players = solos.map((tp) => ({
    id: tp.player_id,
    elo_at_start: tp.elo_at_start,
    full_name: tp.players?.full_name || '—',
  }));
  const rows = computeStandings(players, matches);
  if (rows.length === 0) return <div className={styles.empty}>Немає даних</div>;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>Гравець</th>
          <th>В</th>
          <th>+/-</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => {
          const diff = s.gamesFor - s.gamesAgainst;
          return (
            <tr key={s.player.id}>
              <td>{i + 1}</td>
              <td>{s.player.full_name.split(' ')[0]}</td>
              <td>{s.wins}</td>
              <td>{diff > 0 ? `+${diff}` : diff}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const EMPTY_SETS = [
  { a: '', b: '' },
  { a: '', b: '' },
  { a: '', b: '' },
];

function StageMatches({ matches, nameById, isAdmin, busy, onScore, maxSets = 3 }) {
  const [draft, setDraft] = useState({});

  const stages = [...new Set(matches.map((m) => m.stage))].sort((a, b) => stageWeight(a) - stageWeight(b));

  function teamName(ids) {
    if (!ids || ids.length === 0) return '—';
    return ids.map((id) => nameById[id]?.split(' ')[0] || String(id).slice(0, 5)).join(' + ');
  }

  function renderMatch(m) {
    const walkover = m.played && (!m.team_b_players || m.team_b_players.length === 0);
    const bothFilled = m.team_a_players?.length > 0 && m.team_b_players?.length > 0;
    const d = draft[m.id] || EMPTY_SETS;
    const setDraftAt = (i, patch) =>
      setDraft((p) => ({ ...p, [m.id]: d.map((x, xi) => (xi === i ? { ...x, ...patch } : x)) }));
    return (
      <div key={m.id} className={styles.matchRow}>
        <span className={styles.matchTeams}>{teamName(m.team_a_players)}</span>
        {m.played ? (
          <span className={styles.matchScore}>{walkover ? 'прохід' : scoreLabel(m)}</span>
        ) : isAdmin && bothFilled ? (
          <span className={styles.scoreInputs}>
            {/* Up to maxSets sets; only the first is required. */}
            <span className={styles.setCol}>
              {d.slice(0, maxSets).map((s, i) => (
                <span key={i} className={styles.setPair}>
                  <input
                    className={styles.scoreInput}
                    type="number"
                    value={s.a}
                    onChange={(e) => setDraftAt(i, { a: e.target.value })}
                  />
                  :
                  <input
                    className={styles.scoreInput}
                    type="number"
                    value={s.b}
                    onChange={(e) => setDraftAt(i, { b: e.target.value })}
                  />
                </span>
              ))}
            </span>
            <button
              className={styles.saveBtn}
              disabled={busy || d[0].a === '' || d[0].b === ''}
              onClick={() =>
                onScore(
                  m.id,
                  d.filter((s) => s.a !== '' && s.b !== '').map((s) => [Number(s.a), Number(s.b)])
                )
              }
            >
              OK
            </button>
          </span>
        ) : (
          <span className={styles.matchScore}>{bothFilled ? 'vs' : 'очікує'}</span>
        )}
        <span className={styles.matchTeams} style={{ textAlign: 'right' }}>
          {m.team_b_players?.length > 0 ? teamName(m.team_b_players) : ''}
        </span>
      </div>
    );
  }

  return (
    <div>
      {stages.map((stage) => {
        const ms = matches.filter((m) => m.stage === stage);
        const isGrouped = stage === 'group' || /^kr\d+$/.test(stage);
        if (isGrouped) {
          const groups = [...new Set(ms.map((m) => m.group_index ?? 0))].sort((a, b) => a - b);
          // A single King group of 4 is the final four.
          const title = /^kr\d+$/.test(stage) && groups.length === 1 ? 'Фінал' : stageLabel(stage);
          return (
            <div key={stage} className={styles.stageBlock}>
              <div className={styles.stageTitle}>{title}</div>
              {groups.map((gi) => (
                <div key={gi}>
                  <div className={styles.groupTitle}>{groupTitle(gi)}</div>
                  {ms
                    .filter((m) => (m.group_index ?? 0) === gi)
                    .sort((a, b) => a.round_number - b.round_number)
                    .map(renderMatch)}
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={stage} className={styles.stageBlock}>
            <div className={styles.stageTitle}>{stageLabel(stage)}</div>
            {ms.sort((a, b) => a.round_number - b.round_number).map(renderMatch)}
          </div>
        );
      })}
    </div>
  );
}

function RegisteredList({ isPair, teams, solos, admin, currentCategory, allCategories, busy, onMove, onRemove }) {
  const catTag = (c) => `${c.gender === 'M' ? 'Ч · ' : c.gender === 'F' ? 'Ж · ' : ''}${c.label || c.category_label}`;

  function AdminControls({ member }) {
    if (!admin) return null;
    // Value encodes "categoryId:mode" (roster | reserve). The ✕ returns
    // the member to the application queue.
    return (
      <div className={styles.memberControls}>
        <select
          className={styles.miniSelect}
          value=""
          disabled={busy}
          onChange={(e) => {
            if (!e.target.value) return;
            const [id, mode] = e.target.value.split(':');
            onMove(member, id, mode === 'reserve');
          }}
        >
          <option value="">Перенести…</option>
          {currentCategory && (
            <option value={`${currentCategory.id}:reserve`}>↓ У резерв цієї ліги</option>
          )}
          {allCategories.map((c) => (
            <optgroup key={c.id} label={catTag(c)}>
              <option value={`${c.id}:roster`}>→ {catTag(c)} — склад</option>
              <option value={`${c.id}:reserve`}>→ {catTag(c)} — резерв</option>
            </optgroup>
          ))}
        </select>
        <button
          className={styles.miniRemove}
          disabled={busy}
          onClick={() => onRemove(member)}
          title="Повернути в чергу заявок"
        >
          ✕
        </button>
      </div>
    );
  }

  if (isPair) {
    if (teams.length === 0) return <div className={styles.empty}>Ще немає заявок</div>;
    return (
      <div>
        {teams.map((t) => (
          <div key={t.id} className={styles.regRow}>
            <span className={styles.regNames}>
              {t.p1?.full_name?.split(' ')[0] || t.player1_id?.slice(0, 6)}
              <span className={styles.regVs}> + </span>
              {t.player2_id ? t.p2?.full_name?.split(' ')[0] || t.player2_id.slice(0, 6) : 'шукає напарника'}
            </span>
            <AdminControls member={{ teamId: t.id }} />
          </div>
        ))}
      </div>
    );
  }

  if (solos.length === 0) return <div className={styles.empty}>Ще немає заявок</div>;
  return (
    <div>
      {solos.map((tp) => (
        <div key={tp.player_id} className={styles.regRow}>
          <span className={styles.regNames}>
            <PlayerAvatar player={tp.players} size={24} />
            {tp.players?.full_name || '—'}
          </span>
          <AdminControls member={{ playerId: tp.player_id }} />
        </div>
      ))}
    </div>
  );
}
