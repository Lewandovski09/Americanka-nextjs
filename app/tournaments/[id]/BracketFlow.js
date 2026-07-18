'use client';

// «Сітка v2» — the bracket drawn exactly like the club's paper sheet
// («Сітка» page of the Excel bracket): the upper bracket flows left to
// right (I → II → III → IV прохід), the lower bracket flows right to
// left (за 17-24 → … → за 5-6), and the two meet in the middle column —
// semifinal on top, final + 3rd-place match in the center, the other
// semifinal below. Undecided slots carry the paper's W№ / L№ marks and
// winner-lines join the boxes.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { aggregateScore, teamAWon } from '@/lib/formats/sets';
import { stageLabel, stageWeight } from '@/lib/formats/stages';
import styles from './detail.module.css';

const deNum = (s) => Number(/^(?:wb|lb)(\d+)$/.exec(s)?.[1] || 0);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// Vertical order inside every column comes from the graph, processed
// from the center outwards: a match sits at the position of the match
// its winner feeds (slot a above slot b), so feeders stay adjacent and
// the lines don't cross. `orderIdx` carries positions across columns.
function orderLane(cols, orderIdx) {
  for (let i = cols.length - 1; i >= 0; i--) {
    const key = (m) => {
      const t = m.winner_to_match_id;
      const base = t != null && orderIdx[t] != null ? orderIdx[t] : 900;
      return base * 2 + (m.winner_to_slot === 'b' ? 1 : 0);
    };
    cols[i] = cols[i]
      .map((m, di) => ({ m, di }))
      .sort((x, y) => key(x.m) - key(y.m) || x.di - y.di)
      .map((x) => x.m);
    cols[i].forEach((m, pos) => {
      orderIdx[m.id] = pos;
    });
  }
  return cols;
}

