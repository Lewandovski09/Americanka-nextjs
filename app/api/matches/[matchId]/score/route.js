import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { validateSumTo, validateSetsFirstTo, pointsTargetForStage } from '@/lib/formats/scoring';
import { americankaSum } from '@/lib/formats/americano';
import { teamAWon } from '@/lib/formats/sets';
import { matchDeltas } from '@/lib/elo';
import { readRatings, addRating } from '@/lib/server/ratings';
import { buildKingRound, rankGroupDetailed, kingAdvancers } from '@/lib/formats/kingOfBeach';
import { computeGroupRanking, buildCrossesPlayoff, buildByeCrossesPlayoff } from '@/lib/formats/brackets';
import { stageWeight } from '@/lib/formats/stages';
import { assignScheduledTimes, cursorsFromMatches } from '@/lib/schedule';
import { getJudgeRole } from '@/lib/server/judges';
import { finishCategory, refreshFinishedCategory } from '@/lib/server/finishCategory';
import { saveScore } from '@/lib/server/matchScore';
import { getAuthUser } from '@/lib/server/authUser';

// The last game of a tournament also sends «🏁 Турнір завершено» to
// Telegram (lib/server/resultsNotice) — give it time.
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { matchId } = params;
  const body = await request.json();
  // New clients send { sets: [[a,b], ...] } (1–3 sets); the legacy shape
  // { scoreA, scoreB } is one set.
  const sets =
    Array.isArray(body.sets) && body.sets.length > 0
      ? body.sets.map((s) => [Number(s?.[0]), Number(s?.[1])])
      : [[Number(body.scoreA), Number(body.scoreB)]];

  const supabase = createClient();
  const supabaseAdmin = createAdminClient();

  // Who is asking and which match — independent, so fetched together
  // (every step here used to wait for the previous one).
  const [{ data: authUser }, { data: match }] = await Promise.all([
    getAuthUser(supabase),
    supabaseAdmin
      .from('tournament_matches')
      .select(
        `*, tournament_categories(status, points_to_win, event_id,
          tournament_events(format_kind, sport_id, points_to_win, points_mode, final_points_to_win))`
      )
      .eq('id', matchId)
      .maybeSingle(),
  ]);
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }
  if (!match) {
    return Response.json({ success: false, error: 'Матч не знайдено' }, { status: 404 });
  }
  // A placeholder of a later round (no teams yet) has nothing to score —
  // a score there used to stall the King of the Beach for good and push
  // empty teams through a bracket.
  if (!(match.team_a_players?.length > 0) || !(match.team_b_players?.length > 0)) {
    return Response.json({ success: false, error: 'Гра ще не сформована — немає обох команд' }, { status: 400 });
  }

  // A score is entered by the crew running the day — an admin or a judge
  // of this event. Any judge of the event may enter any of its games:
  // `matches.judge_id` pins who is expected at a court, it is not a
  // permission. Legacy categories that predate events have no crew, so
  // only an admin can score them.
  const role = await getJudgeRole(supabaseAdmin, authUser.user.id, match.tournament_categories?.event_id || null);
  if (!role.isAdmin && !role.isJudge) {
    return Response.json(
      { success: false, error: 'Рахунок вводять лише судді цього турніру' },
      { status: 403 }
    );
  }

  const categoryDone = match.tournament_categories?.status === 'done';
  const newSets = { set1: sets[0], set2: sets[1] ?? null, set3: sets[2] ?? null };
  let winnerChanged = match.played && teamAWon(match) !== teamAWon(newSets);

  // ── Who may change what ──
  // • A judge enters the game in front of them while the category runs.
  // • The head judge may also correct a played game, while its stage is
  //   still the current one.
  // • The ADMIN may correct any game of any tournament, finished or not,
  //   with no exceptions. Everything that depends on the result follows:
  //   if a bracket game's winner flips, the two teams swap places in
  //   every later game they reached through it (see swapTeamsDownstream),
  //   and a finished tournament is recalculated below.
  let warning = null;
  if (!role.isAdmin) {
    if (categoryDone) {
      return Response.json(
        { success: false, error: 'Категорію завершено — змінити рахунок може лише адміністратор' },
        { status: 403 }
      );
    }
    if (match.played) {
      if (!role.isHeadJudge) {
        return Response.json(
          { success: false, error: 'Рахунок вже введено — змінити його може адмін або головний суддя' },
          { status: 403 }
        );
      }
      const lock = await checkStillCurrentStage(supabaseAdmin, match);
      if (!lock.ok) return Response.json({ success: false, error: lock.error }, { status: 400 });
    }
  } else if (winnerChanged && match.stage && !match.winner_to_match_id && !match.loser_to_match_id) {
    // Groups / King rounds: a later stage already played is left as it
    // was played — it is not re-drawn (that would wipe real results).
    const lock = await checkStillCurrentStage(supabaseAdmin, match);
    if (!lock.ok) warning = 'Рахунок збережено. Наступний етап уже зіграно — його склад не перебудовувався.';
  }

  const validation = validateForMatch(match, sets);
  if (!validation.valid) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  // The score is written under a row lock (migration 062): two requests
  // for the same game at once are applied one after the other, and each
  // learns exactly which result it replaced. That decides whether this
  // is the first entry (pays the Ело) or a correction, and whether the
  // winner really changed — not the possibly stale row read above.
  const saved = await saveScore(supabaseAdmin, match, newSets, role.isAdmin || role.isHeadJudge);
  if (saved.error) {
    console.error('[submit-score] error:', saved.error);
    return Response.json({ success: false, error: 'Не вдалося зберегти рахунок' }, { status: 500 });
  }
  if (!saved.saved) {
    // Another judge entered this game a moment ago.
    return Response.json(
      { success: false, error: 'Рахунок щойно ввів інший суддя — оновіть сторінку' },
      { status: 409 }
    );
  }
  const firstEntry = !saved.wasPlayed;
  winnerChanged = saved.wasPlayed && teamAWon(saved.prev) !== teamAWon(newSets);

  // Ело (Americanka) and the bracket do not depend on each other — both
  // at once. A first entry pays the game; a correction that changes the
  // winner re-pays it (see correctEloForAmericanka).
  if (winnerChanged) await swapTeamsDownstream(supabaseAdmin, match);
  await Promise.all([
    propagateBracket(supabaseAdmin, match, sets),
    firstEntry
      ? autoUpdateEloForAmericanka(supabaseAdmin, match, sets)
      : winnerChanged
      ? correctEloForAmericanka(supabaseAdmin, match, sets)
      : null,
  ]);

  // A correction may have landed while this first entry was still paying
  // the game (it then had no Ело history to correct yet, and its bracket
  // move may have been overwritten by ours). Look at the score as it is
  // now: if the winner is no longer the one just paid, settle to it.
  if (firstEntry) await settleToCurrentScore(supabaseAdmin, match, sets);

  // Stages advance themselves: once the last game of a King round or of
  // the group stage is entered, the next phase's teams are filled in —
  // there is no manual "next stage" step.
  if (!categoryDone) {
    // One builder at a time per category: two courts finishing the last
    // group games at the same moment used to build the next stage twice.
    await withStageLock(supabaseAdmin, match.category_id, async () => {
      await autoAdvanceKing(supabaseAdmin, match);
      await autoBuildCrossesPlayoff(supabaseAdmin, match);
    });
  }

  // A finished tournament: everything that was paid out from its results
  // is recomputed from the corrected games — places, the winner,
  // tournament counters, AVP points, and (if the winner changed) the
  // partner statistics.
  if (categoryDone) {
    const res = await refreshFinishedCategory(supabaseAdmin, match.category_id, { winnerChanged });
    if (!res.ok) {
      console.error('[submit-score] refresh finished category:', res.error);
      warning = 'Рахунок збережено, але перерахунок результатів не вдався — натисніть «Перерахувати» в адмінці.';
    }
  }

  return Response.json({ success: true, warning });
}

