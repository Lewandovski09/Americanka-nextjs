// Shared inline-SVG icon set. Replaces emoji glyphs across the app —
// emoji render inconsistently across OS/browser and read as a
// prototype, not a finished product. All icons take `size` and
// `color` (defaults to currentColor so they inherit text color).

function base(children, { size = 18, color = 'currentColor', strokeWidth = 2 } = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function IconBell(props) {
  return base(
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 3.5 1.2 5 2 6H4c.8-1 2-2.5 2-6Z" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
    </>,
    props
  );
}

export function IconMapPin(props) {
  return base(
    <>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </>,
    props
  );
}

export function IconVolleyball(props) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3c-5 4-5 14 0 18" />
      <path d="M12 3c5 4 5 14 0 18" />
    </>,
    props
  );
}

export function IconMegaphone(props) {
  return base(
    <>
      <path d="M3 11v2a2 2 0 0 0 2 2h1l8 4V5L6 9H5a2 2 0 0 0-2 2Z" />
      <path d="M17 9.5a3.5 3.5 0 0 1 0 5" />
    </>,
    props
  );
}

export function IconX(props) {
  return base(<path d="M6 6l12 12M18 6L6 18" />, props);
}

export function IconChevronDown(props) {
  return base(<path d="M6 9l6 6 6-6" />, props);
}

export function IconRocket(props) {
  return base(
    <>
      <path d="M12 2c2.5 1.8 4 5 4 8.5 0 2-.6 3.8-1.6 5.3L12 19l-2.4-3.2C8.6 14.3 8 12.5 8 10.5 8 7 9.5 3.8 12 2Z" />
      <path d="M9 14.5 6 16.5l.5-3.7M15 14.5l3 2 -.5-3.7" />
      <circle cx="12" cy="9.5" r="1.4" />
    </>,
    props
  );
}

export function IconSparkle(props) {
  return base(
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </>,
    props
  );
}

export function IconCheck(props) {
  return base(<path d="M5 13l4 4L19 7" />, props);
}

export function IconMail(props) {
  return base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </>,
    props
  );
}

export function IconChat(props) {
  return base(<path d="M21 12a8 8 0 1 1-3.2-6.4L21 4l-1 4.2A7.9 7.9 0 0 1 21 12Z" />, props);
}

export function IconEdit(props) {
  return base(
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </>,
    props
  );
}

export function IconArrowLeft(props) {
  return base(<path d="M19 12H5M11 6l-6 6 6 6" />, props);
}

export function IconInfo(props) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill={props.color || 'currentColor'} stroke="none" />
    </>,
    props
  );
}

export function IconTrophy(props) {
  return base(
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
      <path d="M9 17h6M12 13v4" />
    </>,
    props
  );
}

export function IconMedal(props) {
  return base(
    <>
      <path d="M8.5 3L10 8M15.5 3L14 8" />
      <circle cx="12" cy="14" r="6" />
      <path d="M9.3 14l1.8 1.8L15 12.3" />
    </>,
    props
  );
}

export function IconTrendUp(props) {
  return base(
    <>
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </>,
    props
  );
}

export function IconTrendDown(props) {
  return base(
    <>
      <path d="M7 7L17 17" />
      <path d="M17 9v8H9" />
    </>,
    props
  );
}
