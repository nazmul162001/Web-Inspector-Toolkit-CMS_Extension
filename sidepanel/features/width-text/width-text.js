/**
 * Half/Full Width Text: tick the kinds of characters (numbers, letters,
 * parentheses, colons, % ...) and find where full-width ones appear.
 * The found characters can also be marked in red on the page itself.
 * The controller is shared with the other search tools (see ../search-feature.js).
 */

import { MSG } from '../../../shared/constants.js';
import { copyToClipboard } from '../../../shared/helpers.js';
import { sendToBackground } from '../../../services/message-service.js';
import { WIDTH_CATEGORIES, describeWidthQuery, parseWidthInput, uniqueWidthReplacements } from '../../../services/width-matcher.js';
import { icon } from '../../components/icons.js';
import { createSearchFeature } from '../search-feature.js';
import { createTextResults } from '../text-find/text-results.js';

let convertBox = null;

async function clearMarks(ctx) {
  const tabId = ctx.getTabContext()?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  try {
    await sendToBackground(MSG.CLEAR_MARKS, { tabId }, { timeoutMs: 5000 });
  } catch {
    /* the page is gone or was never searched: there is nothing to remove */
  }
}

function bindConvertBox(container, ctx) {
  const box = container.querySelector('#wd-convert');
  const input = container.querySelector('#wd-convert-text');
  const button = container.querySelector('#wd-convert-copy');
  let copiedTimer = 0;
  button.replaceChildren(icon('copy', { size: 14 }));

  const showCopyIcon = () => {
    button.classList.remove('is-copied');
    button.replaceChildren(icon('copy', { size: 14 }));
    button.setAttribute('aria-label', 'Copy');
    button.setAttribute('title', 'Copy');
  };

  function setScan(scan) {
    const text = uniqueWidthReplacements(scan?.pages);
    input.value = text;
    box.hidden = !text;
    if (!text) showCopyIcon();
  }

  function hide() {
    input.value = '';
    box.hidden = true;
    showCopyIcon();
  }

  button.addEventListener('click', async () => {
    if (!input.value) return;
    if (!(await copyToClipboard(input.value))) {
      ctx.notify.error('Could not copy to the clipboard.');
      return;
    }
    ctx.notify.success('Half-width copied');
    button.classList.add('is-copied');
    button.replaceChildren(icon('check', { size: 14 }));
    button.setAttribute('aria-label', 'Copied');
    button.setAttribute('title', 'Copied');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(showCopyIcon, 1600);
  });

  return { setScan, hide };
}

/** Write the example characters (０１２ ...) next to each kind. */
function showExamples(container) {
  for (const category of WIDTH_CATEGORIES) {
    const example = container.querySelector(`[data-opt="${category.id}"]`)?.closest('label')?.querySelector('[data-example]');
    if (example) example.textContent = category.fullExample;
  }
}

const config = {
  id: 'width-text',
  prefix: 'wd',
  htmlUrl: new URL('./width-text.html', import.meta.url),
  styleUrls: [new URL('../color-find/color-find.css', import.meta.url).href, new URL('../text-find/text-find.css', import.meta.url).href],
  settingsKey: 'widthText',

  words: {
    busy: 'Searching…',
    page: 'Looking at the text of the page…',
    siteStart: 'Starting site search…',
    site: (done, total) => `Searching the site: ${done} of ${total} pages`,
    searched: 'searched',
    cancelled: 'Search cancelled.',
  },
  siteNotice: 'Other pages are read as HTML, so text that only scripts add is not included. Characters are marked on the page you are viewing; open a result to mark it on its own page.',

  buildQuery: (text, options) => parseWidthInput(text, options),
  preview(_text, options) {
    const parsed = parseWidthInput('', options);
    return parsed.ok ? describeWidthQuery(parsed.query) : null;
  },
  // The tool has no text field: the line under the options is always shown.
  alwaysPreview: true,

  onMount({ container, ctx, update }) {
    convertBox = bindConvertBox(container, ctx);
    showExamples(container);
    const setAll = (checked) => {
      for (const box of container.querySelectorAll('.wd-grid input[type="checkbox"]')) {
        if (box.checked === checked) continue;
        box.checked = checked;
        box.dispatchEvent(new Event('change'));
      }
      update();
    };
    container.querySelector('#wd-all').addEventListener('click', () => setAll(true));
    container.querySelector('#wd-none').addEventListener('click', () => setAll(false));
    container.querySelector('#wd-clear').addEventListener('click', async () => {
      await clearMarks(ctx);
      ctx.notify.info('Marks removed from the page.');
    });
  },
  onUnmount: ({ ctx }) => {
    convertBox = null;
    clearMarks(ctx);
  },
  // A result on another page opens that page: mark the characters there too.
  locateExtras: (query) => (query.highlightOnPage ? { marks: query } : {}),

  copyValue: (match) => match.text,
  copyNoun: 'Text',
  createResults: (root, handlers) => {
    const inner = createTextResults(root, {
      ...handlers,
      copyLabel: 'Copy text',
      subject: 'text',
      truncatedHint: 'Untick some kinds of characters to narrow the search.',
      emptyState: (query, scan) => {
        const form = 'full-width';
        return {
          title: `No ${form} characters found`,
          message: scan.scope === 'site' ? `None of the scanned pages contain ${form} characters of the chosen kinds.` : `The page has no ${form} characters of the chosen kinds.`,
          hints: [
            `Looked for: ${describeWidthQuery(query).replace(/^Looking for /, '').replace(/\.$/, '')}.`,
            'Tick more kinds of characters.',
            'Only text is searched: characters inside images, canvas or scripts are not.',
          ],
        };
      },
    });
    return {
      ...inner,
      show(scan, options) {
        const outcome = inner.show(scan, options);
        if (outcome?.empty) convertBox?.hide();
        else convertBox?.setScan(scan);
        return outcome;
      },
      showPartial(scan) {
        inner.showPartial(scan);
        convertBox?.setScan(scan);
      },
      showIdle() {
        inner.showIdle();
        convertBox?.hide();
      },
      showError(message, options) {
        inner.showError(message, options);
        convertBox?.hide();
      },
      clear() {
        inner.clear();
        convertBox?.hide();
      },
    };
  },
};

export const createFeature = (ctx) => createSearchFeature(ctx, config);