// The winner of a bracket game was corrected: the old winner and the old
// loser trade places in every later game reachable from it through the
// bracket pointers — whoever really won now stands where the old winner
// stood (and keeps that game's result), and the same the other way round.
// Unplayed later games just get the right names.
const teamKey = (t) => [...(t || [])].sort().join(',');
async function swapTeamsDownstream(supabaseAdmin, match) {
  const start = [match.winner_to_match_id, match.loser_to_match_id].filter(Boolean);
  if (start.length === 0) return;
  const a = teamKey(match.team_a_players);
  const b = teamKey(match.team_b_players);
  if (!a || !b) return;

  const { data: all } = await supabaseAdmin
    .from('tournament_matches')
    .select('id, team_a_players, team_b_players, winner_to_match_id, loser_to_match_id')
    .eq('category_id', match.category_id);
  const byId = new Map((all || []).map((m) => [m.id, m]));
  const swap = (t) => {
    const k = teamKey(t);
    return k === a ? match.team_b_players : k === b ? match.team_a_players : t;
  };

  const seen = new Set();
  const queue = [...start];
  const updates = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id) || id === match.id) continue;
    seen.add(id);
    const m = byId.get(id);
    if (!m) continue;
    const ta = swap(m.team_a_players);
    const tb = swap(m.team_b_players);
    if (ta !== m.team_a_players || tb !== m.team_b_players) {
      updates.push(supabaseAdmin.from('tournament_matches').update({ team_a_players: ta, team_b_players: tb }).eq('id', id));
    }
    [m.winner_to_match_id, m.loser_to_match_id].filter(Boolean).forEach((n) => queue.push(n));
  }
  const results = await Promise.all(updates);
  results.forEach((r) => r.error && console.error('[score swap-downstream]:', r.error.message));
}

