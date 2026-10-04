'use client';

// «Ігри · Турніри · Напарники» — one card with three tabs instead of the
// three collapsible lists (partners, tournament history, Ело log). Nothing
// of theirs is lost:
//   • Ігри — every game, grouped by day and tournament: win / loss, round
//     and court, your pair against theirs, the score, the average Ело of
//     both pairs at that moment, and the Ело change. Rating changes that
//     are not games (new season, admin correction) are in the feed too.
//   • Турніри — every tournament: place, games W–L, points difference,
//     Ело and AVP for it; a tap opens it.
//   • Напарники — the partner table: games together, W–L, win rate; a tap
//     opens your games together and against each other.
// Everything follows the season switch at the top of the page.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inSeason } from '@/lib/seasons';
import { loadEloLogDetails } from '@/lib/eloLogDetails';
import { stageLabel } from '@/lib/formats/stages';
import { getCached, setCached } from '@/lib/clientCache';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './ProfileTabs.module.css';

const KYIV = 'Europe/Kyiv';
const PAGE = 15;

const surname = (u) => u?.last_name?.trim() || u?.full_name || '—';
const day = (d) => new Date(d).toLocaleDateString('uk', { day: 'numeric', month: 'short', timeZone: KYIV });
const dayKey = (d) => new Date(d).toLocaleDateString('uk', { timeZone: KYIV });

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const avg = (list) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : null);

function pctColor(p) {
  if (p >= 70) return '#1d4ed8';
  if (p >= 55) return '#1ea672';
  if (p >= 40) return '#e9a23b';
  return '#dc2626';
}

export default function ProfileTabs({ games, people, eloLog, history, partners, season, userId, onOpenPartner, onOpenTournament }) {
  const [tab, setTab] = useState('games');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [season?.id]);

  const within = (when) => !season || inSeason(when, season);
  const scopedGames = useMemo(
    () => (games || []).filter((g) => within(g.played_at)).sort((a, b) => new Date(b.played_at) - new Date(a.played_at)),
    [games, season] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const scopedLog = (eloLog || []).filter((r) => within(r.created_at));
  const scopedHistory = (history || [])
    .filter((h) => within(h.scheduled_at))
    .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

  // Ело of each game (this player's row of the log) by match.
  const eloByMatch = useMemo(() => {
    const m = new Map();
    (eloLog || []).forEach((r) => r.match_id && m.set(r.match_id, r));
    return m;
  }, [eloLog]);
  const historyByCat = useMemo(() => new Map((history || []).map((h) => [h.category_id, h])), [history]);

  // Everyone's rating at each game (for the pairs' average Ело) — one
  // batch for the whole log, cached for the visit.
  const detailsKey = userId ? `elodetails:${userId}` : null;
  const logIds = (eloLog || []).map((r) => r.match_id).filter(Boolean).join(',');
  const [details, setDetails] = useState(() => (detailsKey && getCached(detailsKey)) || null);
  useEffect(() => {
    if (!userId || !logIds) return;
    const hit = getCached(detailsKey);
    if (hit && hit.ids === logIds) {
      setDetails(hit);
      return;
    }
    let alive = true;
    loadEloLogDetails(createClient(), userId, eloLog).then((byMatch) => {
      const value = { ids: logIds, byMatch };
      setCached(detailsKey, value);
      if (alive) setDetails(value);
    });
    return () => {
      alive = false;
    };
  }, [userId, logIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // AVP per tournament — one small request.
  const avpKey = userId ? `avpbycat:${userId}` : null;
  const [avpByCat, setAvpByCat] = useState(() => (avpKey && getCached(avpKey)) || null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    createClient()
      .from('avp_points')
      .select('category_id, points')
      .eq('user_id', userId)
      .then(({ data }) => {
        const m = {};
        (data || []).forEach((r) => {
          m[r.category_id] = (m[r.category_id] || 0) + (r.points || 0);
        });
        setCached(avpKey, m);
        if (alive) setAvpByCat(m);
      });
    return () => {
      alive = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wins = scopedGames.filter((g) => g.won).length;
  const losses = scopedGames.length - wins;
  const winPct = scopedGames.length ? Math.round((wins / scopedGames.length) * 100) : 0;
  const scopeName = season ? season.name : 'Весь час';

  const tabs = [
    { key: 'games', label: 'Ігри', count: scopedGames.length },
    { key: 'tournaments', label: 'Турніри', count: scopedHistory.length },
    { key: 'partners', label: 'Напарники', count: partners.length },
  ];

  return (
    <section className={styles.card}>
      <div className={styles.seg} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.segBtn} ${tab === t.key ? styles.segOn : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} · {t.count}
          </button>
        ))}
      </div>

      {tab === 'games' && (
        <GamesFeed
          games={scopedGames}
          log={scopedLog}
          shown={shown}
          onMore={() => setShown((n) => n + PAGE * 2)}
          people={people || {}}
          eloByMatch={eloByMatch}
          historyByCat={historyByCat}
          details={details?.byMatch || null}
          summary={
            scopedGames.length > 0
              ? `${scopeName} · ${wins} ${plural(wins, 'перемога', 'перемоги', 'перемог')} · ${losses} ${plural(losses, 'поразка', 'поразки', 'поразок')} · ${winPct}%`
              : null
          }
        />
      )}

      {tab === 'tournaments' && (
        <Tournaments history={scopedHistory} games={games || []} avpByCat={avpByCat} onOpen={onOpenTournament} />
      )}

      {tab === 'partners' && <Partners partners={partners} onOpen={onOpenPartner} />}
    </section>
  );
}

