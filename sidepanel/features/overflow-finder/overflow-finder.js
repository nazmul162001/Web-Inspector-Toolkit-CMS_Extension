/**
 * Layout Overflow Finder: live check of elements that stick out of the
 * viewport. Resize the window (especially to a small screen) and the list
 * updates. Highlight scrolls the page to that box.
 */

import { ERR, MSG } from '../../../shared/constants.js';
import { el, setChildren } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { getLanguage } from '../../../services/i18n.js';
import { formatPx } from '../../../services/overflow-rules.js';
import { ensureAccess, requestOrigin } from '../../permissions.js';
import { describeError } from '../scan-ui.js';
import { icon } from '../../components/icons.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', '../image-resolution/image-resolution.css', './overflow-finder.css']) {
    const href = new URL(file, import.meta.url).href;
    if (document.querySelector(`link[href="${href}"]`)) continue;
    await new Promise((resolve) => {
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      document.head.append(link);
    });
  }
}

export function createFeature(ctx) {
  let refs = null;
  let enabled = true;
  let inspectedTabId = null;
  let sequence = 0;
  let report = null;
  let selected = 0;
  let lastTabKey = '';
  const disposers = [];

  function showStatus(tone, title, detail = '', actions = []) {
    refs.state.dataset.tone = tone;
    refs.stateTitle.textContent = title;
    refs.stateDetail.textContent = detail;
    refs.stateDetail.hidden = !detail;
    setChildren(
      refs.stateActions,
      actions.map((action) => el('button', { class: `btn btn--sm${action.primary ? ' btn--primary' : ''}`, type: 'button', onClick: action.onClick }, action.label)),
    );
    refs.stateActions.hidden = actions.length === 0;
    refs.toggle.setAttribute('aria-checked', String(enabled));
  }

  async function reachable(tabContext) {
    if (tabContext.hasHostAccess) return true;
    try {
      const probe = await sendToBackground(MSG.CHECK_ACCESS, { tabId: tabContext.tab.id });
      return !!probe.ok;
    } catch {
      return false;
    }
  }

  async function stopRunning() {
    const tabId = inspectedTabId;
    inspectedTabId = null;
    if (tabId === null) return;
    try {
      await sendToBackground(MSG.OVERFLOW_FIND, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 });
    } catch {
      /* the tab was closed or navigated away */
    }
  }

  async function apply({ withGesture = false, focusIndex } = {}) {
    const mine = ++sequence;
    const stale = () => mine !== sequence || !refs;

    if (!enabled) {
      await stopRunning();
      if (!stale()) showStatus('off', 'Overflow Finder is off', 'Turn it on to outline elements that stick out of the page.');
      return;
    }

    const tabContext = ctx.getTabContext();
    if (!tabContext?.tab) {
      await stopRunning();
      if (!stale()) showStatus('warn', 'No page to inspect', 'Open a website in the active tab.');
      return;
    }
    if (tabContext.restricted) {
      await stopRunning();
      if (!stale()) showStatus('warn', "This page can't be inspected", tabContext.restrictionReason || 'Chrome does not let extensions run on this page.');
      return;
    }

    const tabId = tabContext.tab.id;
    if (inspectedTabId !== null && inspectedTabId !== tabId) await stopRunning();

    try {
      if (withGesture) await ensureAccess(tabContext, 'page');
      else if (!(await reachable(tabContext))) {
        await stopRunning();
        if (stale()) return;
        showStatus('warn', 'Allow access to this site', `The inspector needs permission to run on ${tabContext.origin || 'this page'}. Nothing leaves your device.`, [
          { label: 'Allow access', primary: true, onClick: () => apply({ withGesture: true }) },
        ]);
        return;
      }
      if (stale()) return;
      const options = { language: getLanguage() };
      if (Number.isInteger(focusIndex)) options.focusIndex = focusIndex;
      await sendToBackground(MSG.OVERFLOW_FIND, { tabId, enabled: true, options, sessionId: ctx.sessionId }, { timeoutMs: 10000 });
      inspectedTabId = tabId;
      if (stale()) return;
      if (!report) showStatus('on', 'Overflow Finder is on', 'Resize the window. Red frames mark elements that stick out. Press Esc on the page to stop.');
    } catch (error) {
      if (stale()) return;
      const info = describeError(error);
      showStatus('warn', "Couldn't start Overflow Finder", info.message, [
        info.canGrant
          ? { label: 'Allow access', primary: true, onClick: () => apply({ withGesture: true }) }
          : { label: 'Try again', onClick: () => apply() },
      ]);
    }
  }

  async function highlight(item) {
    const tab = ctx.getTabContext()?.tab;
    const payload = {
      pageUrl: report?.pageUrl || tab?.url,
      tabId: tab?.id,
      windowId: ctx.windowId,
      elementId: item.elementId,
      contextId: item.contextId,
      path: item.path,
      tag: item.tag,
      label: item.selector,
      mode: 'highlight',
    };
    selected = item.index;
    renderReport();
    apply({ focusIndex: item.index }).catch(() => {});
    try {
      await sendToBackground(MSG.HIGHLIGHT, payload, { timeoutMs: 40000 });
    } catch (error) {
      if (error.code === ERR.PERMISSION_DENIED && payload.pageUrl && (await requestOrigin(payload.pageUrl))) {
        await sendToBackground(MSG.HIGHLIGHT, payload, { timeoutMs: 40000 });
        return;
      }
      ctx.notify.error(error?.message || 'Could not highlight that element.');
    }
  }

  function itemCard(item) {
    const css = item.css?.[0] || item.causes?.find((cause) => cause.css)?.css || '';
    return el(
      'article',
      { class: `of-card${selected === item.index ? ' is-focus' : ''}`, dataset: { index: String(item.index) } },
      el(
        'div',
        { class: 'of-card__head' },
        el('span', { class: 'of-index' }, String(item.index)),
        el('span', { class: 'of-card__sel', title: item.selector, 'data-i18n-skip': true }, item.selector),
        el('span', { class: 'of-amount', 'data-i18n-skip': true }, `+${formatPx(item.overflowPx)}px`),
      ),
      item.causes?.length
        ? el(
            'div',
            { class: 'of-causes' },
            ...item.causes.map((cause) => el('span', { class: 'of-cause' }, cause.text)),
          )
        : null,
      css ? el('div', { class: 'of-css', 'data-i18n-skip': true }, css) : null,
      el(
        'div',
        { class: 'of-card__actions' },
        el('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => highlight(item) }, icon('eye', { size: 14 }), 'Highlight'),
      ),
    );
  }

  function renderReport() {
    if (!refs) return;
    const on = enabled && inspectedTabId !== null;
    if (!on || !report) {
      refs.metrics.hidden = true;
      refs.empty.hidden = false;
      refs.empty.classList.remove('is-ok');
      refs.emptyTitle.textContent = 'Waiting for the page';
      refs.emptyLead.textContent = 'Turn it on. Overflow is outlined on the page and listed here.';
      refs.list.hidden = true;
      return;
    }

    const width = formatPx(report.viewport.width);
    const extra = formatPx(report.viewport.pageOverflow);
    refs.metrics.hidden = false;
    refs.viewValue.replaceChildren(width, el('small', {}, 'px'));
    refs.overValue.replaceChildren(report.ok ? '0' : extra, el('small', {}, 'px'));
    refs.overMetric.classList.toggle('is-bad', !report.ok);
    refs.overMetric.classList.toggle('is-ok', report.ok);
    refs.viewHint.textContent = Number(report.viewport.width) <= 768 ? 'Small screen' : 'PC width';

    if (report.ok) {
      showStatus('on', 'No horizontal overflow', `Everything fits at ${width} px. Resize to check a small screen.`);
      refs.empty.hidden = false;
      refs.empty.classList.add('is-ok');
      refs.emptyTitle.textContent = 'No overflow';
      refs.emptyLead.textContent = `Nothing sticks out at ${width} px. Narrow the window to catch mobile layout bugs.`;
      refs.list.hidden = true;
      return;
    }

    const count = report.items.length;
    showStatus(
      'error',
      report.viewport.pageOverflow >= 2 ? `Page is ${extra} px too wide` : `${count} overflowing ${count === 1 ? 'element' : 'elements'}`,
      `Viewport ${width} px. Red frames on the page match the numbers below.`,
    );
    refs.empty.hidden = true;
    refs.list.hidden = false;
    setChildren(refs.list, ...report.items.map((item) => itemCard(item)));
    if (report.truncated) {
      refs.list.append(el('p', { class: 'of-more' }, 'Only the strongest overflows are listed.'));
    }
    const focused = refs.list.querySelector('.of-card.is-focus');
    focused?.scrollIntoView({ block: 'nearest' });
  }

  async function mount(container) {
    await ensureStyles();

    const toggle = el('button', { class: 'ir-switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Find layout overflow on the page' }, el('span', { class: 'ir-switch__knob' }));
    const stateTitle = el('div', { class: 'ir-state__title' });
    const stateDetail = el('div', { class: 'ir-state__detail' });
    const stateActions = el('div', { class: 'ir-state__actions', hidden: true });
    const state = el(
      'div',
      { class: 'ir-state', dataset: { tone: 'off' } },
      el('div', { class: 'ir-state__icon' }, icon('overflow', { size: 18 })),
      el('div', { class: 'ir-state__text' }, stateTitle, stateDetail, stateActions),
      toggle,
    );

    const viewValue = el('div', { class: 'of-metric__value', 'data-i18n-skip': true }, '—');
    const viewHint = el('div', { class: 'of-metric__label' }, 'Viewport');
    const overValue = el('div', { class: 'of-metric__value', 'data-i18n-skip': true }, '—');
    const overMetric = el(
      'div',
      { class: 'of-metric' },
      el('div', { class: 'of-metric__label' }, 'Too wide by'),
      overValue,
    );
    const metrics = el(
      'div',
      { class: 'of-metrics', hidden: true },
      el('div', { class: 'of-metric' }, viewHint, viewValue),
      overMetric,
    );

    const emptyTitle = el('p', { class: 'of-empty__title' }, 'Waiting for the page');
    const emptyLead = el('p', { class: 'of-empty__lead' }, 'Turn it on. Overflow is outlined on the page and listed here.');
    const empty = el('div', { class: 'of-empty' }, emptyTitle, emptyLead);
    const list = el('div', { class: 'of-list', hidden: true });

    const helpBtn = el(
      'button',
      {
        class: 'icon-btn of-help',
        type: 'button',
        'aria-label': 'How to use Overflow Finder',
        'aria-expanded': 'false',
        'aria-controls': 'of-help-tip',
      },
      icon('info', { size: 15 }),
    );
    const helpTip = el(
      'div',
      { id: 'of-help-tip', class: 'of-help-tip', hidden: true, role: 'dialog', 'aria-labelledby': 'of-help-title' },
      el('p', { id: 'of-help-title', class: 'of-help-tip__title' }, 'How to use'),
      el(
        'ol',
        { class: 'of-help-tip__steps' },
        el('li', {}, 'Turn it on. Anything that sticks out of the page gets a red frame and a number.'),
        el('li', {}, 'Resize the window, especially down to a small screen (max 768 px). The list updates live.'),
        el('li', {}, 'Each card shows why it overflows (min-width, nowrap, a wide image, a table) and the CSS to change.'),
        el('li', {}, 'Click Highlight to scroll to that element. Press Esc on the page to stop.'),
      ),
    );
    const setHelpOpen = (open) => {
      helpTip.hidden = !open;
      helpBtn.setAttribute('aria-expanded', String(open));
    };
    helpBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setHelpOpen(helpTip.hidden);
    });
    const onDocClick = (event) => {
      if (helpTip.hidden) return;
      if (helpBtn.contains(event.target) || helpTip.contains(event.target)) return;
      setHelpOpen(false);
    };
    const onDocKey = (event) => {
      if (event.key === 'Escape' && !helpTip.hidden) setHelpOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
    disposers.push(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
    });

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ir of', 'aria-labelledby': 'of-title' },
        el(
          'div',
          { class: 'cf-head of-head' },
          el(
            'div',
            { class: 'of-title-row' },
            el('h2', { id: 'of-title', class: 'cf-title' }, 'Layout Overflow Finder'),
            helpBtn,
          ),
          helpTip,
          el('p', { class: 'cf-lead' }, 'Find elements that make the page wider than the window. Resize to check a small screen.'),
        ),
        state,
        metrics,
        empty,
        list,
        el(
          'ul',
          { class: 'ir-tips' },
          el('li', {}, 'Horizontal overflow only. A tall page is normal; a sideways scrollbar is not.'),
          el('li', {}, 'The numbered frames on the page match the cards below.'),
          el('li', {}, 'Typical causes: min-width, nowrap text, a wide image, or a table that will not shrink.'),
        ),
      ),
    );

    refs = {
      state,
      stateTitle,
      stateDetail,
      stateActions,
      toggle,
      metrics,
      viewValue,
      viewHint,
      overMetric,
      overValue,
      empty,
      emptyTitle,
      emptyLead,
      list,
    };

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      report = null;
      selected = 0;
      renderReport();
      apply({ withGesture: enabled });
    });

    disposers.push(
      onEvent(MSG.OVERFLOW_FIND_EVENT, (event) => {
        if (!refs || !event) return;
        if (event.type === 'stopped') {
          enabled = false;
          inspectedTabId = null;
          report = null;
          selected = 0;
          renderReport();
          apply();
        } else if (event.items) {
          report = event;
          if (event.selected) selected = event.selected;
          renderReport();
        }
      }),
    );

    lastTabKey = '';
    await apply();
  }

  function onLanguageChange() {
    if (refs && enabled && inspectedTabId !== null) apply();
  }

  function unmount() {
    sequence += 1;
    disposers.splice(0).forEach((dispose) => dispose());
    const tabId = inspectedTabId;
    inspectedTabId = null;
    refs = null;
    if (tabId !== null) sendToBackground(MSG.OVERFLOW_FIND, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 }).catch(() => {});
  }

  function onTabContextChange(tabContext) {
    if (!refs) return;
    const key = `${tabContext?.tab?.id ?? ''}|${tabContext?.tab?.url ?? ''}`;
    if (key !== lastTabKey) {
      lastTabKey = key;
      report = null;
      selected = 0;
      renderReport();
    }
    apply();
  }

  return { mount, unmount, onTabContextChange, onLanguageChange };
}
