/**
 * Content-script bootstrap for the Select Area shortcut. Classic script:
 * chrome.scripting.registerContentScripts cannot load ES modules, so this
 * file only imports the module. The module graph is in web_accessible_resources.
 */
(async () => {
  try {
    const main = await import(chrome.runtime.getURL('content/screenshot-hotkey-main.js'));
    main.initHotkey();
  } catch (error) {
    console.warn('[Web Inspector Toolkit] screenshot shortcut failed to load', error);
  }
})();