// Is the match still in the "current" stage, i.e. safe to correct?
// Pointer-bracket matches: locked once the match their winner/loser
// feeds into has been played. Stage-based matches (groups, King
// rounds): locked once any game of a later stage has been played.
// Mirrors canEditScore() on the tournament page.
async function checkStillCurrentStage(supabaseAdmin, match) {
  const downstream = [match.winner_to_match_id, match.loser_to_match_id].filter(Boolean);
  if (downstream.length > 0) {
    const { data: next } = await supabaseAdmin.from('tournament_matches').select('id, played').in('id', downstream);
    if ((next || []).some((m) => m.played)) {
      return { ok: false, error: 'Наступний матч сітки вже зіграно — рахунок змінити не можна' };
    }
    return { ok: true };
  }
  const s = match.stage || '';
  // Leaf bracket matches (final, placement games) feed nothing further.
  if (match.is_final || /^p\d+_\d+$/.test(s) || s === 'gf') return { ok: true };
  if (!s) return { ok: true }; // americanka: locked only by the manual finish
  const { data: all } = await supabaseAdmin
    .from('tournament_matches')
    .select('stage, played')
    .eq('category_id', match.category_id);
  const w = stageWeight(s);
  if ((all || []).some((m) => m.played && m.stage && stageWeight(m.stage) > w)) {
    return {
      ok: false,
      error: 'Наступний етап вже розпочато — рахунок можна змінювати лише в поточному етапі',
    };
  }
  return { ok: true };
}

// King of the Beach: when the round this match belongs to is complete,
// rank the groups and fill the next round's placeholder matches (or
// finish the category if this was the final four).
// A short-lived lock row per category (migration 056): the stage
// builders run one after another, never side by side. The builders are
// safe to run twice in a row (they re-read every game and only fill or
// rebuild what is not played yet) — what broke was running them AT THE
// SAME TIME, when both saw «no playoff yet» and both inserted it. A
// request that finds the lock taken waits for it and then builds itself,
// so the game it just saved is always taken into account. A lock older
// than a minute is a crashed run and is cleared. Before the migration
// runs, the builder runs unlocked, as it always did.
async function withStageLock(supabaseAdmin, categoryId, fn) {
  if (!categoryId) return fn();
  await supabaseAdmin
    .from('stage_build_locks')
    .delete()
    .eq('category_id', categoryId)
    .lt('locked_at', new Date(Date.now() - 60000).toISOString());
  for (let attempt = 0; attempt < 30; attempt++) {
    const { error } = await supabaseAdmin.from('stage_build_locks').insert({ category_id: categoryId });
    if (!error) {
      try {
        return await fn();
      } finally {
        await supabaseAdmin.from('stage_build_locks').delete().eq('category_id', categoryId);
      }
    }
    if (error.code !== '23505') return fn(); // no lock table yet
    await new Promise((r) => setTimeout(r, 150));
  }
  return fn(); // waited ~4.5 s — build anyway rather than never
}

