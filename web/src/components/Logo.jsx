// The app-icon tile: LaTeX braces around a staggered stack of pages, code and
// manuscript in one mark. This is assets/logo-small.svg, the version drawn for
// 16-48 px; the dark tile keeps the gold pages readable in light and dark themes.
export default function Logo({ size = 28 }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="Quireloop"
      style={{ flexShrink: 0 }}
    >
      <rect width="120" height="120" rx="26" fill="#1c1a17" />
      <g
        fill="none"
        stroke="#f4efe4"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(60 60) scale(.9) translate(-60 -60)"
      >
        <path d="M38 22 C 24 22 26 42 22 52 C 20 56 14 58 10 60 C 14 62 20 64 22 68 C 26 78 24 98 38 98" />
        <path d="M82 22 C 96 22 94 42 98 52 C 100 56 106 58 110 60 C 106 62 100 64 98 68 C 94 78 96 98 82 98" />
      </g>
      <rect x="40" y="33" width="30" height="14" rx="4" fill="#e7a13a" />
      <rect x="45" y="53" width="30" height="14" rx="4" fill="#f0c674" />
      <rect x="50" y="73" width="30" height="14" rx="4" fill="#e7a13a" />
    </svg>
  );
}
