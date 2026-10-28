/**
 * Link href: type an address and see every link, button or anchor that points
 * to it. The controller is shared with Text Find and Telephone Number
 * (see ../search-feature.js).
 */

import { parseHrefInput } from '../../../services/href-matcher.js';
import { createSearchFeature } from '../search-feature.js';
import { createTextResults } from '../text-find/text-results.js';

const config = {
  id: 'link-href',
  prefix: 'lh',
  htmlUrl: new URL('./link-href.html', import.meta.url),
  styleUrls: [new URL('../color-find/color-find.css', import.meta.url).href, new URL('../text-find/text-find.css', import.meta.url).href],
  settingsKey: 'href',

  words: {
    busy: 'Searching…',
    page: 'Looking for links on the page…',
    siteStart: 'Starting site search…',
    site: (done, total) => `Searching the site: ${done} of ${total} pages`,
    searched: 'searched',
    cancelled: 'Search cancelled.',
  },
  siteNotice: 'Other pages are read as HTML, so links that only scripts add are not included.',

  buildQuery: (text, options) => parseHrefInput(text, options),

  copyValue: (match) => match.resolved || match.text,
  copyNoun: 'Link',
  createResults: (root, handlers) =>
    createTextResults(root, {
      ...handlers,
      copyLabel: 'Copy link',
      subject: 'links',
      emptyState: (query, scan) => ({
        title: 'No links to this address',
        message: scan.scope === 'site' ? 'None of the scanned pages link to it.' : 'Nothing on this page links to it.',
        hints: [
          query.exact && 'Turn off "Exact link" to also find links that merely contain this text (for example just instagram.com).',
          query.exact && !/[?#]/.test(query.url) && 'A link with extra parameters (?utm_source=…) is a different address; turn off "Exact link" to find those.',
          !query.looseHost && 'Turn on "Ignore http/https and www" to also find the other spelling of the same site.',
          !query.includeButtons && 'Turn on "Also buttons, forms and click handlers" to include data-href, formaction and onclick.',
          'Links that scripts build after the page loads, and links inside images or iframes, cannot be searched.',
        ],
      }),
    }),
};

export const createFeature = (ctx) => createSearchFeature(ctx, config);
