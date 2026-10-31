/**
 * Small helpers shared by the in-page screenshot UI (area selector and editor).
 */

/** Build an element: `node('button', { class: 'x', onClick }, 'text', child)`. */
export function node(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/**
 * Give a shadow root its styles. A constructed stylesheet is not subject to
 * the page's Content-Security-Policy (an inline <style> element can be).
 */
export function adoptCss(shadow, css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
}

/** Wait until the page has painted what we changed (used before a capture). */
export function nextPaint(extraMs = 0) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, extraMs)));
  });
}