async function autoAdvanceKing(supabaseAdmin, match) {
  const kr = /^kr(\d+)$/.exec(match.stage || '');
  if (!kr) return;
  const round = Number(kr[1]);

  const { data: all } = await supabaseAdmin
    .from('tournament_matches')
    .select('id, stage, round_number, group_index, team_a_players, team_b_players, set1, set2, set3, played')
    .eq('category_id', match.category_id);
  const current = (all || []).filter((m) => m.stage === `kr${round}`);
  if (current.length === 0 || current.some((m) => !m.played)) return;

  const groupIdx = [...new Set(current.map((m) => m.group_index ?? 0))].sort((a, b) => a - b);
  const rankedGroups = groupIdx.map((gi) => {
    const gm = current.filter((m) => (m.group_index ?? 0) === gi);
    const ids = [...new Set(gm.flatMap((m) => [...(m.team_a_players || []), ...(m.team_b_players || [])]))];
    return rankGroupDetailed(ids, gm);
  });

  // A single group was the final — the category is over. The king comes
  // out of the shared placement table rather than being read off here, so
  // the winner the payout records is the winner the results page shows.
  if (rankedGroups.length === 1) {
    const res = await finishCategory(supabaseAdmin, match.category_id);
    if (!res.ok && !res.alreadyDone) console.error('[score king-finish]:', res.error);
    return;
  }

  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select('courts')
    .eq('id', match.category_id)
    .single();
  const courts = category?.courts?.length ? category.courts : [1];

  const nextOrder = kingAdvancers(rankedGroups);
  const nextRows = buildKingRound(nextOrder, courts, round + 1).matches;

  // Fill the pre-created placeholders (same deterministic order:
  // group_index, then round_number); tournaments started before the
  // placeholders existed get the round inserted instead. Already-filled
  // placeholders are overwritten too — an admin correction of the
  // finished round re-deals the next one — but never once the next
  // round is underway.
  const placeholders = (all || [])
    .filter((m) => m.stage === `kr${round + 1}`)
    .sort((a, b) => (a.group_index ?? 0) - (b.group_index ?? 0) || a.round_number - b.round_number);

  if (placeholders.length === nextRows.length) {
    if (placeholders.some((m) => m.played)) return;
    for (let i = 0; i < nextRows.length; i++) {
      await supabaseAdmin
        .from('tournament_matches')
        .update({
          team_a_players: nextRows[i].team_a_players,
          team_b_players: nextRows[i].team_b_players,
        })
        .eq('id', placeholders[i].id);
    }
  } else if (placeholders.length === 0) {
    await supabaseAdmin
      .from('tournament_matches')
      .insert(nextRows.map((m) => ({ ...m, category_id: match.category_id })));
  }
}

// Group+crosses pair systems: when the last group game is entered, build
// the full-placement playoff skeleton (was the manual "advance" step).
const CROSS_BUILDERS = {
  groups_crosses_1_2: buildCrossesPlayoff,
  groups_top1_bye_top23_crosses: buildByeCrossesPlayoff,
};

