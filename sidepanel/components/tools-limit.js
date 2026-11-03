/**
 * "Search first 5 articles" control next to Tools. Persists with crawl
 * settings and only affects Entire Site scans of listing sections.
 */

import { saveSettings } from '../../services/settings-service.js';
import { icon } from './icons.js';

export function listingArticlesLimited() {
  const box = document.getElementById('limit-articles');
  return box ? !!box.checked : true;
}

export function bindToolsLimit({ initial = true } = {}) {
  const checkbox = document.getElementById('limit-articles');
  const info = document.getElementById('limit-articles-info');
  const tip = document.getElementById('limit-articles-tip');
  if (!checkbox || !info || !tip) return;

  checkbox.checked = initial !== false;
  if (!info.querySelector('svg')) info.append(icon('info', { size: 14 }));

  checkbox.addEventListener('change', () => {
    saveSettings({ crawl: { limitListingArticles: checkbox.checked } });
  });

  const setOpen = (open) => {
    tip.hidden = !open;
    info.setAttribute('aria-expanded', String(open));
  };

  info.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(tip.hidden);
  });

  document.addEventListener('click', (event) => {
    if (tip.hidden) return;
    if (info.contains(event.target) || tip.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tip.hidden) setOpen(false);
  });
}
