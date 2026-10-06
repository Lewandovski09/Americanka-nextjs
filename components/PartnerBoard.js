'use client';

// «Шукаю пару» — partner-search notices of one category (migration 051).
// Pair formats only («Чоловічі / Жіночі», «Мікс»), and only before the
// category starts. A player without a partner posts a notice (with an
// optional note); others contact them in Telegram or — on the
// registration page — file an application together with them right
// from the notice. A notice disappears as soon as its author has a pair.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './PartnerBoard.module.css';
import { appConfirm } from '@/components/AppDialog';

const NOTE_MAX = 200;

/** What the author of a notice is looking for, in words. */
export function seekingLabel(gender, isMix) {
  if (gender === 'M') return isMix ? 'Шукає напарницю' : 'Шукає напарника';
  if (gender === 'F') return isMix ? 'Шукає напарника' : 'Шукає напарницю';
  return 'Шукає пару';
}

/** Posts (or replaces) my notice in a category. */
export async function postPartnerAd(categoryId, userId, note) {
  const supabase = createClient();
  const clean = (note || '').trim().slice(0, NOTE_MAX) || null;
  const { error } = await supabase
    .from('partner_ads')
    .upsert(
      { category_id: categoryId, user_id: userId, note: clean, updated_at: new Date().toISOString() },
      { onConflict: 'category_id,user_id' }
    );
  if (error) console.error('[partner_ads]', error.message);
  return !error;
}

/**
 * @param {{
 *   categoryId: string,
 *   isMix: boolean,              // «Мікс» (any gender may post) vs men's / women's
 *   categoryGender?: 'M'|'F'|null,
 *   open: boolean,               // category still before its start
 *   pairedIds?: string[],        // players who already have a partner — their notices are hidden
 *   appliedIds?: string[],       // players with an application of their own (alone)
 *   canJoin?: boolean,           // the viewer may still apply (no application yet)
 *   onJoin?: (ad) => Promise<boolean>, // apply together with the notice's author
 *   registerHref?: string,       // where to apply, when onJoin is not available here
 *   version?: number,            // bump to reload
 * }} props
 */
