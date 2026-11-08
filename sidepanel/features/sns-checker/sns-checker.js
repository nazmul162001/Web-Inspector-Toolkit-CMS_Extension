/**
 * SNS Checker: while this tool is open, hovering an SNS icon previews the
 * rules and a click locks the selection (the link is not followed). Size,
 * side space, matching sizes and even gaps are re-checked as the window
 * resizes. "Perfect" waits until small-screen and PC both pass.
 */

import { MSG } from '../../../shared/constants.js';
import { el, setChildren } from '../../../shared/helpers.js';
import { onEvent, sendToBackground } from '../../../services/message-service.js';
import { getLanguage } from '../../../services/i18n.js';
import { cssSourceExtras, describeRuleRange, formatCssDecl, px } from '../../../services/sns-rules.js';
import { ensureAccess } from '../../permissions.js';
import { describeError } from '../scan-ui.js';
import { icon } from '../../components/icons.js';

async function ensureStyles() {
  for (const file of ['../color-find/color-find.css', '../image-resolution/image-resolution.css', './sns-checker.css']) {
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

function formatSize(w, h) {
  return `${w} × ${h}`;
}

export function createFeature(ctx) {
  let refs = null;
  let enabled = true;
  let inspectedTabId = null;
  let sequence = 0;
  let report = null;
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
      await sendToBackground(MSG.SNS_CHECK, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 });
    } catch {
      /* the tab was closed or navigated away */
    }
  }

  async function apply({ withGesture = false } = {}) {
    const mine = ++sequence;
    const stale = () => mine !== sequence || !refs;

    if (!enabled) {
      await stopRunning();
      if (!stale()) showStatus('off', 'SNS Checker is off', 'Turn it on to hover and click an SNS icon on the page.');
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
      await sendToBackground(MSG.SNS_CHECK, { tabId, enabled: true, options: { language: getLanguage() }, sessionId: ctx.sessionId }, { timeoutMs: 10000 });
      inspectedTabId = tabId;
      if (stale()) return;
      showStatus('on', 'SNS Checker is on', 'Hover an Instagram, LINE, Facebook, mail or reservation icon to preview. Click to select it. The link will not open. Press Esc on the page to stop.');
    } catch (error) {
      if (stale()) return;
      const info = describeError(error);
      showStatus('warn', "Couldn't start SNS Checker", info.message, [
        info.canGrant
          ? { label: 'Allow access', primary: true, onClick: () => apply({ withGesture: true }) }
          : { label: 'Try again', onClick: () => apply() },
      ]);
    }
  }

  const row = (label, value, { mono = false, tone = '' } = {}) =>
    value ? el('div', { class: 'ir-row' }, el('span', {}, label), el('span', { class: `${mono ? 'mono' : ''} ${tone ? `ir-tone--${tone}` : ''}`.trim() }, value)) : null;

  function cssBlock(decl, bad) {
    const extras = cssSourceExtras(decl.source);
    return el(
      'div',
      { class: `sns-css-block${bad ? ' is-bad' : ' is-ok'}` },
      el('div', { class: 'sns-css', 'data-i18n-skip': true }, formatCssDecl(decl)),
      ...extras.map((extra) =>
        el('div', { class: 'sns-css-meta', ...(extra.kind === 'media' ? { 'data-i18n-skip': true } : {}) }, extra.text),
      ),
    );
  }

  function iconCard(item) {
    const ok = item.ok;
    const sizeNeed = item.requiredSize ? formatSize(item.requiredSize.w, item.requiredSize.h) : '30 × 30, 32 × 32 or 40 × 40';
    const spaceFail = item.issues.includes('spacing');
    const cssSize = item.cssSize || [];
    const cssSpace = [...(item.cssSpacing?.left || []), ...(item.cssSpacing?.right || [])].filter(
      (decl, index, list) => list.findIndex((other) => other.property === decl.property && other.value === decl.value) === index,
    );
    return el(
      'article',
      { class: `sns-card${ok ? '' : ' sns-card--error'}` },
      el(
        'div',
        { class: 'sns-card__head' },
        el('span', { class: 'ir-kind' }, item.kindLabel),
        el('span', { class: `sns-card__verdict${ok ? ' is-ok' : ' is-bad'}` }, ok ? 'Pass' : 'Needs work'),
      ),
      el('div', { class: 'ir-size' }, formatSize(item.size.w, item.size.h), el('small', {}, 'px on the page')),
      el(
        'div',
        { class: 'ir-rows' },
        row('Required size', sizeNeed, { mono: true, tone: item.issues.includes('size') ? 'warn' : 'ok' }),
        row('Required space', `${px(item.requiredSpace)} px`, { mono: true }),
      ),
      cssSize.length || cssSpace.length
        ? el(
            'div',
            { class: 'sns-css-list' },
            ...cssSize.map((decl) => cssBlock(decl, item.issues.includes('size'))),
            ...cssSpace.map((decl) => cssBlock(decl, spaceFail && Number(decl.px) + 0.6 < item.requiredSpace)),
          )
        : el(
            'div',
            { class: 'ir-rows' },
            row('Space on the left', `${px(item.spacing.left)} px`, {
              mono: true,
              tone: spaceFail && item.spacing.left < item.requiredSpace ? 'warn' : 'ok',
            }),
            row('Space on the right', `${px(item.spacing.right)} px`, {
              mono: true,
              tone: spaceFail && item.spacing.right < item.requiredSpace ? 'warn' : 'ok',
            }),
          ),
    );
  }

  function clusterCard(cluster) {
    if (!cluster || (cluster.sizes || []).length < 2) return null;
    const sizes = cluster.sizes.map((size) => formatSize(size.w, size.h)).join(', ');
    const gaps = (cluster.cssGaps && cluster.cssGaps.length
      ? cluster.cssGaps
      : (cluster.gaps || []).map((gap) => `${px(gap)} px`)
    ).join(' · ');
    return el(
      'article',
      { class: `sns-card${cluster.ok ? '' : ' sns-card--error'}` },
      el(
        'div',
        { class: 'sns-card__head' },
        el('span', { class: 'ir-kind' }, 'This row'),
        el('span', { class: `sns-card__verdict${cluster.ok ? ' is-ok' : ' is-bad'}` }, cluster.ok ? 'Pass' : 'Needs work'),
      ),
      el(
        'div',
        { class: 'ir-rows' },
        row('Row sizes', cluster.sameSize ? 'All the same' : sizes, { tone: cluster.sameSize ? 'ok' : 'warn' }),
        gaps ? row('Space between icons', gaps, { mono: true, tone: cluster.sameGap ? 'ok' : 'warn' }) : null,
      ),
    );
  }

  function screenChip(label, status) {
    const text = status === 'pass' ? 'Pass' : status === 'fail' ? 'Needs work' : 'Not checked yet';
    return el('div', { class: `sns-screen is-${status || 'wait'}` }, el('span', {}, label), ' · ', el('span', {}, text));
  }

  function verdictCopy(report) {
    if (report.perfect) {
      return {
        tone: 'ok',
        title: 'Perfect. Everything is okay.',
        detail: 'Small screen and PC both match the SNS rules.',
      };
    }
    if (!report.currentOk) {
      const range = report.failRange || describeRuleRange(report.viewportWidth);
      const extra = report.screens?.pc === 'pass' ? 'PC already passed.' : report.screens?.sp === 'pass' ? 'Small screen already passed.' : '';
      return {
        tone: 'bad',
        title: 'This width breaks the SNS rules.',
        detail: [range, extra, 'Update the CSS below.'].filter(Boolean).join(' '),
      };
    }
    const needSmall = report.screens?.sp !== 'pass';
    return {
      tone: 'wait',
      title: 'Not finished yet',
      detail: needSmall
        ? 'This width is okay. Resize to a small screen (max 768 px) and confirm 40 × 40 px with 20 px sides.'
        : 'This width is okay. Resize wider than 768 px and confirm the PC size and spacing.',
    };
  }

  function renderReport() {
    if (!refs) return;
    if (!report?.items?.length) {
      refs.result.hidden = true;
      refs.empty.hidden = false;
      return;
    }
    refs.empty.hidden = true;
    refs.result.hidden = false;
    const copy = verdictCopy(report);
    const screen = `${report.screenLabel} · ${report.viewportWidth} px`;
    const suggestions = report.suggestions || [];
    setChildren(
      refs.result,
      el(
        'div',
        { class: `sns-verdict is-${copy.tone}` },
        el('div', { class: 'sns-verdict__title' }, copy.title),
        el('div', { class: 'sns-verdict__detail' }, copy.detail),
        el(
          'div',
          { class: 'sns-screens' },
          screenChip('Small screen', report.screens?.sp),
          screenChip('PC', report.screens?.pc),
        ),
        el('div', { class: 'sns-verdict__screen', 'data-i18n-skip': true }, screen),
      ),
      suggestions.length
        ? el(
            'ul',
            { class: 'sns-suggestions' },
            ...suggestions.map((text) => el('li', {}, text)),
          )
        : null,
      clusterCard(report.cluster),
      ...report.items.map((item) => iconCard(item)),
    );
  }

  async function mount(container) {
    await ensureStyles();

    const toggle = el('button', { class: 'ir-switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Check SNS icons on the page' }, el('span', { class: 'ir-switch__knob' }));
    const stateTitle = el('div', { class: 'ir-state__title' });
    const stateDetail = el('div', { class: 'ir-state__detail' });
    const stateActions = el('div', { class: 'ir-state__actions', hidden: true });
    const state = el(
      'div',
      { class: 'ir-state', dataset: { tone: 'off' } },
      el('div', { class: 'ir-state__icon' }, icon('share', { size: 18 })),
      el('div', { class: 'ir-state__text' }, stateTitle, stateDetail, stateActions),
      toggle,
    );

    const empty = el(
      'div',
      { class: 'sns-empty' },
      el('p', { class: 'sns-empty__title' }, 'No icon selected yet'),
      el('p', { class: 'sns-empty__lead' }, 'Hover an SNS icon on the page, then click to select it. Icons that sit side by side can be selected together.'),
    );
    const result = el('div', { class: 'sns-result', hidden: true });
    const helpBtn = el(
      'button',
      {
        class: 'icon-btn sns-help',
        type: 'button',
        'aria-label': 'How to use SNS Checker',
        'aria-expanded': 'false',
        'aria-controls': 'sns-help-tip',
      },
      icon('info', { size: 15 }),
    );
    const helpTip = el(
      'div',
      { id: 'sns-help-tip', class: 'sns-help-tip', hidden: true, role: 'dialog', 'aria-labelledby': 'sns-help-title' },
      el('p', { id: 'sns-help-title', class: 'sns-help-tip__title' }, 'How to use'),
      el(
        'ol',
        { class: 'sns-help-tip__steps' },
        el('li', {}, 'Turn it on, then hover an SNS icon to preview. Click the icon to select it. The link does not open.'),
        el('li', {}, 'Click more than one icon in the same row to check them together.'),
        el('li', {}, 'Keep them selected and resize the window. Check a small screen (max 768 px) and PC. Perfect only appears when both pass.'),
        el('li', {}, 'If a rule is broken, the frame turns red. Details appear below: the CSS to change (width, margin, padding, gap), and a media query when the value comes from one.'),
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
    const rules = el(
      'ul',
      { class: 'ir-tips sns-rules' },
      el('li', {}, 'Small screens (max 768 px): the icon must be 40 × 40 px, with at least 20 px of space on the left and right.'),
      el('li', {}, 'PC: 30 × 30, 32 × 32 or 40 × 40 px are fine. Space on each side must still be at least half the icon width.'),
      el('li', {}, 'Every selected icon in the row must be the same size, with the same space between them.'),
      el('li', {}, 'Hover to preview, click to select, then resize the window. A red frame means this width fails. Perfect waits until small screen and PC both pass.'),
    );

    container.replaceChildren(
      el(
        'section',
        { class: 'cf ir sns', 'aria-labelledby': 'sns-title' },
        el(
          'div',
          { class: 'cf-head sns-head' },
          el(
            'div',
            { class: 'sns-title-row' },
            el('h2', { id: 'sns-title', class: 'cf-title' }, 'SNS Checker'),
            helpBtn,
          ),
          helpTip,
          el('p', { class: 'cf-lead' }, 'Hover an SNS icon to preview its size and spacing. Click to select it.'),
        ),
        state,
        empty,
        result,
        rules,
      ),
    );

    refs = { state, stateTitle, stateDetail, stateActions, toggle, empty, result };

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      apply({ withGesture: enabled });
    });

    disposers.push(
      onEvent(MSG.SNS_CHECK_EVENT, (event) => {
        if (!refs || !event) return;
        if (event.type === 'stopped') {
          enabled = false;
          inspectedTabId = null;
          report = null;
          renderReport();
          apply();
        } else if (event.type === 'update') {
          report = event;
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
    if (tabId !== null) sendToBackground(MSG.SNS_CHECK, { tabId, enabled: false, sessionId: ctx.sessionId }, { timeoutMs: 6000 }).catch(() => {});
  }

  function onTabContextChange(tabContext) {
    if (!refs) return;
    const key = `${tabContext?.tab?.id ?? ''}|${tabContext?.tab?.url ?? ''}`;
    if (key !== lastTabKey) {
      const switchedTab = lastTabKey && lastTabKey.split('|')[0] !== key.split('|')[0];
      lastTabKey = key;
      if (switchedTab) {
        report = null;
        renderReport();
      }
    }
    apply();
  }

  return { mount, unmount, onTabContextChange, onLanguageChange };
}
