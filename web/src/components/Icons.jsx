function Icon({ size = 16, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const BackIcon = () => (
  <Icon>
    <path d="M10 3 5 8l5 5" />
  </Icon>
);

export const SidebarIcon = () => (
  <Icon>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="M6 2.75v10.5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={10}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);
