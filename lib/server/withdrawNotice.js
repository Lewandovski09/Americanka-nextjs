// «Хтось знявся з турніру» — a Telegram note to the owner(s) of the app
// (app_owners, migration 053) whenever a player or a pair withdraws:
// who, from which tournament and league, where they were (in the league
// or still in the applications), and how full the league is now.

import { escapeHtml, trySendTelegramMessageWithButtons } from '@/lib/telegram';
import { eventDateLabel } from '@/lib/server/eventCardData';
import { publicSiteUrl } from '@/lib/server/siteUrl';
import { appLink, browserButton } from '@/lib/server/openInApp';

const GENDER = { M: 'Ч', F: 'Ж' };

/**
 * The note's text (HTML). Pure — see withdrawNotice.test.
 * @param {{ player: any, partner?: any, withPartner?: boolean, event: any, category?: any,
 *   requestedLabel?: string | null, where?: string, roster?: any, isPair?: boolean }} info
 */
export function withdrawNoticeText({ player, partner, withPartner, event, category, requestedLabel, where, roster, isPair }) {
  const name = (u) => `<b>${escapeHtml(u?.full_name || 'Гравець')}</b>${u?.elo != null ? ` (Ело ${u.elo})` : ''}`;
  const who = withPartner && partner
    ? `👥 Пара ${name(player)} і ${name(partner)}`
    : `👤 ${name(player)}`;
  const partnerLine =
    !withPartner && partner
      ? `🤝 Напарник ${name(partner)} залишається в турнірі й тепер шукає пару`
      : null;

  const league = category
    ? [GENDER[category.gender], category.category_label || category.name].filter(Boolean).join(' · ')
    : requestedLabel
    ? `${requestedLabel} (бажана, ще не розподілено)`
    : '—';
  const whereText = { roster: 'у складі ліги', reserve: 'у резерві', queue: 'у заявках (ще не розподілено)' }[where] || '—';

  const lines = [
    `🚪 <b>Зняття з турніру</b>`,
    '',
    who,
    partnerLine,
    `🏆 Турнір: <b>${escapeHtml(event.name || 'Турнір')}</b>${event.scheduled_at ? ` · ${escapeHtml(eventDateLabel(event.scheduled_at))}` : ''}`,
    `📂 Категорія: <b>${escapeHtml(league)}</b>`,
    `📋 Був(ла): ${whereText}`,
    roster ? `📊 Тепер у лізі: ${roster.taken}/${roster.total ?? '—'} ${isPair ? 'пар' : 'гравців'}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export async function notifyWithdrawal(supabaseAdmin, request, info) {
  const { event, playerId, partnerId, categoryId, isPair } = info;

  const [{ data: owners }, { data: people }, { data: category }] = await Promise.all([
    supabaseAdmin.from('app_owners').select('user_id'),
    supabaseAdmin.from('users').select('id, full_name, elo').in('id', [playerId, partnerId].filter(Boolean)),
    categoryId
      ? supabaseAdmin
          .from('tournament_categories')
          .select('id, name, category_label, gender, max_participants')
          .eq('id', categoryId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const ownerIds = (owners || []).map((o) => o.user_id);
  if (ownerIds.length === 0) return;

  let roster = null;
  if (category) {
    const { count } = await supabaseAdmin
      .from(isPair ? 'tournament_teams' : 'tournament_players')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', category.id);
    roster = { taken: count ?? 0, total: category.max_participants ?? null };
  }

  const text = withdrawNoticeText({
    ...info,
    player: (people || []).find((u) => u.id === playerId),
    partner: (people || []).find((u) => u.id === partnerId),
    category,
    roster,
  });

  const site = publicSiteUrl(request);
  const keyboard = site ? browserButton('⚙ Відкрити турнір', appLink(site, `/events/settings/${event.id}`)) : undefined;

  const { data: chats } = await supabaseAdmin
    .from('users')
    .select('telegram_user_id, telegram_linked_at')
    .in('id', ownerIds);
  await Promise.all(
    (chats || [])
      .filter((c) => c.telegram_user_id && c.telegram_linked_at)
      .map((c) => trySendTelegramMessageWithButtons(c.telegram_user_id, text, keyboard))
  );
}
