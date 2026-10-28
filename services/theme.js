/**
 * Colour theme of the side panel: dark, light, or "system" (follow Chrome / the
 * operating system, which is what the panel did before there was a switch).
 *
 * The CSS reads `data-theme` on <html>; without it the panel follows the
 * system. Pure helpers, no chrome.* calls, so they can be tested.
 */

export const THEMES = Object.freeze(['system', 'dark', 'light']);
export const DEFAULT_THEME = 'system';
export const normalizeTheme = (value) => (THEMES.includes(value) ? value : DEFAULT_THEME);

const CACHE_KEY = 'wit-theme';

/** The theme that is really shown: "dark" or "light". */
export function resolveTheme(theme, prefersDark) {
  const safe = normalizeTheme(theme);
  return safe === 'system' ? (prefersDark ? 'dark' : 'light') : safe;
}

/** The theme the switch moves to from the one shown now. */
export const oppositeTheme = (shown) => (shown === 'light' ? 'dark' : 'light');

/** Put the theme on the page. Returns what is shown ("dark" | "light"). */
export function applyTheme(root, theme, prefersDark) {
  const safe = normalizeTheme(theme);
  if (safe === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', safe);
  return resolveTheme(safe, prefersDark);
}

/** Remember the choice where the page can read it at once on the next start (no flash of the wrong colours). */
export function cacheTheme(theme) {
  try {
    localStorage.setItem(CACHE_KEY, normalizeTheme(theme));
  } catch {
    /* storage unavailable: the saved setting still applies a moment later */
  }
}

export function cachedTheme() {
  try {
    return normalizeTheme(localStorage.getItem(CACHE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}
