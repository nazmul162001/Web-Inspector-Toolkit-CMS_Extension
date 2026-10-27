/**
 * Content-script bootstrap (classic script).
 *
 * Content scripts injected with chrome.scripting.executeScript({ files }) are
 * not ES modules, so this tiny loader dynamically imports the real module
 * graph (content/content-main.js and its imports), which are exposed through
 * `web_accessible_resources` in the manifest. It is injected on demand by the
 * service worker - the extension has no always-on content scripts.
 */
(async () => {
  try {
    const main = await import(chrome.runtime.getURL('content/content-main.js'));
    main.init();
  } catch (error) {
    console.warn('[Web Inspector Toolkit] content script failed to load', error);
  }
})();
