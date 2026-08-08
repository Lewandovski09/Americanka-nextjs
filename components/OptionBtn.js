'use client';

// Was defined twice, identically, in tournaments/create/page.js and
// EventConfigForm.js — the two files already import the very same
// create.module.css, so this was a literal duplicate, not just a
// look-alike. One definition now, still taking `styles` as a prop
// (matching AvpTierPicker.js's existing convention) so it stays usable
// from a page with a different CSS module too, should one show up.
export default function OptionBtn({ active, onClick, children, styles }) {
  return (
    <button className={`${styles.optionBtn} ${active ? styles.optionBtnOn : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  );
}
