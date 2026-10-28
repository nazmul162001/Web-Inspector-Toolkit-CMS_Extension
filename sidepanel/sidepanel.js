/**
 * Side panel bootstrap: wires the shell (header, scope tabs, feature
 * navigation, context bar, notifications) and mounts the active feature.
 * The panel never touches the page DOM - everything goes through the service
 * worker via services/message-service.js.
 */

import { FEATURES, FEATURE_STATUS, MSG, SCOPE } from '../shared/constants.js';
import { debounce, el, uid } from '../shared/helpers.js';
import { onEvent, openSession, sendToBackground } from '../services/message-service.js';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import { normalizeLanguage } from '../services/i18n.js';
import { applyTheme, cacheTheme, cachedTheme, normalizeTheme } from '../services/theme.js';
import { createDomTranslator } from './i18n-dom.js';
import { renderHeader } from './components/header.js';
import { createContextBar } from './components/context-bar.js';
import { createFeatureNav } from './components/navigation.js';
import { createScopeTabs } from './components/scope-tabs.js';
import { createNotifier } from './components/notifications.js';
import { hasFeature, loadFeature } from './features/registry.js';

// Apply the remembered theme before anything is drawn, so the panel never flashes the wrong colours.
applyTheme(document.documentElement, cachedTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches);

const DEFAULT_FEATURE = FEATURES.find((f) => f.status === FEATURE_STATUS.ACTIVE).id;

const state = {
  scope: SCOPE.PAGE,
  featureId: DEFAULT_FEATURE,
  tabContext: null,
  windowId: undefined,
  feature: null,
};

const dom = {
  header: document.getElementById('app-header'),
  contextBar: document.getElementById('context-bar'),
  scopeTabs: document.getElementById('scope-tabs'),
  featureNav: document.getElementById('feature-nav'),
  featureRoot: document.getElementById('feature-root'),
  toastRoot: document.getElementById('toast-root'),
};

const notifier = createNotifier(dom.toastRoot);
const contextBar = createContextBar(dom.contextBar);
const sessionId = uid('panel');

/* ------------------------------------------------------------ Tab context */

async function refreshTabContext() {
  try {
    state.tabContext = await sendToBackground(MSG.GET_TAB_CONTEXT, { windowId: state.windowId });
  } catch (error) {
    state.tabContext = { tab: null, restricted: true, restrictionReason: error.message };
  }
  contextBar.render(state.tabContext);
  state.feature?.onTabContextChange?.(state.tabContext);
  return state.tabContext;
}

/* ---------------------------------------------------------------- Features */

const featureContext = {
  getScope: () => state.scope,
  getTabContext: () => state.tabContext,
  refreshTabContext,
  notify: notifier,
  get windowId() {
    return state.windowId;
  },
  sessionId,
};

async function mountFeature(id) {
  state.feature?.unmount?.();
  state.feature = null;
  state.featureId = id;
  dom.featureRoot.replaceChildren();
  // Tools that are not searches (Image Resolution) have no "This Page / Entire Site" choice.
  dom.scopeTabs.hidden = FEATURES.find((feature) => feature.id === id)?.usesScope === false;

  if (!hasFeature(id)) {
    dom.featureRoot.append(el('div', { class: 'coming-soon' }, 'This tool is coming soon.'));
    return;
  }
  try {
    state.feature = await loadFeature(id, featureContext);
    await state.feature.mount(dom.featureRoot);
    state.feature.onScopeChange?.(state.scope);
    state.feature.onTabContextChange?.(state.tabContext);
  } catch (error) {
    console.error(error);
    dom.featureRoot.replaceChildren(el('div', { class: 'coming-soon' }, `Could not load this tool: ${error.message}`));
  }
}

/* ----------------------------------------------------------------- Startup */

async function init() {
  const { version } = chrome.runtime.getManifest();
  const translator = createDomTranslator(document.body);
  const settings = await loadSettings();
  const language = normalizeLanguage(settings.language);
  translator.setLanguage(language);

  // Dark / light: "system" until the user picks one, then the pick is kept.
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  let theme = normalizeTheme(settings.theme);
  const showTheme = () => applyTheme(document.documentElement, theme, systemDark.matches);
  cacheTheme(theme);
  const header = renderHeader(dom.header, {
    version,
    language,
    shownTheme: showTheme(),
    onTheme: (next) => {
      theme = next;
      cacheTheme(theme);
      saveSettings({ theme });
      header.setTheme(showTheme());
    },
    onLanguage: (next) => {
      const active = translator.setLanguage(next);
      header.setActive(active);
      saveSettings({ language: active });
      state.feature?.onLanguageChange?.(active);
    },
  });

  systemDark.addEventListener('change', () => {
    if (theme === 'system') header.setTheme(showTheme());
  });

  const nav = createFeatureNav(dom.featureNav, {
    features: FEATURES,
    activeId: state.featureId,
    onSelect: (id) => {
      nav.setActive(id);
      mountFeature(id);
    },
  });

  createScopeTabs(dom.scopeTabs, {
    initial: state.scope,
    onChange: (scope) => {
      state.scope = scope;
      state.feature?.onScopeChange?.(scope); // never starts a scan by itself
    },
  });

  try {
    const current = await chrome.windows.getCurrent();
    state.windowId = current.id;
  } catch {
    state.windowId = undefined;
  }

  // Long-lived port: keeps the worker alive during crawls and lets it clean up if this panel closes.
  openSession(sessionId);

  const onTabChange = debounce((payload) => {
    if (payload?.windowId && state.windowId && payload.windowId !== state.windowId) return;
    refreshTabContext();
  }, 150);
  onEvent(MSG.TAB_CONTEXT_CHANGED, onTabChange);

  await refreshTabContext();
  await mountFeature(state.featureId);
}

init().catch((error) => {
  console.error('[WIT] side panel failed to start', error);
  dom.featureRoot.replaceChildren(el('div', { class: 'coming-soon' }, `Startup failed: ${error.message}`));
});
