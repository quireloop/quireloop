// Two LaTeX braces framing a staggered stack of pages — code and manuscript
// in one mark. Braces use currentColor so they follow the app's light/dark
// theme; the page steps keep fixed brand colors (amber/gold) in both modes.
export default function Logo({ size = 28 }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label="Scriptorium"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M36 25 C 22 25 24 42 20 52 C 18 56 12 58 8 60 C 12 62 18 64 20 68 C 24 78 22 95 36 95"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M84 25 C 98 25 96 42 100 52 C 102 56 108 58 112 60 C 108 62 102 64 100 68 C 96 78 98 95 84 95"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="40" y="28" width="28" height="9" rx="3" fill="#e7a13a" />
      <rect x="46" y="44" width="28" height="9" rx="3" fill="#f0c674" />
      <rect x="52" y="60" width="28" height="9" rx="3" fill="#e7a13a" />
      <rect x="58" y="76" width="28" height="9" rx="3" fill="#f0c674" />
    </svg>
  );
}
