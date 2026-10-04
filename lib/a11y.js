// Keyboard and screen-reader support for things that are clicked but are
// not <button>s — a schedule row, a bracket card, a list suggestion.
// Spread next to the existing onClick:
//
//   <tr onClick={open} {...pressable(open, clickable)}>
//
// It makes the element focusable (Tab), announces it as a button and
// runs the same action on Enter / Space. Key presses that come from a
// child (a cell with its own action inside a row) are left to the child.
export function pressable(onPress, enabled = true) {
  if (!enabled || typeof onPress !== 'function') return {};
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress(e);
      }
    },
  };
}
