// Server-side helper: place a participant into a category
// (`tournaments` row). Used by admin distribution — the single place
// where capacity/uniqueness rules live. Solo formats write
// `tournament_players`; pair formats write `tournament_teams`.

import type { SupabaseAdmin } from './types';
import type { FormatKind } from '../formats';

/** A `tournaments` row, trimmed to what placeMember reads. */
export interface CategoryRow {
  id: string;
  max_participants?: number | null;
  [key: string]: unknown;
}

export interface Applicant {
  playerId: string;
  partnerId?: string | null;
  seekingPartner?: boolean;
}

export interface PlaceMemberResult {
  error?: string;
}

/**
 * Everyone an event has already taken: a live application (their own, or
 * one that names them as the partner) or a place in one of its rosters.
 * One person = one application per event, so this is the set both the
 * self-service registration and the admin's manual entry check against.
 *
 * @returns player ids
 */
export async function eventParticipantIds(supabaseAdmin: SupabaseAdmin, eventId: string): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data: apps } = await supabaseAdmin
    .from('tournament_applications')
    .select('user_id, partner_id')
    .eq('event_id', eventId)
    .not('status', 'in', '(withdrawn,rejected)');
  (apps || []).forEach((a: { user_id: string | null; partner_id: string | null }) => {
    if (a.user_id) ids.add(a.user_id);
    if (a.partner_id) ids.add(a.partner_id);
  });

  // Rosters too: a manually entered player or one distributed long ago
  // must not be offered again even if the application rows drifted.
  const { data: cats } = await supabaseAdmin.from('tournament_categories').select('id').eq('event_id', eventId);
  const catIds = (cats || []).map((c: { id: string }) => c.id);
  if (catIds.length > 0) {
    const [{ data: solos }, { data: teams }] = await Promise.all([
      supabaseAdmin.from('tournament_players').select('user_id').in('category_id', catIds),
      supabaseAdmin.from('tournament_teams').select('user1_id, user2_id').in('category_id', catIds),
    ]);
    (solos || []).forEach((r: { user_id: string }) => ids.add(r.user_id));
    (teams || []).forEach((t: { user1_id: string | null; user2_id: string | null }) => {
      if (t.user1_id) ids.add(t.user1_id);
      if (t.user2_id) ids.add(t.user2_id);
    });
  }

  return ids;
}

export async function placeMember(
  supabaseAdmin: SupabaseAdmin,
  category: CategoryRow,
  format: FormatKind,
  applicant: Applicant
): Promise<PlaceMemberResult> {
  const isPair = format.registrationType === 'pair' || format.registrationType === 'mix_pair';

  if (isPair) {
    const { count } = await supabaseAdmin
      .from('tournament_teams')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', category.id);

    const capacity = category.max_participants; // pairs
    if (capacity && (count ?? 0) >= capacity) return { error: 'У категорії немає вільних місць' };

    const { error } = await supabaseAdmin.from('tournament_teams').insert({
      category_id: category.id,
      user1_id: applicant.playerId,
      user2_id: applicant.seekingPartner ? null : applicant.partnerId || null,
    });
    if (error) {
      if (error.code === '23505') return { error: 'Ви або напарник вже у цій категорії' };
      console.error('[placeMember] team insert:', error.message);
      return { error: 'Не вдалося зареєструвати пару' };
    }
    return {};
  }

  // Solo (americanka / king_of_beach)
  const { count } = await supabaseAdmin
    .from('tournament_players')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', category.id);

  const capacity = category.max_participants || format.fixedParticipants || null;
  if (capacity && (count ?? 0) >= capacity) return { error: 'У категорії немає вільних місць' };

  // No slot_index here on purpose — the seed is set by hand on the
  // «Посів» tab, exactly like for pairs, and the category refuses to
  // start until every row has one.
  const { error } = await supabaseAdmin.from('tournament_players').insert({
    category_id: category.id,
    user_id: applicant.playerId,
  });
  if (error) {
    if (error.code === '23505') return { error: 'Ви вже у цій категорії' };
    console.error('[placeMember] player insert:', error.message);
    return { error: 'Не вдалося зареєструватися' };
  }
  return {};
}
