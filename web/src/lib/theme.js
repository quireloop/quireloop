import { useEffect, useState } from 'react';

const VALID_THEMES = ['light', 'dark', 'neon'];
const NEXT_THEME = { light: 'dark', dark: 'neon', neon: 'light' };

function initialTheme() {
  const stored = localStorage.getItem('theme');
  if (VALID_THEMES.includes(stored)) return stored;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return prefersDark ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  function cycleTheme() {
    setThemeState((t) => NEXT_THEME[t] ?? 'light');
  }

  return [theme, cycleTheme];
}

// Simple boolean light/dark toggle used by pages outside the editor (e.g.
// the Dashboard's landing background), which don't offer the neon option.
// Shares the same 'theme' localStorage key as useTheme above — reads
// 'neon' as "dark" for its own purposes, and only ever writes back
// 'light'/'dark' itself (never introduces or clobbers 'neon').
export function useDarkMode() {
  const [dark, setDark] = useState(() => initialTheme() !== 'light');

  useEffect(() => {
    if (document.documentElement.getAttribute('data-theme') === 'neon' && dark) return;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return [dark, setDark];
}

export function useSidebarOpen() {
  const [open, setOpen] = useState(() => localStorage.getItem('sidebarOpen') !== 'false');

  useEffect(() => {
    localStorage.setItem('sidebarOpen', String(open));
  }, [open]);

  return [open, setOpen];
}
