'use client';

import { useMemo, useState } from 'react';
import { UA_CITIES } from '@/lib/uaCities';
import styles from './CityPicker.module.css';

// Searchable dropdown over the full list of Ukrainian cities. Typing
// filters the list (prefix matches first); a city can only be picked
// from the list, so the stored value is always a canonical name.
// `inputClassName` lets each page keep its own input styling.
export default function CityPicker({ value, onChange, inputClassName, placeholder = 'Почніть вводити місто…' }) {
  const [query, setQuery] = useState(null); // null → input shows the picked value
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return UA_CITIES.slice(0, 30);
    const starts = [];
    const contains = [];
    for (const city of UA_CITIES) {
      const lc = city.toLowerCase();
      if (lc.startsWith(q)) starts.push(city);
      else if (lc.includes(q)) contains.push(city);
    }
    return [...starts, ...contains].slice(0, 30);
  }, [query]);

  function pick(city) {
    onChange(city);
    setQuery(null);
    setOpen(false);
  }

  return (
    <div className={styles.wrap}>
      <input
        className={inputClassName}
        value={query ?? value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a list item lands before the list closes;
        // unconfirmed typed text reverts to the picked value.
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setQuery(null);
          }, 150)
        }
      />
      {open && (
        <div className={styles.dropdown}>
          {matches.length === 0 && <div className={styles.emptyRow}>Місто не знайдено</div>}
          {matches.map((city) => (
            <div
              key={city}
              className={`${styles.row} ${city === value ? styles.rowOn : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(city)}
            >
              {city}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