export default function BracketFlow({ matches, nameOf, numberOf, openScore, canEdit }) {
  const flow = matches.filter((m) => m.stage && m.stage !== 'group' && !/^kr\d+$/.test(m.stage));

  const canvasRef = useRef(null);
  const boxRefs = useRef({});
  const [paths, setPaths] = useState([]);

  // Winner-lines: right-angle elbows like the paper. The exit side
  // follows the flow direction (the lower bracket travels leftwards);
  // stacked boxes (semifinal → final) connect vertically.
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = canvas.getBoundingClientRect();
    const out = [];
    for (const m of flow) {
      if (!m.winner_to_match_id) continue;
      const a = boxRefs.current[m.id];
      const b = boxRefs.current[m.winner_to_match_id];
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      let d;
      if (overlapX > Math.min(ra.width, rb.width) / 2) {
        // Same column (semifinal → final / 3rd place): vertical elbow.
        const x1 = ra.left + ra.width / 2 - root.left;
        const x2 = rb.left + rb.width / 2 - root.left;
        const down = rb.top >= ra.bottom;
        const y1 = (down ? ra.bottom : ra.top) - root.top;
        const y2 = (down ? rb.top : rb.bottom) - root.top;
        const ym = (y1 + y2) / 2;
        d = `M ${x1} ${y1} V ${ym} H ${x2} V ${y2}`;
      } else {
        const toRight = rb.left + rb.width / 2 >= ra.left + ra.width / 2;
        const x1 = (toRight ? ra.right : ra.left) - root.left;
        const x2 = (toRight ? rb.left : rb.right) - root.left;
        const y1 = ra.top + ra.height / 2 - root.top;
        const y2 = rb.top + rb.height / 2 - root.top;
        const xm = (x1 + x2) / 2;
        d = `M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`;
      }
      out.push({ d, active: m.played });
    }
    setPaths(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  if (flow.length === 0) return <div className={styles.loading}>Сітки немає</div>;

  // The paper's W№ / L№ marks for slots whose team isn't known yet.
  const srcOf = {};
  for (const m of flow) {
    if (m.winner_to_match_id && m.winner_to_slot) {
      srcOf[`${m.winner_to_match_id}:${m.winner_to_slot}`] = { win: true, id: m.id };
    }
    if (m.loser_to_match_id && m.loser_to_slot) {
      srcOf[`${m.loser_to_match_id}:${m.loser_to_slot}`] = { win: false, id: m.id };
    }
  }
  const hint = (m, slot) => {
    const s = srcOf[`${m.id}:${slot}`];
    if (!s) return '· · ·';
    const n = numberOf[s.id];
    return n ? `${s.win ? 'W' : 'L'}${n}` : '· · ·';
  };

  const byStage = new Map();
  for (const m of flow) {
    const list = byStage.get(m.stage) || [];
    list.push(m);
    byStage.set(m.stage, list);
  }
  for (const list of byStage.values()) {
    list.sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
  }
  const stages = [...byStage.keys()];
  const isDE = stages.some((s) => /^(wb|lb)\d+$/.test(s));

  const cardProps = (m, label) => ({
    m,
    innerRef: (el) => {
      boxRefs.current[m.id] = el;
    },
    num: numberOf[m.id],
    label,
    nameOf,
    hintA: hint(m, 'a'),
    hintB: hint(m, 'b'),
    openScore,
    editable: canEdit(m),
  });

  const column = (key, title, ms, labelOf) => (
    <div key={key} className={styles.flowCol}>
      <div className={styles.flowColTitle}>{title}</div>
      <div className={styles.flowColSlots}>
        {ms.map((m) => (
          <div key={m.id} className={styles.flowSlot}>
            <FlowCard {...cardProps(m, labelOf ? labelOf(m) : null)} />
          </div>
        ))}
      </div>
    </div>
  );

  const hasGroups = matches.some((m) => (m.stage || 'group') === 'group');

  let body;
  if (isDE) {
    // ── The paper's mirror layout ──
    const wbStages = stages.filter((s) => /^wb\d+$/.test(s)).sort((a, b) => deNum(a) - deNum(b));
    const lbStages = stages.filter((s) => /^lb\d+$/.test(s)).sort((a, b) => deNum(a) - deNum(b));
    const sf = [...(byStage.get('sf') || [])];
    const final = byStage.get('final')?.[0] || byStage.get('gf')?.[0] || null;
    const p34 = byStage.get('p3_4')?.[0] || null;

    // Semifinal feeding the final's slot a goes on top.
    sf.sort(
      (a, b) => (a.winner_to_slot === 'b' ? 1 : 0) - (b.winner_to_slot === 'b' ? 1 : 0)
    );
    const orderIdx = {};
    if (final) orderIdx[final.id] = 0;
    sf.forEach((m, i) => {
      orderIdx[m.id] = i;
    });
    const wbCols = orderLane(wbStages.map((s) => [...byStage.get(s)]), orderIdx);
    const lbCols = orderLane(lbStages.map((s) => [...byStage.get(s)]), orderIdx);

    // Lower-bracket column titles are the places its losers share,
    // exactly how the paper heads them («за 17-24», «за 9-12», …).
    const lbTitles = [];
    let place = final && p34 ? 5 : 3;
    for (let i = lbCols.length - 1; i >= 0; i--) {
      const losers = lbCols[i].length;
      lbTitles[i] = `За ${place}-${place + losers - 1}`;
      place += losers;
    }

    body = (
      <div className={styles.flowMirror}>
        {wbCols.map((ms, i) => column(wbStages[i], `${ROMAN[i] || i + 1} прохід`, ms))}
        <div className={styles.flowCol}>
          <div className={styles.flowColTitle} />
          <div className={styles.flowColSlots}>
            {sf[0] && (
              <div className={styles.flowSlot}>
                <FlowCard {...cardProps(sf[0], 'Півфінал')} />
              </div>
            )}
            <div className={`${styles.flowSlot} ${styles.flowCenterMid}`}>
              {final && <FlowCard {...cardProps(final, final.stage === 'gf' ? 'Гранд-фінал' : 'Фінал')} />}
              {p34 && <FlowCard {...cardProps(p34, '3/4 місце')} />}
            </div>
            {sf[1] && (
              <div className={styles.flowSlot}>
                <FlowCard {...cardProps(sf[1], 'Півфінал')} />
              </div>
            )}
          </div>
        </div>
        {[...lbCols]
          .map((ms, i) => ({ ms, i }))
          .reverse()
          .map(({ ms, i }) => column(lbStages[i], lbTitles[i], ms))}
      </div>
    );
  } else {
    // Other knockout formats: a single left-to-right lane.
    const ordered = [...stages].sort((a, b) => stageWeight(a) - stageWeight(b));
    const places = ordered.filter((s) => /^p\d+_\d+$/.test(s));
    const cols = ordered
      .filter((s) => !places.includes(s))
      .map((s) => ({ key: s, title: stageLabel(s), matches: [...byStage.get(s)] }));
    if (places.length) {
      cols.push({
        key: 'places',
        title: 'Матчі за місця',
        matches: places.flatMap((s) => byStage.get(s)),
        withLabels: true,
      });
    }
    const orderIdx = {};
    const laneCols = orderLane(cols.map((c) => c.matches), orderIdx);
    body = (
      <div className={styles.flowMirror}>
        {cols.map((c, i) =>
          column(c.key, c.title, laneCols[i], c.withLabels ? (m) => stageLabel(m.stage) : null)
        )}
      </div>
    );
  }

  return (
    <div className={styles.flowWrap}>
      <div className={styles.flowCanvas} ref={canvasRef}>
        <svg className={styles.flowSvg}>
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke={p.active ? 'var(--navy)' : 'var(--border-light)'}
              strokeWidth={p.active ? 2 : 1.5}
            />
          ))}
        </svg>
        {body}
      </div>
      {hasGroups && <div className={styles.flowNote}>Груповий етап — у класичній сітці</div>}
    </div>
  );
}

