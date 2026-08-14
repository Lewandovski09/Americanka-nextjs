import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormat } from '@/lib/formats';
import { validateSumTo, validateSetsFirstTo, pointsTargetForStage } from '@/lib/formats/scoring';
import { teamAWon } from '@/lib/formats/sets';
import { categoryForElo } from '@/lib/elo';
import { buildKingRound, rankGroupDetailed, kingAdvancers } from '@/lib/formats/kingOfBeach';
import { computeGroupRanking, buildCrossesPlayoff, buildByeCrossesPlayoff } from '@/lib/formats/brackets';
import { stageWeight } from '@/lib/formats/stages';
import { assignScheduledTimes, cursorsFromMatches } from '@/lib/schedule';
import { getJudgeRole } from '@/lib/server/judges';
import { finishCategory } from '@/lib/server/finishCategory';

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
  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser?.user) {
    return Response.json({ success: false, error: 'Не авторизовано' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select(
      `*, tournaments(status, points_to_win, event_id,
        tournament_events(format_kind, points_to_win, points_mode, final_points_to_win))`
    )
    .eq('id', matchId)
    .single();

  if (!match) {
    return Response.json({ success: false, error: 'Матч не знайдено' }, { status: 404 });
  }

  // A score is entered by the crew running the day — an admin or a judge
  // of this event. It used to be open to anyone signed in, which was
  // survivable while a score was just a number on a page and stopped
  // being so once results pay out tournament counters, partner stats and
  // AVP season points. Any judge of the event may enter any of its
  // games: `matches.judge_id` pins who is expected at a court, it is not
  // a permission (a crew swaps courts all day).
  //
  // Legacy categories that predate events have no crew, so only an admin
  // can score them.
  const role = await getJudgeRole(supabaseAdmin, authUser.user.id, match.tournaments?.event_id || null);
  if (!role.isAdmin && !role.isJudge) {
    return Response.json(
      { success: false, error: 'Рахунок може вводити лише суддя або адміністратор' },
      { status: 403 }
    );
  }

  // Re-entering a score is a correction, and that is narrower: an
  // ordinary judge enters the game in front of them, but unpicking a
  // result the bracket has already built on is the head judge's call —
  // and only while the match's stage is still current. A finished
  // category is locked outright.
  if (match.played) {
    if (match.tournaments?.status === 'done') {
      return Response.json(
        { success: false, error: 'Категорію завершено — рахунок змінити не можна' },
        { status: 400 }
      );
    }
    if (!role.isAdmin && !role.isHeadJudge) {
      return Response.json(
        { success: false, error: 'Рахунок вже введено — змінити його може адмін або головний суддя' },
        { status: 403 }
      );
    }
    const lock = await checkStillCurrentStage(supabaseAdmin, match);
    if (!lock.ok) {
      return Response.json({ success: false, error: lock.error }, { status: 400 });
    }
  }

  const validation = validateForMatch(match, sets);
  if (!validation.valid) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({
      set1: sets[0],
      set2: sets[1] ?? null,
      set3: sets[2] ?? null,
      played: true,
      played_at: new Date().toISOString(),
    })
    .eq('id', matchId);

  if (error) {
    console.error('[submit-score] error:', error.message);
    return Response.json({ success: false, error: 'Не вдалося зберегти рахунок' }, { status: 500 });
  }

  // Event-driven brackets (Double Elimination): push the winner and
  // loser into their next match slots, and finish the category when the
  // deciding match is played.
  await propagateBracket(supabaseAdmin, match, sets);

  // Americanka: Ело recalculates itself after this game — see the
  // function below for the scoping and why every other format stays
  // admin-set instead.
  await autoUpdateEloForAmericanka(supabaseAdmin, match, sets);

  // Stages advance themselves: once the last game of a King round or of
  // the group stage is entered, the next phase's teams are filled in —
  // there is no manual "next stage" step.
  await autoAdvanceKing(supabaseAdmin, match);
  await autoBuildCrossesPlayoff(supabaseAdmin, match);

  return Response.json({ success: true });
}

// Is the match still in the "current" stage, i.e. safe to correct?
// Pointer-bracket matches: locked once the match their winner/loser
// feeds into has been played. Stage-based matches (groups, King
// rounds): locked once any game of a later stage has been played.
// Mirrors canEditScore() on the tournament page.
async function checkStillCurrentStage(supabaseAdmin, match) {
  const downstream = [match.winner_to_match_id, match.loser_to_match_id].filter(Boolean);
  if (downstream.length > 0) {
    const { data: next } = await supabaseAdmin.from('matches').select('id, played').in('id', downstream);
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
    .from('matches')
    .select('stage, played')
    .eq('tournament_id', match.tournament_id);
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
async function autoAdvanceKing(supabaseAdmin, match) {
  const kr = /^kr(\d+)$/.exec(match.stage || '');
  if (!kr) return;
  const round = Number(kr[1]);

  const { data: all } = await supabaseAdmin
    .from('matches')
    .select('id, stage, round_number, group_index, team_a_players, team_b_players, set1, set2, set3, played')
    .eq('tournament_id', match.tournament_id);
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
    const res = await finishCategory(supabaseAdmin, match.tournament_id);
    if (!res.ok && !res.alreadyDone) console.error('[score king-finish]:', res.error);
    return;
  }

  const { data: category } = await supabaseAdmin
    .from('tournaments')
    .select('courts')
    .eq('id', match.tournament_id)
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
        .from('matches')
        .update({
          team_a_players: nextRows[i].team_a_players,
          team_b_players: nextRows[i].team_b_players,
        })
        .eq('id', placeholders[i].id);
    }
  } else if (placeholders.length === 0) {
    await supabaseAdmin
      .from('matches')
      .insert(nextRows.map((m) => ({ ...m, tournament_id: match.tournament_id })));
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
    .from('tournaments')
    .select(
      `bracket_system, courts, scheduled_at, points_to_win,
       tournament_events(points_to_win, points_mode, final_points_to_win)`
    )
    .eq('id', match.tournament_id)
    .single();
  const buildPlayoff = CROSS_BUILDERS[category?.bracket_system];
  if (!buildPlayoff) return;

  const { data: all } = await supabaseAdmin
    .from('matches')
    .select(
      `id, stage, round_number, group_index, court, scheduled_at,
       team_a_players, team_b_players, set1, set2, set3, played`
    )
    .eq('tournament_id', match.tournament_id);
  const groupMatches = (all || []).filter((m) => m.stage === 'group');
  if (groupMatches.some((m) => !m.played)) return;

  // A playoff skeleton may already exist (this is an admin correction of
  // a group score). While no playoff game has been played the seeding is
  // still fluid — drop the skeleton and rebuild it from the new ranking.
  const playoffMatches = (all || []).filter((m) => m.stage && m.stage !== 'group');
  if (playoffMatches.some((m) => m.played)) return; // playoff underway — group is locked
  if (playoffMatches.length > 0) {
    const { error: delError } = await supabaseAdmin
      .from('matches')
      .delete()
      .in('id', playoffMatches.map((m) => m.id));
    if (delError) {
      console.error('[score auto-playoff] rebuild delete:', delError.message);
      return;
    }
  }

  const { data: teamRows } = await supabaseAdmin
    .from('tournament_teams')
    .select('id, player1_id, player2_id')
    .eq('tournament_id', match.tournament_id);
  const teams = (teamRows || [])
    .filter((t) => t.player1_id && t.player2_id)
    .map((t) => ({ id: t.id, players: [t.player1_id, t.player2_id] }));

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
    .from('matches')
    .insert(timed.map((m) => ({ ...m, tournament_id: match.tournament_id })));
  if (error) console.error('[score auto-playoff] insert:', error.message);
}

async function propagateBracket(supabaseAdmin, match, sets) {
  const aWon = teamAWon({ set1: sets[0], set2: sets[1], set3: sets[2] });
  const winnerPlayers = aWon ? match.team_a_players : match.team_b_players;
  const loserPlayers = aWon ? match.team_b_players : match.team_a_players;

  const setSlot = async (matchId, slot, players) => {
    const col = slot === 'a' ? 'team_a_players' : 'team_b_players';
    await supabaseAdmin.from('matches').update({ [col]: players }).eq('id', matchId);
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
    .from('matches')
    .select('played')
    .eq('tournament_id', match.tournament_id);
  if (!all || all.some((m) => !m.played)) return;

  const res = await finishCategory(supabaseAdmin, match.tournament_id);
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

  const format = match.tournaments?.tournament_events?.format_kind;
  if (format !== 'americanka') return;

  const teamA = match.team_a_players || [];
  const teamB = match.team_b_players || [];
  if (teamA.length !== 2 || teamB.length !== 2) return; // defensive — americanka is always 2v2

  const allIds = [...teamA, ...teamB];
  const { data: players } = await supabaseAdmin.from('players').select('id, elo').in('id', allIds);
  const eloById = new Map((players || []).map((p) => [p.id, p.elo ?? 1200]));

  // Team rating = average of its two players' current Ело — the same
  // "what-if" math the calculator on a player's own profile already
  // shows them (K=32), just applied to the team average instead of one
  // player's Ело against a slider.
  const teamAElo = (eloById.get(teamA[0]) + eloById.get(teamA[1])) / 2;
  const teamBElo = (eloById.get(teamB[0]) + eloById.get(teamB[1])) / 2;
  const aWon = teamAWon({ set1: sets[0], set2: sets[1] ?? null, set3: sets[2] ?? null });
  const K = 32;
  const expectedA = 1 / (1 + Math.pow(10, (teamBElo - teamAElo) / 400));
  const deltaA = Math.round(K * ((aWon ? 1 : 0) - expectedA));
  const deltaB = -deltaA;

  for (const [side, delta] of [
    [teamA, deltaA],
    [teamB, deltaB],
  ]) {
    for (const playerId of side) {
      const before = eloById.get(playerId) ?? 1200;
      const after = before + delta;
      const { error: updateError } = await supabaseAdmin
        .from('players')
        .update({ elo: after, category: categoryForElo(after)?.id })
        .eq('id', playerId);
      if (updateError) {
        console.error('[auto-elo] players update:', updateError.message);
        continue;
      }
      const { error: historyError } = await supabaseAdmin.from('elo_history').insert({
        player_id: playerId,
        tournament_id: match.tournament_id,
        match_id: match.id,
        delta,
        elo_before: before,
        elo_after: after,
        reason: 'tournament_result',
      });
      if (historyError) console.error('[auto-elo] elo_history insert:', historyError.message);
    }
  }
}

// Pick the scoring rule from the event's format. Eventless categories
// (none should exist after the rewrite) default to americanka sum-to-31.
// Americanka is always exactly one set; first-to formats take 1–3 sets.
function validateForMatch(match, sets) {
  const category = match.tournaments;
  const event = category?.tournament_events;
  const format = event ? getFormat(event.format_kind) : null;
  const isSum = !format || format.scoring === 'sum31';

  if (isSum) {
    if (sets.length !== 1) {
      return { valid: false, error: 'Американка грається в одну партію' };
    }
    return validateSumTo(sets[0][0], sets[0][1], 31);
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
