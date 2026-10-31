// The small-print ownership line shown under the login and dashboard pages.
// The start year is fixed (first commit, 2026); only the end year moves, so the
// notice never claims a range that starts before the work existed.
const FIRST_YEAR = 2026;

export default function CopyrightNotice({ style }) {
  const year = new Date().getFullYear();
  const years = year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : `${FIRST_YEAR}`;
  return (
    <div
      style={{
        textAlign: 'center',
        fontSize: 10.5,
        letterSpacing: 0.2,
        color: 'var(--text-muted)',
        opacity: 0.8,
        ...style,
      }}
    >
      © {years} A. C. Pogaku. Licensed for academic use only.
    </div>
  );
}