async function autoBuildCrossesPlayoff(supabaseAdmin, match) {
  if ((match.stage || '') !== 'group') return;

  const { data: category } = await supabaseAdmin
    .from('tournament_categories')
    .select(
      `bracket_system, courts, scheduled_at, points_to_win,
       tournament_events(points_to_win, points_mode, final_points_to_win)`
    )
    .eq('id', match.category_id)
    .single();
  const buildPlayoff = CROSS_BUILDERS[category?.bracket_system];
  if (!buildPlayoff) return;

  const { data: all } = await supabaseAdmin
    .from('tournament_matches')
    .select(
      `id, stage, round_number, group_index, court, scheduled_at,
       team_a_players, team_b_players, set1, set2, set3, played`
    )
    .eq('category_id', match.category_id);
  const groupMatches = (all || []).filter((m) => m.stage === 'group');
  if (groupMatches.some((m) => !m.played)) return;

  // A playoff skeleton may already exist (this is an admin correction of
  // a group score). While no playoff game has been played the seeding is
  // still fluid — drop the skeleton and rebuild it from the new ranking.
  const playoffMatches = (all || []).filter((m) => m.stage && m.stage !== 'group');
  if (playoffMatches.some((m) => m.played)) return; // playoff underway — group is locked
  if (playoffMatches.length > 0) {
    const { error: delError } = await supabaseAdmin
      .from('tournament_matches')
      .delete()
      .in('id', playoffMatches.map((m) => m.id));
    if (delError) {
      console.error('[score auto-playoff] rebuild delete:', delError.message);
      return;
    }
  }

  const { data: teamRows } = await supabaseAdmin
    .from('tournament_teams')
    .select('id, user1_id, user2_id')
    .eq('category_id', match.category_id);
  const teams = (teamRows || [])
    .filter((t) => t.user1_id && t.user2_id)
    .map((t) => ({ id: t.id, players: [t.user1_id, t.user2_id] }));

  const courts = category.courts?.length ? category.courts : [1];
  const ranked = computeGroupRanking(teams, groupMatches);
  let rows;
  try {
    rows = buildPlayoff(ranked, courts);
  } catch (e) {
    console.error('[score auto-playoff]:', e.message);
    return;
  }
  // The playoff is appended to a category that is already running, so its
  // times queue up behind the group games instead of restarting from the
  // category time.
  const ev = category.tournament_events;
  const scoring = {
    points_to_win: category.points_to_win ?? ev?.points_to_win ?? 21,
    points_mode: ev?.points_mode,
    final_points_to_win: ev?.final_points_to_win,
  };
  const targetFor = (m) => pointsTargetForStage(scoring, m.stage);
  const timed = assignScheduledTimes(rows, {
    startAt: category.scheduled_at,
    targetFor,
    cursors: cursorsFromMatches(groupMatches, targetFor),
  });

  const { error } = await supabaseAdmin
    .from('tournament_matches')
    .insert(timed.map((m) => ({ ...m, category_id: match.category_id })));
  if (error) console.error('[score auto-playoff] insert:', error.message);
}

async function propagateBracket(supabaseAdmin, match, sets) {
  const aWon = teamAWon({ set1: sets[0], set2: sets[1], set3: sets[2] });
  const winnerPlayers = aWon ? match.team_a_players : match.team_b_players;
  const loserPlayers = aWon ? match.team_b_players : match.team_a_players;

  const setSlot = async (matchId, slot, players) => {
    const col = slot === 'a' ? 'team_a_players' : 'team_b_players';
    await supabaseAdmin.from('tournament_matches').update({ [col]: players }).eq('id', matchId);
  };

  if (match.winner_to_match_id) {
    await setSlot(match.winner_to_match_id, match.winner_to_slot, winnerPlayers);
  }
  if (match.loser_to_match_id) {
    await setSlot(match.loser_to_match_id, match.loser_to_slot, loserPlayers);
  }

  // Is this match part of a pointer bracket (double-elim or a crosses
  // playoff)? Group/King matches are handled by their own advance routes.
  const s = match.stage || '';
  const isBracket =
    match.is_final ||
    match.winner_to_match_id ||
    match.loser_to_match_id ||
    s === 'final' ||
    s === 'gf' ||
    /^p\d+_\d+$/.test(s) ||
    /^(wb|lb)\d+$/.test(s);
  if (!isBracket) return;

  // Finish only once EVERY bracket match is played — the 1-2 final may be
  // decided before the lower-placement matches.
  const { data: all } = await supabaseAdmin
    .from('tournament_matches')
    .select('played')
    .eq('category_id', match.category_id);
  if (!all || all.some((m) => !m.played)) return;

  const res = await finishCategory(supabaseAdmin, match.category_id);
  if (!res.ok && !res.alreadyDone) console.error('[score bracket-finish]:', res.error);
}

