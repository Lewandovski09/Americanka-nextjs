// «Хто виграє?» options from a category's roster (see components/VotePoll).
// Separate from the component so a page can build the options without
// loading the poll itself until it is shown.

import { surname } from '@/lib/names';

/**
 * Options from a category's roster, in the shape VotePoll takes.
 * Solo: tournament_players rows ({ user_id, users }). Pairs:
 * tournament_teams rows ({ id, user1_id, user2_id, p1, p2 }).
 */
export function voteOptionsFrom({ isPair, players, teams }) {
  if (isPair) {
    return (teams || [])
      .filter((t) => t.id)
      .map((t) => ({
        id: t.id,
        memberIds: [t.user1_id, t.user2_id].filter(Boolean),
        people: [t.p1, t.p2].filter(Boolean),
        name: [t.p1, t.p2].filter(Boolean).map(surname).join(' / ') || '—',
      }));
  }
  return (players || []).map((tp) => ({
    id: tp.user_id,
    memberIds: [tp.user_id],
    people: tp.users ? [tp.users] : [],
    name: tp.users?.full_name || '—',
  }));
}
