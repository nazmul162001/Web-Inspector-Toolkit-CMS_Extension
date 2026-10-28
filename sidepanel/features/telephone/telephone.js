/**
 * Telephone Number: type a number in any format and see every place it
 * appears (page text and tel: links). The controller is shared with Text Find
 * (see ../search-feature.js).
 */

import { parsePhoneInput } from '../../../services/phone-matcher.js';
import { createSearchFeature } from '../search-feature.js';
import { createTextResults } from '../text-find/text-results.js';

const config = {
  id: 'telephone',
  prefix: 'ph',
  htmlUrl: new URL('./telephone.html', import.meta.url),
  styleUrls: [new URL('../color-find/color-find.css', import.meta.url).href, new URL('../text-find/text-find.css', import.meta.url).href],
  settingsKey: 'phone',

  words: {
    busy: 'Searching…',
    page: 'Looking for the number on the page…',
    siteStart: 'Starting site search…',
    site: (done, total) => `Searching the site: ${done} of ${total} pages`,
    searched: 'searched',
    cancelled: 'Search cancelled.',
  },
  siteNotice: 'Other pages are read as HTML, so numbers that only scripts add are not included.',

  buildQuery: (text, options) => parsePhoneInput(text, options),

  copyValue: (match) => match.text,
  copyNoun: 'Number',
  createResults: (root, handlers) =>
    createTextResults(root, {
      ...handlers,
      copyLabel: 'Copy number',
      subject: 'numbers',
      emptyState: (query, scan) => ({
        title: `No pages show ${query.number}`,
        message: scan.scope === 'site' ? 'None of the scanned pages contain this number.' : 'This number is not on the page.',
        hints: [
          query.exact && 'Turn off "Exact number" to also find it inside longer numbers (for example the last digits only).',
          !query.international && 'Turn on "Treat +81 80… and 080… as the same number" to find the international spelling.',
          !query.includeLinks && 'Turn on "Also find tel: links" to include links that only call the number.',
          'Numbers drawn inside images or hidden in scripts cannot be searched.',
        ],
      }),
    }),
};

export const createFeature = (ctx) => createSearchFeature(ctx, config);
