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

export default function ProfileTabs({ games, people, eloLog, history, partners, season, seasons = [], gender, userId, onOpenPartner, onOpenTournament }) {
  // Closed by default: three tiles; a tap opens that list in a sheet.
  const [tab, setTab] = useState(null);
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
  const avpKey = userId ? `avpbycat2:${userId}` : null;
  const [avpByCat, setAvpByCat] = useState(() => (avpKey && getCached(avpKey)) || null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    createClient()
      .from('avp_points')
      .select('category_id, points, season_id')
      .eq('user_id', userId)
      .then(({ data }) => {
        const m = {};
        const bySeason = {};
        (data || []).forEach((r) => {
          m[r.category_id] = (m[r.category_id] || 0) + (r.points || 0);
          if (r.season_id) bySeason[r.season_id] = (bySeason[r.season_id] || 0) + (r.points || 0);
        });
        const value = { byCat: m, bySeason };
        setCached(avpKey, value);
        if (alive) setAvpByCat(value);
      });
    return () => {
      alive = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The AVP place in each season shown in «Турніри» — among the same
  // gender, exactly like the AVP leaderboard. Loaded when the list opens.
  const seasonIds = (season ? [season] : seasons).map((x) => x.id).join(',');
  const [ranks, setRanks] = useState({});
  useEffect(() => {
    if (tab !== 'tournaments' || !userId || !seasonIds) return;
    let alive = true;
    const supabase = createClient();
    Promise.all([
      supabase.from('avp_standings').select('season_id, user_id, points').in('season_id', seasonIds.split(',')),
      gender ? supabase.from('users').select('id').eq('gender', gender) : Promise.resolve({ data: null }),
    ]).then(([{ data: st }, { data: same }]) => {
      const ids = same ? new Set(same.map((u) => u.id)) : null;
      const out = {};
      seasonIds.split(',').forEach((sid) => {
        const board = (st || [])
          .filter((r) => r.season_id === sid && (!ids || ids.has(r.user_id)))
          .sort((a, b) => b.points - a.points);
        const i = board.findIndex((r) => r.user_id === userId);
        out[sid] = { rank: i >= 0 ? i + 1 : null, field: board.length };
      });
      if (alive) setRanks(out);
    });
    return () => {
      alive = false;
    };
  }, [tab, userId, seasonIds, gender]);

  const wins = scopedGames.filter((g) => g.won).length;
  const losses = scopedGames.length - wins;
  const winPct = scopedGames.length ? Math.round((wins / scopedGames.length) * 100) : 0;
  const scopeName = season ? season.name : 'Весь час';

  const tabs = [
    { key: 'games', label: 'Ігри', count: scopedGames.length },
    { key: 'tournaments', label: 'Турніри', count: scopedHistory.length },
    { key: 'partners', label: 'Напарники', count: partners.length },
  ];

  const titles = { games: 'Ігри', tournaments: 'Турніри та AVP', partners: 'Напарники' };

  // The page behind the sheet must not scroll with it.
  useEffect(() => {
    if (!tab) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setTab(null);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [tab]);

  return (
    <>
      <section className={styles.tiles} aria-label="Ігри, турніри, напарники">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={styles.tileBtn} onClick={() => setTab(t.key)}>
            <span className={styles.tileN}>{t.count}</span>
            <span className={styles.tileL}>{t.key === 'tournaments' ? 'Турніри · AVP' : t.label}</span>
          </button>
        ))}
      </section>

      {tab && (
        <div className={styles.overlay} onClick={() => setTab(null)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titles[tab]}>
            <div className={styles.sheetHead}>
              <div>
                <div className={styles.sheetTitle}>{titles[tab]}</div>
                <div className={styles.sheetSub}>{scopeName}</div>
              </div>
              <button type="button" className={styles.close} onClick={() => setTab(null)} aria-label="Закрити">
                ✕
              </button>
            </div>
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
            <div className={styles.sheetBody}>
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
                      ? `${wins} ${plural(wins, 'перемога', 'перемоги', 'перемог')} · ${losses} ${plural(losses, 'поразка', 'поразки', 'поразок')} · ${winPct}%`
                      : null
                  }
                />
              )}
              {tab === 'tournaments' && (
                <Tournaments
                  history={scopedHistory}
                  games={games || []}
                  avp={avpByCat}
                  seasons={season ? [season] : seasons}
                  ranks={ranks}
                  onOpen={(id) => {
                    setTab(null);
                    onOpenTournament?.(id);
                  }}
                />
              )}
              {tab === 'partners' && (
                <Partners
                  partners={partners}
                  onOpen={(p) => {
                    setTab(null);
                    onOpenPartner?.(p);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
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

function Tournaments({ history, games, avp, seasons, ranks, onOpen }) {
  if (history.length === 0) return <div className={styles.empty}>Ще немає турнірів за цей період</div>;
  const byCat = avp?.byCat || null;

  // Grouped by season, each with its AVP total and place; tournaments
  // outside every known season go last.
  const groups = [];
  const rest = [];
  const seen = new Set();
  for (const s of seasons) {
    const list = history.filter((h) => !seen.has(h.category_id) && inSeason(h.scheduled_at, s));
    list.forEach((h) => seen.add(h.category_id));
    if (list.length > 0) groups.push({ season: s, list });
  }
  history.forEach((h) => !seen.has(h.category_id) && rest.push(h));
  if (rest.length > 0) groups.push({ season: null, list: rest });

  return (
    <div>
      {groups.map(({ season: s, list }) => {
        const pts = s ? avp?.bySeason?.[s.id] ?? (byCat ? 0 : null) : null;
        const r = s ? ranks?.[s.id] : null;
        return (
          <div key={s?.id || 'rest'} className={styles.seasonGroup}>
            <div className={styles.seasonHead}>
              <span className={styles.seasonName}>{s ? s.name : 'Поза сезонами'}</span>
              {s && (
                <span className={styles.seasonAvp}>
                  {pts != null && (
                    <>
                      <b>{pts}</b> AVP
                    </>
                  )}
                  {r?.rank ? ` · ${r.rank}-е місце${r.field ? ` з ${r.field}` : ''}` : ''}
                </span>
              )}
            </div>
            {list.map((h, i) => (
              <TournamentRow key={h.category_id} h={h} first={i === 0} games={games} byCat={byCat} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TournamentRow({ h, first, games, byCat, onOpen }) {
  const gs = games.filter((g) => g.category_id === h.category_id);
  const w = gs.filter((g) => g.won).length;
  const diff = gs.reduce((s, g) => s + ((g.pointsFor ?? 0) - (g.pointsAgainst ?? 0)), 0);
  const avp = byCat ? byCat[h.category_id] ?? 0 : null;
  const when = h.finished_at || h.scheduled_at;
  const placeCls = h.placement === 1 ? styles.p1 : h.placement === 2 ? styles.p2 : h.placement === 3 ? styles.p3 : styles.pN;
  return (
    <button type="button" className={`${styles.tr} ${first ? styles.trFirst : ''}`} onClick={() => onOpen?.(h.category_id)}>
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
