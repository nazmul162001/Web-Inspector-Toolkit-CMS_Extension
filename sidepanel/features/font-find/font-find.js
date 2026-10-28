/**
 * Font Find: type a font family and see every element that asks for it, with
 * its place in the font list, the web font file and the CSS that sets it.
 * The controller is shared with the other search tools (see ../search-feature.js).
 */

import { describeFontQuery, parseFontInput } from '../../../services/font-matcher.js';
import { createSearchFeature } from '../search-feature.js';
import { createTextResults } from '../text-find/text-results.js';

const config = {
  id: 'font-find',
  prefix: 'ff',
  htmlUrl: new URL('./font-find.html', import.meta.url),
  styleUrls: [new URL('../color-find/color-find.css', import.meta.url).href, new URL('../text-find/text-find.css', import.meta.url).href],
  settingsKey: 'font',

  words: {
    busy: 'Searching…',
    page: 'Looking for the font on the page…',
    siteStart: 'Starting site search…',
    site: (done, total) => `Searching the site: ${done} of ${total} pages`,
    searched: 'searched',
    cancelled: 'Search cancelled.',
  },
  siteNotice: 'Other pages are read with their stylesheets but without running scripts, so fonts that only scripts set are not included.',

  buildQuery: (text, options) => parseFontInput(text, options),
  preview(text, options) {
    const parsed = parseFontInput(text, options);
    if (!parsed.ok) return null;
    const read = parsed.from === 'declaration' ? 'Read from the CSS: ' : 'Read: ';
    return `${read}${parsed.query.families.join(' · ')}. ${describeFontQuery(parsed.query)}`;
  },

  copyValue: (match) => match.computed,
  copyNoun: 'Font list',
  createResults: (root, handlers) =>
    createTextResults(root, {
      ...handlers,
      copyLabel: 'Copy font list',
      subject: 'fonts',
      truncatedHint: 'Try an exact match, or turn on "Only where it is the first choice".',
      emptyState: (query, scan) => ({
        title: `No element uses ${(query.use === 'first' ? query.families.slice(0, 1) : query.families).join(', ')}`,
        message: scan.scope === 'site' ? 'None of the scanned pages ask for this font.' : 'Nothing on this page asks for this font.',
        hints: [
          query.exact && 'Turn off "Exact match" to use a partial match (Noto finds Noto Sans JP).',
          query.use === 'list' && query.families.length > 1 && 'Choose "The first font only" or "Any of the fonts" - "All of the fonts, in that order" needs every font in the same list.',
          query.use === 'first' && query.families.length > 1 && 'Only the first font of what you typed is searched. Choose "Any of the fonts" to search the others too.',
          query.primaryOnly && 'Turn off "Only where it is the first choice" to also find it as a fallback font.',
          !query.includeInherited && 'Turn on "Also elements that inherit it" to list every element with text that uses the font from a parent.',
          'Only fonts named in CSS are searched. Text drawn inside images or canvas, and fonts that scripts set later, cannot be found.',
        ],
      }),
    }),
};

export const createFeature = (ctx) => createSearchFeature(ctx, config);