// One box: game number badge, both sides with scores, winner in bold.
// Clicking behaves exactly like the classic view.
function FlowCard({ m, innerRef, num, label, nameOf, hintA, hintB, openScore, editable }) {
  const agg = aggregateScore(m);
  const aWon = m.played && teamAWon(m);
  const walkover = m.played && !(m.team_b_players?.length > 0);
  const nameA = nameOf(m.team_a_players);
  const nameB = nameOf(m.team_b_players);
  const ready = m.team_a_players?.length > 0 && m.team_b_players?.length > 0;
  const clickable = (!m.played && ready) || editable;
  const future = !m.played && !ready;
  return (
    <div
      ref={innerRef}
      className={`${styles.bracketCard} ${styles.flowCard} ${clickable ? styles.bracketCardPending : ''} ${
        future ? styles.cardFuture : ''
      }`}
      onClick={() => clickable && openScore(m, nameA, nameB)}
    >
      {num != null && <span className={styles.flowNum}>{num}</span>}
      {editable && <span className={styles.editIcon}>✎</span>}
      {label && <div className={styles.bracketCardLabel}>{label}</div>}
      <div className={`${styles.bracketSide} ${aWon ? styles.bracketWinner : ''}`}>
        {nameA ? (
          <span className={styles.bracketName}>{nameA}</span>
        ) : (
          <span className={styles.flowHint}>{hintA}</span>
        )}
        <span className={styles.bracketScore}>{agg ? agg[0] : ''}</span>
      </div>
      <div className={`${styles.bracketSide} ${m.played && !aWon ? styles.bracketWinner : ''}`}>
        {walkover ? (
          <span className={styles.bracketName}>прохід</span>
        ) : nameB ? (
          <span className={styles.bracketName}>{nameB}</span>
        ) : (
          <span className={styles.flowHint}>{hintB}</span>
        )}
        <span className={styles.bracketScore}>{agg ? agg[1] : ''}</span>
      </div>
    </div>
  );
}
