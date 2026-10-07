'use client';

// «Оплата» tab — the admin's own checklist of who has paid the entry fee
// (migration 072). Every player of the event, league by league; one tap
// marks or unmarks. Per event, so a player moved to another league keeps
// the mark. Players never see it. On both settings pages — before the
// start (/events/settings) and on the day (/tournaments/settings).

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import PlayerAvatar from '@/components/PlayerAvatar';
import { feeLabel } from '@/lib/registrationWindow';
import { paymentGroups } from '@/lib/paymentGroups';
import styles from './event.module.css';
import own from './PaymentsTab.module.css';

export default function PaymentsTab({ event, categories, isPair }) {
  const [paid, setPaid] = useState(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [saving, setSaving] = useState(() => new Set());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await createClient().from('tournament_payments').select('user_id').eq('event_id', event.id);
    if (e) setMissing(true);
    setPaid(new Set((data || []).map((r) => r.user_id)));
    setLoaded(true);
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(userId) {
    const next = !paid.has(userId);
    setError('');
    // optimistic — the tick moves at once, a failure puts it back
    setPaid((s) => {
      const n = new Set(s);
      next ? n.add(userId) : n.delete(userId);
      return n;
    });
    setSaving((s) => new Set(s).add(userId));
    const res = await fetch(`/api/events/${event.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, paid: next }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSaving((s) => {
      const n = new Set(s);
      n.delete(userId);
      return n;
    });
    if (!data?.success) {
      setError(data?.error || 'Не вдалося зберегти — перевірте інтернет');
      setPaid((s) => {
        const n = new Set(s);
        next ? n.delete(userId) : n.add(userId);
        return n;
      });
    }
  }

  const groups = paymentGroups(categories, isPair);
  const everyone = [...new Set(groups.flatMap((g) => g.units.flat().map((p) => p.id)))];
  const paidCount = everyone.filter((id) => paid.has(id)).length;
  const fee = Number(event.entry_fee) || 0;
  const money = (n) => `${(n * fee).toLocaleString('uk').replace(/\s/g, ' ')} грн`;

  if (missing) {
    return (
      <div className={styles.panel}>
        <div className={styles.hint}>Щоб відмічати оплату, виконайте в Supabase SQL 072 (tournament_payments).</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.hint}>
        Ваша особиста відмітка, хто сплатив внесок{feeLabel(event.entry_fee) ? ` (${feeLabel(event.entry_fee)})` : ''}. Гравці її не бачать.
      </div>

      <div className={own.summary}>
        <div>
          <div className={own.big}>
            {paidCount} <span>з {everyone.length}</span>
          </div>
          <div className={own.small}>оплатили</div>
        </div>
        {fee > 0 && (
          <div className={own.money}>
            <div className={own.big}>{money(paidCount)}</div>
            <div className={own.small}>з {money(everyone.length)}</div>
          </div>
        )}
      </div>
      {everyone.length > 0 && (
        <div className={own.bar}>
          <div className={own.fill} style={{ width: `${Math.round((paidCount / everyone.length) * 100)}%` }} />
        </div>
      )}

      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} />
        <span>Показати лише тих, хто ще не сплатив</span>
      </label>

      {error && <div className={styles.errMsg}>{error}</div>}
      {!loaded && <div className={styles.empty}>Завантаження...</div>}
      {loaded && groups.length === 0 && <div className={styles.empty}>У лігах ще нікого немає</div>}

      {loaded &&
        groups.map((g) => {
          const units = onlyUnpaid ? g.units.filter((u) => u.some((p) => !paid.has(p.id))) : g.units;
          if (units.length === 0) return null;
          const n = g.units.flat().length;
          const k = g.units.flat().filter((p) => paid.has(p.id)).length;
          return (
            <div key={g.id} className={own.group}>
              <div className={own.groupHead}>
                <span>{g.label}</span>
                <span className={k === n ? own.allPaid : own.count}>
                  {k}/{n}
                </span>
              </div>
              {units.map((u) => (
                <div key={u.map((p) => p.id).join('+')} className={`${own.unit} ${u.length > 1 ? own.pair : ''}`}>
                  {u.map((p) => {
                    const on = paid.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`${own.row} ${on ? own.rowOn : ''}`}
                        onClick={() => toggle(p.id)}
                        disabled={saving.has(p.id)}
                        aria-pressed={on}
                      >
                        <span className={`${own.box} ${on ? own.boxOn : ''}`} aria-hidden="true">
                          {on ? '✓' : ''}
                        </span>
                        <PlayerAvatar player={p} size={24} />
                        <span className={own.name}>{p.full_name || '—'}</span>
                        <span className={on ? own.tagOn : own.tag}>{on ? 'Сплачено' : 'Не сплачено'}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
    </div>
  );
}
