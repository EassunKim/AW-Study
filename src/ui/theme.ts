// The colour theme (docs/design/README.md, "Look"): follow the phone, or always light, or always dark.
// It's a setting for this device, not your data: it lives in the browser's localStorage, outside the
// encrypted store, so the unlock screen has the right colours before anything is unlocked. app.css
// does the colours; this only sets <html data-theme> ("light" or "dark", none to follow the phone)
// and the browser's bar colour to match.

export type Theme = 'phone' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['phone', 'light', 'dark'];
export const THEME_LABELS: Record<Theme, string> = { phone: 'Phone', light: 'Light', dark: 'Dark' };

const KEY = 'honed:theme';
/** The page background for each look, for the browser's bar (<meta name="theme-color">). Matches app.css. */
const BAR = { light: '#f2f5f1', dark: '#272727' } as const;

/** What's saved, or "phone" when nothing (or something unknown) is. Storage may be blocked: then "phone". */
export function savedTheme(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Theme {
  try {
    const value = storage?.getItem(KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : 'phone';
  } catch {
    return 'phone';
  }
}

/** Saves the choice (forgetting it for "phone", the default) and shows it at once. */
export function saveTheme(theme: Theme): void {
  try {
    const storage = safeStorage();
    if (theme === 'phone') storage?.removeItem(KEY);
    else storage?.setItem(KEY, theme);
  } catch {
    // Storage blocked (some private windows): the choice lasts until the page is closed
  }
  applyTheme(theme);
}

/** Light or dark, as the page shows it now. */
export function shownLook(theme: Theme, phonePrefersDark: boolean): 'light' | 'dark' {
  return theme === 'phone' ? (phonePrefersDark ? 'dark' : 'light') : theme;
}

let stopFollowing: (() => void) | null = null;

/** Puts the theme on the page; with "phone", keeps the bar colour in step when the phone changes. */
export function applyTheme(theme: Theme = savedTheme()): void {
  const root = document.documentElement;
  if (theme === 'phone') delete root.dataset.theme;
  else root.dataset.theme = theme;

  stopFollowing?.();
  stopFollowing = null;
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  const paintBar = () => setBarColour(BAR[shownLook(theme, query?.matches ?? false)]);
  paintBar();
  if (theme === 'phone' && query) {
    query.addEventListener('change', paintBar);
    stopFollowing = () => query.removeEventListener('change', paintBar);
  }
}

function setBarColour(colour: string): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = colour;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
