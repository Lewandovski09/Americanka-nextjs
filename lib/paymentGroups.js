// League by league, who is in an event — for the «Оплата» tab
// (app/events/PaymentsTab). Pure (see paymentGroups.test).

const G = { M: 'Ч · ', F: 'Ж · ' };

/**
 * @param {any[]} categories
 * @param {boolean} isPair
 * @returns {{ id: string, label: string, units: any[][] }[]}
 */
export function paymentGroups(categories, isPair) {
  return (categories || [])
    .map((c) => {
      const units = isPair
        ? (c.tournament_teams || []).map((t) =>
            [
              t.user1_id ? { id: t.user1_id, ...(t.p1 || {}) } : null,
              t.user2_id ? { id: t.user2_id, ...(t.p2 || {}) } : null,
            ].filter(Boolean)
          )
        : (c.tournament_players || []).map((tp) => [{ id: tp.user_id, ...(tp.users || {}) }]);
      return { id: c.id, label: `${G[c.gender] || ''}${c.category_label || 'Категорія'}`, units: units.filter((u) => u.length) };
    })
    .filter((g) => g.units.length > 0);
}
