/**
 * Text Find: type any word or sentence, see every place it appears.
 * The controller is shared with Telephone Number (see ../search-feature.js).
 */

import { sanitizeTextQuery } from '../../../services/text-matcher.js';
import { createSearchFeature } from '../search-feature.js';
import { contextText } from './text-find-utils.js';
import { createTextResults } from './text-results.js';

const config = {
  id: 'text-find',
  prefix: 'tf',
  htmlUrl: new URL('./text-find.html', import.meta.url),
  styleUrls: [new URL('../color-find/color-find.css', import.meta.url).href, new URL('./text-find.css', import.meta.url).href],
  settingsKey: 'text',

  words: {
    busy: 'Searching…',
    page: 'Searching the page…',
    siteStart: 'Starting site search…',
    site: (done, total) => `Searching the site: ${done} of ${total} pages`,
    searched: 'searched',
    cancelled: 'Search cancelled.',
  },
  siteNotice: 'Other pages are read as HTML, so text that only scripts add is not included.',

  buildQuery(text, options) {
    const query = sanitizeTextQuery({ kind: 'text', text, ...options });
    return query ? { ok: true, query } : { ok: false, error: 'Type the text to look for.' };
  },

  copyValue: (match) => contextText(match),
  copyNoun: 'Text',
  createResults: (root, handlers) =>
    createTextResults(root, {
      ...handlers,
      copyLabel: 'Copy text',
      emptyState: (query, scan) => ({
        title: `No text matches “${query.text}”`,
        message: scan.scope === 'site' ? 'None of the scanned pages contain this text.' : 'This text is not on the page.',
        hints: [
          query.matchCase && 'Turn off Match case to ignore capital letters.',
          query.wholeWord && 'Turn off Whole word to also match parts of longer words.',
          query.visibleOnly && 'Turn off Visible text only to include text that is hidden by CSS.',
          !query.includeAttributes && 'Turn on "Also search alt, title, placeholder…" to look inside attributes.',
          'Text drawn inside images, canvas or shadow DOM cannot be searched.',
        ],
      }),
    }),
};

export const createFeature = (ctx) => createSearchFeature(ctx, config);