// ── Ігри ──────────────────────────────────────────────────────────

function GamesFeed({ games, log, shown, onMore, people, eloByMatch, historyByCat, details, summary }) {
  // Rating changes that are not games — kept in the feed so the old
  // «Журнал змін Ело» loses nothing.
  const extras = log
    .filter((r) => !r.match_id)
    .map((r) => ({ kind: 'adjust', at: r.created_at, row: r }));
  const items = [...games.map((g) => ({ kind: 'game', at: g.played_at, g })), ...extras].sort(
    (a, b) => new Date(b.at) - new Date(a.at)
  );
  if (items.length === 0) return <div className={styles.empty}>Ще немає ігор за цей період</div>;

  const visible = items.slice(0, shown);
  let lastGroup = null;

  return (
    <div>
      {summary && <div className={styles.summary}>{summary}</div>}
      {visible.map((it, i) => {
        let header = null;
        const groupKey = it.kind === 'game' ? `${dayKey(it.at)}|${it.g.category_id}` : `${dayKey(it.at)}|adj`;
        if (groupKey !== lastGroup) {
          lastGroup = groupKey;
          if (it.kind === 'game') {
            const h = historyByCat.get(it.g.category_id);
            const place = h?.placement ? ` · ${h.placement}-е місце` : '';
            header = (
              <div className={styles.dayH}>
                {day(it.at)} · {h?.tournament_name || 'Турнір'}
                {place}
              </div>
            );
          } else {
            header = <div className={styles.dayH}>{day(it.at)}</div>;
          }
        }

        if (it.kind === 'adjust') {
          const r = it.row;
          return (
            <div key={`a${r.id || i}`}>
              {header}
              <div className={styles.gm}>
                <div className={styles.gmTop}>
                  <span className={`${styles.res} ${styles.resN}`}>±</span>
                  <div className={styles.gmB}>
                    <div className={styles.gmT}>
                      {r.reason === 'season_reset' ? 'Новий сезон' : r.reason === 'admin_adjustment' ? 'Корекція адміном' : 'Зміна рейтингу'}
                    </div>
                    {r.elo_before != null && r.elo_after != null && (
                      <div className={styles.gmM}>
                        {r.elo_before} → {r.elo_after}
                      </div>
                    )}
                  </div>
                  <div className={styles.gmD}>
                    <span className={r.delta >= 0 ? styles.plus : styles.minus}>
                      {r.delta >= 0 ? '+' : ''}
                      {r.delta}
                    </span>
                    <span className={styles.gmDL}>Ело</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        const g = it.g;
        const e = eloByMatch.get(g.match_id);
        const d = details?.[g.match_id];
        const mineAvg = avg([e?.elo_before, ...(d?.partners || []).map((p) => p.elo)].filter((v) => v != null));
        const theirAvg = d?.opponentsAvg ?? avg((d?.opponents || []).map((p) => p.elo).filter((v) => v != null));
        const where = [
          g.stage && !/^\d+$/.test(g.stage) ? stageLabel(g.stage) : g.round ? `Раунд ${g.round}` : null,
          g.court ? `корт ${g.court}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const partnerNames = g.partners.map((id) => surname(people[id])).join(', ');
        const oppNames = g.opponents.map((id) => surname(people[id])).join(' / ');
        return (
          <div key={g.match_id || i}>
            {header}
            <div className={styles.gm}>
              <div className={styles.gmTop}>
                <span className={`${styles.res} ${g.won ? styles.resW : styles.resL}`}>{g.won ? 'W' : 'L'}</span>
                <div className={styles.gmB}>
                  <div className={styles.gmT}>{g.won ? 'Перемога' : 'Поразка'}</div>
                  {where && <div className={styles.gmM}>{where}</div>}
                </div>
                {e && (
                  <div className={styles.gmD}>
                    <span className={e.delta >= 0 ? styles.plus : styles.minus}>
                      {e.delta >= 0 ? '+' : ''}
                      {e.delta}
                    </span>
                    <span className={styles.gmDL}>
                      {e.elo_before != null && e.elo_after != null ? `${e.elo_before} → ${e.elo_after}` : 'Ело'}
                    </span>
                  </div>
                )}
              </div>
              <div className={styles.vs}>
                <div className={`${styles.side} ${styles.sideMine}`}>
                  {partnerNames ? `Ти + ${partnerNames}` : 'Ти'}
                  {mineAvg != null && <small>сер. Ело {mineAvg}</small>}
                </div>
                <div className={styles.sc}>{g.score || '—'}</div>
                <div className={styles.side}>
                  {oppNames || '—'}
                  {theirAvg != null && <small>сер. Ело {theirAvg}</small>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {items.length > shown && (
        <button type="button" className={styles.more} onClick={onMore}>
          Ще {items.length - shown} →
        </button>
      )}
    </div>
  );
}

// ── Турніри ───────────────────────────────────────────────────────

function Tournaments({ history, games, avpByCat, onOpen }) {
  if (history.length === 0) return <div className={styles.empty}>Ще немає турнірів за цей період</div>;
  return (
    <div>
      {history.map((h, i) => {
        const gs = games.filter((g) => g.category_id === h.category_id);
        const w = gs.filter((g) => g.won).length;
        const diff = gs.reduce((s, g) => s + ((g.pointsFor ?? 0) - (g.pointsAgainst ?? 0)), 0);
        const avp = avpByCat ? avpByCat[h.category_id] ?? 0 : null;
        const when = h.finished_at || h.scheduled_at;
        const placeCls = h.placement === 1 ? styles.p1 : h.placement === 2 ? styles.p2 : h.placement === 3 ? styles.p3 : styles.pN;
        return (
          <button
            key={h.category_id}
            type="button"
            className={`${styles.tr} ${i === 0 ? styles.trFirst : ''}`}
            onClick={() => onOpen?.(h.category_id)}
          >
            <span className={styles.trD}>
              <b>{when ? new Date(when).toLocaleDateString('uk', { day: 'numeric', timeZone: KYIV }) : '—'}</b>
              {when ? new Date(when).toLocaleDateString('uk', { month: 'short', timeZone: KYIV }) : ''}
            </span>
            <span className={`${styles.place} ${placeCls}`}>{h.placement || '…'}</span>
            <span className={styles.trB}>
              <span className={styles.trN}>
                {h.tournament_name || 'Турнір'}
                {h.category ? ` · Кат. ${h.category}` : ''}
              </span>
              <span className={styles.trM}>
                {gs.length > 0
                  ? `${gs.length} ${plural(gs.length, 'гра', 'гри', 'ігор')} · ${w}–${gs.length - w} · ${diff >= 0 ? '+' : ''}${diff} ${plural(Math.abs(diff), 'очко', 'очки', 'очок')}`
                  : h.status === 'done'
                  ? 'без ігор'
                  : 'ще не зіграно'}
                {!h.placement && h.status !== 'done' ? ' · в процесі' : ''}
              </span>
            </span>
            <span className={styles.trS}>
              {h.elo_delta != null && (
                <span>
                  <b className={h.elo_delta >= 0 ? styles.plus : styles.minus}>
                    {h.elo_delta >= 0 ? '+' : ''}
                    {h.elo_delta}
                  </b>{' '}
                  Ело
                </span>
              )}
              {avp != null && (
                <span>
                  <b className={avp > 0 ? styles.avp : ''}>{avp > 0 ? `+${avp}` : 0}</b> AVP
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Напарники ─────────────────────────────────────────────────────

function Partners({ partners, onOpen }) {
  if (partners.length === 0) return <div className={styles.empty}>Ще немає ігор з напарниками за цей період</div>;
  return (
    <table className={styles.pt}>
      <thead>
        <tr>
          <th>Напарник</th>
          <th>Ігри</th>
          <th>W–L</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        {partners.map((p) => {
          const pct = p.games_together ? Math.round((p.wins_together / p.games_together) * 100) : 0;
          return (
            <tr key={p.partner_id} onClick={() => onOpen?.(p.partner)} className={styles.ptRow}>
              <td>
                <span className={styles.ptName}>
                  <PlayerAvatar player={p.partner} size={26} />
                  <span>{p.partner.full_name}</span>
                </span>
              </td>
              <td>{p.games_together}</td>
              <td>
                {p.wins_together}–{p.games_together - p.wins_together}
              </td>
              <td>
                <span className={styles.pct} style={{ background: pctColor(pct) }}>
                  {pct}%
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