export default function PartnerBoard({
  categoryId,
  isMix,
  categoryGender = null,
  open,
  pairedIds = [],
  appliedIds = [],
  canJoin = false,
  onJoin,
  registerHref,
  version = 0,
}) {
  const { player } = useCurrentPlayer();
  const [ads, setAds] = useState(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!categoryId || !open) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('partner_ads')
      .select('user_id, note, created_at, users(id, full_name, last_name, photo_url, gender, elo, telegram_username)')
      .eq('category_id', categoryId)
      .order('created_at', { ascending: true })
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) console.error('[PartnerBoard]', e.message);
        setAds(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, open, version, reload]);

  if (!open) return null;

  const paired = new Set(pairedIds);
  const applied = new Set(appliedIds);
  // A men's league shows only men, a women's league only women — a
  // notice from the other gender (posted before a gender change, say)
  // does not belong here.
  const visible = (ads || []).filter(
    (a) => a.users && !paired.has(a.user_id) && (isMix || !categoryGender || a.users.gender === categoryGender)
  );
  const mine = visible.find((a) => a.user_id === player?.id) || null;
  const others = visible.filter((a) => a.user_id !== player?.id);

  const approved = player?.approval_status === 'approved';
  const genderFits = isMix || !categoryGender || player?.gender === categoryGender;
  const canPost = approved && genderFits && !paired.has(player?.id);

  async function save() {
    setBusy(true);
    setError('');
    const ok = await postPartnerAd(categoryId, player.id, note);
    setBusy(false);
    if (!ok) {
      setError('Не вдалося зберегти оголошення');
      return;
    }
    setEditing(false);
    setReload((n) => n + 1);
  }

  async function remove() {
    if (!(await appConfirm('Зняти оголошення?', { okText: 'Зняти' }))) return;
    setBusy(true);
    const supabase = createClient();
    const { error: e } = await supabase
      .from('partner_ads')
      .delete()
      .eq('category_id', categoryId)
      .eq('user_id', player.id);
    setBusy(false);
    if (e) {
      setError('Не вдалося зняти оголошення');
      return;
    }
    setReload((n) => n + 1);
  }

  async function join(ad) {
    const name = ad.users?.full_name || 'цим гравцем';
    if (!(await appConfirm(`Подати заявку в парі з ${name}?`, { okText: 'Подати' }))) return;
    setBusy(true);
    const ok = await onJoin(ad);
    setBusy(false);
    if (ok) setReload((n) => n + 1);
  }

  function startEdit() {
    setNote(mine?.note || '');
    setEditing(true);
    setError('');
  }

  // Who the viewer could pair with: in a mix — the other gender; in a
  // men's / women's league everyone here is already the right gender.
  const fitsMe = (u) =>
    isMix
      ? !!(u.gender && player?.gender && u.gender !== player.gender)
      : !!player?.gender && (!categoryGender || player.gender === categoryGender) && u.gender === player.gender;

  return (
    <section className={styles.card} aria-label="Шукаю пару">
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Шукаю пару</div>
          <div className={styles.sub}>
            {isMix ? 'Гравці без пари — напишіть їм або подайте заявку разом' : 'Гравці без напарника — напишіть їм або подайте заявку разом'}
          </div>
        </div>
        <span className={styles.count}>{ads === null ? '…' : visible.length}</span>
      </div>

      {/* My notice / the form */}
      {editing ? (
        <div className={styles.form}>
          <textarea
            className={styles.textarea}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder="Кілька слів про себе (необов’язково): рівень, позиція, коли можете тренуватись…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className={styles.formRow}>
            <span className={styles.counter}>
              {note.length}/{NOTE_MAX}
            </span>
            <button type="button" className={styles.btnGhost} onClick={() => setEditing(false)} disabled={busy}>
              Скасувати
            </button>
            <button type="button" className={styles.btnPrimary} onClick={save} disabled={busy}>
              {mine ? 'Зберегти' : 'Опублікувати'}
            </button>
          </div>
        </div>
      ) : mine ? (
        <div className={`${styles.ad} ${styles.adMine}`}>
          <PlayerAvatar player={mine.users} size={36} />
          <div className={styles.adBody}>
            <div className={styles.adName}>
              Ваше оголошення <span className={styles.tag}>{seekingLabel(mine.users.gender, isMix)}</span>
            </div>
            {mine.note && <div className={styles.note}>{mine.note}</div>}
            <div className={styles.actions}>
              <button type="button" className={styles.btnLink} onClick={startEdit} disabled={busy}>
                Змінити
              </button>
              <button type="button" className={styles.btnLink} onClick={remove} disabled={busy}>
                Зняти
              </button>
            </div>
          </div>
        </div>
      ) : (
        canPost && (
          <button type="button" className={styles.postBtn} onClick={startEdit}>
            ＋ {isMix ? (player?.gender === 'M' ? 'Шукаю напарницю' : 'Шукаю напарника') : player?.gender === 'F' ? 'Шукаю напарницю' : 'Шукаю напарника'}
          </button>
        )
      )}

      {/* Everyone else */}
      {ads !== null && others.length === 0 && !mine && !editing && (
        <div className={styles.empty}>Поки ніхто не шукає пару в цій лізі.</div>
      )}
      <div className={styles.list}>
        {others.map((a) => {
          const u = a.users;
          return (
            <div key={a.user_id} className={styles.ad}>
              <Link href={`/players/${u.id}`} className={styles.avatarLink}>
                <PlayerAvatar player={u} size={36} />
              </Link>
              <div className={styles.adBody}>
                <div className={styles.adName}>
                  <Link href={`/players/${u.id}`} className={styles.nameLink}>
                    {u.full_name}
                  </Link>
                  {u.elo != null && <span className={styles.elo}>{u.elo}</span>}
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.tag}>{seekingLabel(u.gender, isMix)}</span>
                  {applied.has(u.id) && <span className={styles.tagSoft}>заявку подано</span>}
                </div>
                {a.note && <div className={styles.note}>{a.note}</div>}
                <div className={styles.actions}>
                  {u.telegram_username && (
                    <a
                      className={styles.btnLink}
                      href={`https://t.me/${u.telegram_username}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Написати в Telegram
                    </a>
                  )}
                  {onJoin && canJoin && approved && fitsMe(u) && (
                    <button type="button" className={styles.btnJoin} onClick={() => join(a)} disabled={busy}>
                      Зіграти разом
                    </button>
                  )}
                  {!onJoin && registerHref && approved && fitsMe(u) && (
                    <Link className={styles.btnLink} href={registerHref}>
                      Подати заявку →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </section>
  );
}