// Американка: Ело recalculates automatically after every game — every
// other format leaves Ело admin-set (see the comment on this in
// lib/server/finishCategory.ts for why that's the default everywhere
// else). `match` here is the state fetched BEFORE this request's
// update, so `match.played` reflects whether a score already existed —
// that's what scopes this to a game's first entry only. A correction
// (re-entering a score that was already in) does not undo-and-reapply
// the old delta: doing that safely needs the exact sequence of every
// Ело change these four players have had since, not just this one
// match's old score, and getting that wrong would silently corrupt a
// rating rather than obviously fail. An admin can still adjust
// manually via the existing edit-Ело screen if a correction changes
// who actually won.
async function autoUpdateEloForAmericanka(supabaseAdmin, match, sets) {
  if (match.played) return;

  const format = match.tournament_categories?.tournament_events?.format_kind;
  if (format !== 'americanka') return;

  const teamA = match.team_a_players || [];
  const teamB = match.team_b_players || [];
  if (teamA.length !== 2 || teamB.length !== 2) return; // defensive — americanka is always 2v2

  // Ело is per SPORT (migration 043): a padel game must never move the
  // volleyball rating. ratings.ts hides where each sport's number lives.
  const sportId = match.tournament_categories?.tournament_events?.sport_id || null;
  const allIds = [...teamA, ...teamB];
  const eloById = await readRatings(supabaseAdmin, allIds, sportId);

  // The math lives in lib/elo.ts (and is unit-tested there): each team
  // plays at the average of its two players' Ело, the team delta comes
  // out of the standard formula at K=32, and the pair then splits that
  // delta — the weaker partner taking the larger share of a win and the
  // smaller share of a loss. The four deltas always sum to zero.
  const aWon = teamAWon({ set1: sets[0], set2: sets[1] ?? null, set3: sets[2] ?? null });
  const deltas = matchDeltas(
    [eloById.get(teamA[0]), eloById.get(teamA[1])],
    [eloById.get(teamB[0]), eloById.get(teamB[1])],
    aWon
  );

  // All four ratings at once, then the four history rows in one insert
  // (this used to be eight requests one after another).
  const results = await Promise.all(
    allIds.map(async (playerId, i) => {
      // Added in the database (add_elo), not written back from what was
      // read: two games of the same player entered at the same moment
      // must not overwrite each other's change.
      const { elo: after, error: updateError } = await addRating(supabaseAdmin, playerId, sportId, deltas[i]);
      if (updateError || after == null) {
        console.error('[auto-elo] rating update:', updateError);
        return null;
      }
      const before = after - deltas[i];
      // No category_id: since migration 042 the row names only the game,
      // and the category is reached through it. sport_id: since 043.
      const row = {
        user_id: playerId,
        match_id: match.id,
        delta: deltas[i],
        elo_before: before,
        elo_after: after,
        reason: 'tournament_result',
      };
      if (sportId) row.sport_id = sportId;
      return row;
    })
  );
  const historyRows = results.filter(Boolean);
  if (historyRows.length > 0) {
    const { error: historyError } = await supabaseAdmin.from('elo_history').insert(historyRows);
    if (historyError) console.error('[auto-elo] elo_history insert:', historyError.message);
  }
}

