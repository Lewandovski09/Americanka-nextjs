import { effectiveTier } from '@/lib/avp/tiers';
import { BRACKET_SYSTEMS } from '@/lib/formats';

/**
 * Enriches a flat list of category rows (from `tournaments`) with who's
 * registered and how full they are — one batched pass regardless of
 * whether the categories belong to one event or several, rather than a
 * query per category. `format` is the FormatKind for solo vs pair
 * registration; `eventTier` is the event's own avp_tier, used as the
 * fallback when a category has none of its own (see effectiveTier).
 *
 * Each input row needs at minimum: id, category_label, category,
 * gender, max_participants, avp_tier, bracket_system.
 */
export async function enrichCategoriesWithSlots(supabase, categories, format, eventTier) {
  const isPairFormat = format?.registrationType && format.registrationType !== 'solo';
  const catIds = categories.map((c) => c.id);
  const playersByTournament = new Map();
  const pairsByTournament = new Map();

  if (catIds.length && isPairFormat) {
    const { data: teams } = await supabase
      .from('tournament_teams')
      .select('category_id, user1_id, user2_id')
      .in('category_id', catIds);
    (teams || []).forEach((t) => {
      pairsByTournament.set(t.category_id, (pairsByTournament.get(t.category_id) || 0) + 1);
    });
    const allPlayerIds = [...new Set((teams || []).flatMap((t) => [t.user1_id, t.user2_id]).filter(Boolean))];
    const { data: teamPlayers } = allPlayerIds.length
      ? await supabase.from('users').select('id, full_name, photo_url').in('id', allPlayerIds)
      : { data: [] };
    const playerById = new Map((teamPlayers || []).map((p) => [p.id, p]));
    (teams || []).forEach((t) => {
      const list = playersByTournament.get(t.category_id) || [];
      if (playerById.get(t.user1_id)) list.push(playerById.get(t.user1_id));
      if (playerById.get(t.user2_id)) list.push(playerById.get(t.user2_id));
      playersByTournament.set(t.category_id, list);
    });
  } else if (catIds.length) {
    const { data: tps } = await supabase
      .from('tournament_players')
      .select('category_id, users(id, full_name, photo_url)')
      .in('category_id', catIds);
    (tps || []).forEach((tp) => {
      const list = playersByTournament.get(tp.category_id) || [];
      if (tp.users) list.push(tp.users);
      playersByTournament.set(tp.category_id, list);
    });
  }

  return categories.map((c) => {
    const taken = isPairFormat ? pairsByTournament.get(c.id) || 0 : (playersByTournament.get(c.id) || []).length;
    const total = isPairFormat ? c.max_participants ?? 0 : c.max_participants ?? format?.fixedParticipants ?? 8;
    return {
      ...c,
      slotsTaken: taken,
      slotsTotal: total,
      spotsLeft: Math.max(0, total - taken),
      slotsLabel: isPairFormat ? 'пар' : 'гравців',
      players: playersByTournament.get(c.id) || [],
      avpTier: effectiveTier(c, { avp_tier: eventTier }),
      bracketLabel: BRACKET_SYSTEMS.find((b) => b.id === c.bracket_system)?.shortLabel || null,
    };
  });
}
