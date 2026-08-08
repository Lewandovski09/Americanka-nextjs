'use client';

// Was defined twice, identically, in tournaments/page.js and
// tournaments/[id]/page.js — a fix to one copy (like the aria-pressed
// addition) had no effect on the other until someone noticed and
// duplicated it by hand. One definition now; each page still supplies
// its OWN CSS module via the `styles` prop, since tournaments.module.css
// and detail.module.css each define `.tabBtn`/`.tabBtnOn` with their own
// visual styling for their own context (this mirrors how
// AvpTierPicker.js already takes a `styles` prop for the same reason).
export default function TabBtn({ active, onClick, children, styles }) {
  return (
    <button className={`${styles.tabBtn} ${active ? styles.tabBtnOn : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  );
}