// A correction that changes who won an Americanka game. The game is paid
// again from the SAME starting ratings it was paid from the first time
// (elo_before in its history rows), so its new delta is exactly what it
// would have been; each player's current rating moves by the difference
// and the history rows are rewritten. Games played after it keep their
// deltas (re-playing the whole chain would move ratings nobody expects to
// move); the error that leaves is a point or two at most.
// Only the winner matters for Ело — a corrected margin changes nothing.
async function correctEloForAmericanka(supabaseAdmin, match, sets) {
  const format = match.tournament_categories?.tournament_events?.format_kind;
  if (format !== 'americanka') return;
  const teamA = match.team_a_players || [];
  const teamB = match.team_b_players || [];
  if (teamA.length !== 2 || teamB.length !== 2) return;
  const allIds = [...teamA, ...teamB];

  // A first entry that raced this correction may still be writing its
  // history rows — give it a moment before deciding there are none.
  let rows = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await supabaseAdmin
      .from('elo_history')
      .select('id, user_id, delta, elo_before')
      .eq('match_id', match.id)
      .eq('reason', 'tournament_result');
    rows = data || [];
    if (rows.length >= allIds.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const byUser = new Map((rows || []).map((r) => [r.user_id, r]));
  // Games from before Ело history was written cannot be re-paid exactly.
  if (!allIds.every((id) => byUser.has(id) && byUser.get(id).elo_before != null)) return;

  const sportId = match.tournament_categories?.tournament_events?.sport_id || null;
  const aWon = teamAWon({ set1: sets[0], set2: sets[1] ?? null, set3: sets[2] ?? null });
  const b = (id) => byUser.get(id).elo_before;
  const deltas = matchDeltas([b(teamA[0]), b(teamA[1])], [b(teamB[0]), b(teamB[1])], aWon);
  await Promise.all(
    allIds.map(async (id, i) => {
      const row = byUser.get(id);
      const diff = deltas[i] - row.delta;
      if (diff === 0) return;
      // The history row is switched first, and only if it still holds the
      // delta read above: of two corrections at once, only one moves the
      // rating — the other finds the row already changed and stops.
      const { data: switched, error } = await supabaseAdmin
        .from('elo_history')
        .update({ delta: deltas[i], elo_after: row.elo_before + deltas[i] })
        .eq('id', row.id)
        .eq('delta', row.delta)
        .select('id');
      if (error) {
        console.error('[elo-correction] history update:', error.message);
        return;
      }
      if ((switched || []).length !== 1) return;
      const { error: err } = await addRating(supabaseAdmin, id, sportId, diff);
      if (err) {
        console.error('[elo-correction] rating update:', err);
        // put the history back so the next correction starts from the truth
        await supabaseAdmin
          .from('elo_history')
          .update({ delta: row.delta, elo_after: row.elo_before + row.delta })
          .eq('id', row.id);
      }
    })
  );
}

// Pick the scoring rule from the event's format. Eventless categories
// (none should exist after the rewrite) default to americanka sum-to-31;
// americanka itself goes to the category's sum (29 / 31 / 35).
// Americanka is always exactly one set; first-to formats take 1–3 sets.
function validateForMatch(match, sets) {
  const category = match.tournament_categories;
  const event = category?.tournament_events;
  const format = event ? getFormat(event.format_kind) : null;
  const isSum = !format || format.scoring === 'sum31';

  if (isSum) {
    if (sets.length !== 1) {
      return { valid: false, error: 'Americanka грається в одну партію' };
    }
    // the sum the organizer chose: 29, 31 or 35 (lib/formats/americano)
    return validateSumTo(sets[0][0], sets[0][1], americankaSum(category?.points_to_win));
  }

  // Single-set first-to formats (king of the beach).
  if (format.maxSets === 1 && sets.length !== 1) {
    return { valid: false, error: 'У цьому форматі матч грається в одну партію' };
  }

  const target = pointsTargetForStage(
    {
      points_to_win: category.points_to_win ?? event.points_to_win ?? 21,
      points_mode: event.points_mode,
      final_points_to_win: event.final_points_to_win,
    },
    match.stage
  );
  return validateSetsFirstTo(sets, target);
}


// After a first entry: if the stored score now has a different winner
// than the one this request paid (a correction raced it), re-pay the Ело
// and re-place the teams in the bracket from the stored score.
async function settleToCurrentScore(supabaseAdmin, match, paidSets) {
  const { data: now } = await supabaseAdmin
    .from('tournament_matches')
    .select('set1, set2, set3')
    .eq('id', match.id)
    .maybeSingle();
  if (!now?.set1) return;
  const paid = { set1: paidSets[0], set2: paidSets[1] ?? null, set3: paidSets[2] ?? null };
  if (teamAWon(now) === teamAWon(paid)) return;
  const currentSets = [now.set1, now.set2, now.set3].filter(Boolean);
  await Promise.all([
    propagateBracket(supabaseAdmin, match, currentSets),
    correctEloForAmericanka(supabaseAdmin, match, currentSets),
  ]);
}
