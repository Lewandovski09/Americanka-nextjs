'use client';

// «Хто виграє?» — the players' forecast for one category (migration 050).
//
// The options are whoever is in the category right now: every player of
// a solo format, every pair of a pair format. Nobody adds options by
// hand — a player who joins appears here on the next load, one who
// leaves disappears, and votes for someone no longer in the roster are
// simply not counted. One vote per person per category; tapping another
// option changes it, tapping your own takes it back. Until the category
// starts (the database refuses changes after that); then the results
// stay visible, and once it is finished the winner is marked.

import { pluralUk } from '@/lib/pluralize';

import { surname } from '@/lib/names';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './VotePoll.module.css';

const votesWord = (n) => pluralUk(n, 'голос', 'голоси', 'голосів');

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

/**
 * @param {{ categoryId: string, title?: string, options: ReturnType<typeof voteOptionsFrom>,
 *           open: boolean, winnerIds?: string[] }} props
 */
export default function VotePoll({ categoryId, title, options, open, winnerIds = [] }) {
  const { player } = useCurrentPlayer();
  const [votes, setVotes] = useState(null); // { voter_id, choice_id }[]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('tournament_votes')
      .select('voter_id, choice_id')
      .eq('category_id', categoryId)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) console.error('[VotePoll]', e.message);
        setVotes(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // A poll needs someone to choose between.
  if (!options || options.length < 2) return null;

  const optionIds = new Set(options.map((o) => o.id));
  const counted = (votes || []).filter((v) => optionIds.has(v.choice_id));
  const total = counted.length;
  const countBy = {};
  counted.forEach((v) => {
    countBy[v.choice_id] = (countBy[v.choice_id] || 0) + 1;
  });
  const myChoice = (votes || []).find((v) => v.voter_id === player?.id)?.choice_id || null;
  const myCounted = myChoice && optionIds.has(myChoice) ? myChoice : null;
  const canVote = open && player?.approval_status === 'approved';

  // A finished category: the option whose members all took first place.
  const winners = new Set(winnerIds);
  const winnerId =
    winners.size > 0 ? options.find((o) => o.memberIds.length > 0 && o.memberIds.every((m) => winners.has(m)))?.id : null;
  const guessed = winnerId ? countBy[winnerId] || 0 : 0;

  // While voting, rows keep the roster order (they would jump under the
  // finger otherwise); afterwards the favourite goes first.
  const rows = open ? options : [...options].sort((a, b) => (countBy[b.id] || 0) - (countBy[a.id] || 0));
  const leader = Math.max(0, ...options.map((o) => countBy[o.id] || 0));

  async function choose(optionId) {
    if (!canVote || busy) return;
    setError('');
    const before = votes || [];
    const takeBack = myChoice === optionId;
    const others = before.filter((v) => v.voter_id !== player.id);
    setVotes(takeBack ? others : [...others, { voter_id: player.id, choice_id: optionId }]);
    setBusy(true);
    const supabase = createClient();
    const { error: e } = takeBack
      ? await supabase.from('tournament_votes').delete().eq('category_id', categoryId).eq('voter_id', player.id)
      : await supabase
          .from('tournament_votes')
          .upsert(
            { category_id: categoryId, voter_id: player.id, choice_id: optionId, updated_at: new Date().toISOString() },
            { onConflict: 'category_id,voter_id' }
          );
    setBusy(false);
    if (e) {
      console.error('[VotePoll]', e.message);
      setVotes(before);
      setError('Не вдалося зберегти голос. Можливо, турнір уже почався.');
    }
  }

  let hint;
  if (open) {
    if (!player) hint = 'Увійдіть, щоб проголосувати';
    else if (player.approval_status !== 'approved') hint = 'Голосувати можуть підтверджені гравці';
    else if (myCounted) hint = 'Ваш голос враховано · змінити можна до старту турніру';
    else hint = 'Оберіть, хто, на вашу думку, виграє · переголосувати можна до старту';
  } else if (winnerId) {
    hint = total > 0 ? `Переможця вгадали ${guessed} з ${total}` : 'Голосів не було';
  } else {
    hint = 'Голосування закрито — турнір розпочато';
  }

  return (
    <section className={styles.card} aria-label="Голосування: хто виграє">
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <div className={styles.title}>Хто виграє?</div>
          {title && <div className={styles.sub}>{title}</div>}
        </div>
        <span className={styles.total}>
          {total} {votesWord(total)}
        </span>
      </div>

      <div className={styles.list}>
        {rows.map((o) => {
          const n = countBy[o.id] || 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myCounted === o.id;
          const isWinner = winnerId === o.id;
          const isLeader = !open && !winnerId && n > 0 && n === leader;
          return (
            <button
              key={o.id}
              type="button"
              className={`${styles.row} ${mine ? styles.rowMine : ''} ${isWinner ? styles.rowWinner : ''} ${
                canVote ? '' : styles.rowStatic
              }`}
              onClick={() => choose(o.id)}
              disabled={!canVote || busy}
              aria-pressed={mine}
            >
              <span className={styles.fill} style={{ width: `${votes === null ? 0 : pct}%` }} />
              <span className={styles.avatars}>
                {o.people.length > 0 ? (
                  o.people.map((p, i) => (
                    <span key={i} className={i > 0 ? styles.avatarOver : undefined}>
                      <PlayerAvatar player={p} size={28} />
                    </span>
                  ))
                ) : (
                  <PlayerAvatar player={null} size={28} />
                )}
              </span>
              <span className={styles.name}>
                {o.name}
                {isWinner && <span className={styles.badge}>🏆 Переможець</span>}
                {isLeader && <span className={styles.badgeSoft}>Фаворит</span>}
              </span>
              {mine && <span className={styles.check} aria-label="Ваш вибір">✓</span>}
              <span className={styles.pct}>{votes === null ? '' : `${pct}%`}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.hint}>{hint}</div>
      {error && <div className={styles.error}>{error}</div>}
    </section>
  );
}
