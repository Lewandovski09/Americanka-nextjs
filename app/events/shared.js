'use client';

// Pieces shared between the player-facing event page (registration) and
// the admin manage page (distribution / queue / reserve). Both render the
// same category panel — the player page just gets isAdmin=false.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { computeStandings } from '@/lib/tournamentEngine';
import { scoreLabel } from '@/lib/formats/sets';
import { stageWeight, stageLabel, groupTitle } from '@/lib/formats/stages';
import { computePlaces } from '@/lib/formats/placements';
import { BRACKET_SYSTEMS } from '@/lib/formats';

// Re-exported for the pages that historically imported them from here.
export { stageWeight, stageLabel, computePlaces };
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './event.module.css';

export const LOCATION_LABEL = { beach13: 'Beach 13', dynamo_sc: 'Dynamo SC' };

export function bracketLabel(id) {
  return BRACKET_SYSTEMS.find((b) => b.id === id)?.label || id;
}

// The category roster as a flat list in SEED order — the order the
// bracket is built from. Rows the admin has already seeded come first by
// `slot_index`; the rest fall back to when they were distributed, so an
// unseeded category still shows a sensible 1…N to start editing from.
// Pairs and solo players behave identically: neither gets a seed
// automatically, both are arranged on the «Посів» tab.
export function seedRoster(category, isPair) {
  const rows = isPair
    ? (category?.tournament_teams || []).map((t) => ({
        key: t.id,
        slotIndex: t.slot_index,
        addedAt: t.created_at || '',
        name: `${t.p1?.full_name?.split(' ')[0] || t.player1_id?.slice(0, 6)} + ${
          t.player2_id ? t.p2?.full_name?.split(' ')[0] || t.player2_id.slice(0, 6) : 'шукає напарника'
        }`,
        player: null,
      }))
    : (category?.tournament_players || []).map((tp) => ({
        key: tp.player_id,
        slotIndex: tp.slot_index,
        addedAt: tp.created_at || '',
        name: tp.players?.full_name || '—',
        player: tp.players || null,
      }));

  return rows.sort((a, b) => {
    const as = a.slotIndex ?? Infinity;
    const bs = b.slotIndex ?? Infinity;
    if (as !== bs) return as - bs;
    // Same-second distribution (or rows predating the created_at column)
    // would otherwise shuffle between reloads — settle it by name.
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Loads the event, its categories (with rosters and matches), the
// application queue and the judging crew. `load` is stable and safe to
// call after mutations.
export function useEventData(id) {
  const [event, setEvent] = useState(null);
  const [categories, setCategories] = useState([]);
  const [applications, setApplications] = useState([]);
  const [judges, setJudges] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: ev } = await supabase.from('tournament_events').select('*').eq('id', id).single();
    setEvent(ev);

    const { data: cats } = await supabase
      .from('tournaments')
      .select(
        `id, category_label, gender, status, max_participants, bracket_system, elo_min, elo_max, points_to_win,
         tournament_players(player_id, slot_index, created_at, players(full_name, photo_url, gender)),
         tournament_teams(id, player1_id, player2_id, slot_index, created_at,
           p1:players!tournament_teams_player1_id_fkey(full_name, gender),
           p2:players!tournament_teams_player2_id_fkey(full_name, gender)),
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
         partner:players!tournament_applications_partner_id_fkey(full_name, elo, gender)`
      )
      .eq('event_id', id)
      .order('created_at', { ascending: true });
    setApplications(apps || []);

    // The judging crew — head judge first, then in the order they were
    // added.
    const { data: crew } = await supabase
      .from('tournament_judges')
      .select('player_id, is_head, created_at, players(full_name, photo_url, login)')
      .eq('event_id', id)
      .order('is_head', { ascending: false })
      .order('created_at', { ascending: true });
    setJudges(crew || []);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { event, categories, applications, judges, loading, load };
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

// ── Заявки as a two-column table ────────────────────────────────
// A pair is read as two columns. In mix the man is always the left
// column and the woman the right one, no matter who of the two filed
// the application; same-gender pairs keep their registered order.
// Every name carries its own ♂/♀ badge.

export function isMixFormat(format) {
  return format?.registrationType === 'mix_pair';
}

export function GenderMark({ gender }) {
  if (gender !== 'M' && gender !== 'F') return null;
  return (
    <span className={`${styles.genderMark} ${gender === 'M' ? styles.genderM : styles.genderF}`}>
      {gender === 'M' ? '♂' : '♀'}
    </span>
  );
}

// Half of a pair: { name, gender }, or null for the missing half.
function PersonCell({ person, empty }) {
  if (!person) return <span className={`${styles.pairCell} ${styles.pairCellEmpty}`}>{empty}</span>;
  return (
    <span className={styles.pairCell}>
      <GenderMark gender={person.gender} />
      <span className={styles.pairName}>{person.name}</span>
    </span>
  );
}

// Left column first. Only mix reorders — in a same-gender pair there is
// nothing to sort by, and a lone player must stay in the first column.
export function orderPair(a, b, mix) {
  if (!mix) return [a, b];
  if (a && b) return a.gender === 'F' && b.gender === 'M' ? [b, a] : [a, b];
  const one = a || b;
  return one?.gender === 'F' ? [null, one] : [one, null];
}

export function PairRow({ a, b, mix, empty = 'шукає напарника', children }) {
  const [left, right] = orderPair(a, b, mix);
  return (
    <div className={styles.pairRow}>
      <PersonCell person={left} empty={empty} />
      <PersonCell person={right} empty={empty} />
      {children ? <div className={styles.pairControls}>{children}</div> : <span />}
    </div>
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

// «Запустити» — one button for the whole event: every league that has
// not started yet gets its bracket at once (the API refuses to start
// anything unless they all can).
//
// The seeding does not have to be arranged first: leagues the admin
// never got to are seeded by the order their applications were
// distributed. Only an empty league blocks the start.
export function StartEventButton({ event, categories, format, busy, post }) {
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const rowsOf = (c) => (isPair ? c.tournament_teams || [] : c.tournament_players || []);

  const pending = categories.filter((c) => c.status === 'scheduled');
  if (pending.length === 0) return null;

  const empty = pending.filter((c) => rowsOf(c).length === 0);
  const unseeded = pending.filter((c) => rowsOf(c).some((r) => r.slot_index == null));
  // Americanka's schedule is built for exactly 8 players — the server
  // refuses anything else, so the button is held back the same way an
  // empty category holds it back, instead of letting the admin hit a
  // failed start.
  const shortHanded =
    format?.kind === 'americanka' ? pending.filter((c) => rowsOf(c).length !== 8) : [];
  const label = (c) =>
    `${c.gender === 'M' ? '♂ ' : c.gender === 'F' ? '♀ ' : ''}${c.category_label || 'Категорія'}`;

  return (
    <div className={styles.startBox}>
      {empty.length > 0 && (
        <div className={styles.hint}>
          Порожні категорії: {empty.map(label).join(', ')} — додайте учасників або видаліть їх.
        </div>
      )}
      {empty.length === 0 && shortHanded.length > 0 && (
        <div className={styles.hint}>
          Для американки потрібно рівно 8 гравців:{' '}
          {shortHanded.map((c) => `${label(c)} (${rowsOf(c).length}/8)`).join(', ')}.
        </div>
      )}
      {empty.length === 0 && shortHanded.length === 0 && unseeded.length > 0 && (
        <div className={styles.hint}>
          Посів розставлено не всюди ({unseeded.map(label).join(', ')}) — там порядок візьметься з
          черги заявок.
        </div>
      )}
      <button
        className={styles.btnPrimary}
        disabled={busy || empty.length > 0 || shortHanded.length > 0}
        onClick={() => post(`/api/events/${event.id}/start`)}
      >
        {busy ? 'Запуск…' : `Запустити${pending.length > 1 ? ` (${pending.length} категорії)` : ''}`}
      </button>
    </div>
  );
}

export function CategoryPanel({ category, format, isAdmin, allCategories, busy, onScore, onMove, onRemove }) {
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
          mix={isMixFormat(format)}
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

      {!notStarted && (
        <Link href={`/tournaments/${category.id}`} className={styles.openLink}>
          Відкрити категорію →
        </Link>
      )}
    </div>
  );
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
              <td>{teamName(p.playerIds)}</td>
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

function RegisteredList({ isPair, mix, teams, solos, admin, currentCategory, allCategories, busy, onMove, onRemove }) {
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
      <div className={styles.pairList}>
        {teams.map((t) => (
          <PairRow
            key={t.id}
            mix={mix}
            a={{ name: t.p1?.full_name || t.player1_id?.slice(0, 6), gender: t.p1?.gender }}
            b={
              t.player2_id
                ? { name: t.p2?.full_name || t.player2_id.slice(0, 6), gender: t.p2?.gender }
                : null
            }
          >
            <AdminControls member={{ teamId: t.id }} />
          </PairRow>
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
            <GenderMark gender={tp.players?.gender} />
            <PlayerAvatar player={tp.players} size={24} />
            {tp.players?.full_name || '—'}
          </span>
          <AdminControls member={{ playerId: tp.player_id }} />
        </div>
      ))}
    </div>
  );
}
