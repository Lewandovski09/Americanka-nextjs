'use client';

// «Сезон 26/27 · Сезон 25/26 · … · Весь час» — one switch for every
// season-dependent block of a player's page: tournament stats, AVP,
// partner table, tournament history and the Ело log. Opens on the
// current season. Seasons are the club's AVP track (the Ело track runs on
// the same dates); a block filters by the picked season's dates.

import { useClubSeasons } from '@/lib/seasons';

export const ALL_TIME = 'all';

/** The season list (newest first) and the current one, or null while loading. */
export function useProfileSeasons() {
  const club = useClubSeasons();
  if (!club) return null;
  const list = club.all.filter((s) => (s.kind || 'avp') === 'avp');
  return { list, current: club.avp };
}

export default function ProfileSeasonPicker({ seasons, value, onChange }) {
  if (!seasons || seasons.list.length === 0) return null;
  const chips = [
    ...seasons.list.map((s) => ({ key: s.id, label: s.ends_on === null ? `${s.name} · зараз` : s.name, value: s })),
    { key: ALL_TIME, label: 'Весь час', value: ALL_TIME },
  ];
  const selectedKey = value === ALL_TIME ? ALL_TIME : value?.id;
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 0 10px', scrollbarWidth: 'none' }}>
      {chips.map((c) => {
        const on = c.key === selectedKey;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.value)}
            aria-pressed={on}
            style={{
              flexShrink: 0,
              border: `1.5px solid ${on ? 'var(--navy)' : 'var(--border-light)'}`,
              background: on ? 'var(--navy)' : 'var(--surface)',
              color: on ? '#fff' : 'var(--text2)',
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
