# Web Inspector Toolkit

A Chrome (Manifest V3) extension that opens a native **Side Panel** with a set of page-inspection tools.
Built with plain HTML5, CSS3 and vanilla ES6+ JavaScript - no framework, no build step, no npm, no CDN.
Everything runs locally; no page content ever leaves your device.

## Features

| Tool | Status |
| --- | --- |
| **Color Find** | Available |
| Text Find, Half/Full Width Text, Image Resolution, Telephone Number, Font Find | "Coming soon" (disabled, architecture ready) |

### Color Find

Finds every element that renders a given color, on **This Page** or across the **Entire Site**.

- Input: HEX (3/4/6/8 digits), `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` and all 148 CSS color names (`red`, `green`, `blue`, `white`, `black`, `dark blue` ... case-insensitive, with autocomplete and "did you mean" hints; note CSS `green` is `#008000`, `lime` is `#00ff00`), plus a native color picker. Equivalent notations match each other: `#ffffff` = `rgb(255,255,255)` = `rgba(255,255,255,1)` = `hsl(0,0%,100%)` = `white`, but **not** `rgba(255,255,255,0.5)`.
- Scanned properties (computed from the rendered DOM): `color`, `background-color`, the four `border-*-color`, `outline-color`, `text-decoration-color`, `text-emphasis-color`, `caret-color`, `column-rule-color`, `fill`, `stroke`, `stop-color`, `flood-color`, `lighting-color`, and the individual colors inside `box-shadow` and `text-shadow`.
- Per result: element (tag, id, classes, selector, unique path), color (computed + normalized), location (page URL/title, nearest meaningful parent, section, ancestors) and CSS source (stylesheet URL, selector, property, original value, inline, CSS variable, line number).
- Actions: highlight in page, scroll to, copy HEX / selector / class names / stylesheet URL.
- Results: summary tiles, Header / Main Content / Footer / Other groups, sort (DOM order, property, tag), group by (section, property, none), tag and class filters, expandable cards, empty / loading / error states.

## Installation

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `web-inspector-toolkit` folder.
4. Pin the extension from the puzzle-piece menu.
5. Open a website and click the toolbar icon - the side panel opens on the right.

Requires Chrome 120 or newer. There is nothing to build or install.

## Usage

1. Choose a scope: **This Page** (default) or **Entire Site**. Switching scope never starts a scan.
2. Type or pick a color and press **Find**.
3. The first time on a site, Chrome asks for access to *that site only*. Accept to continue.
4. Expand a result card for details, use the eye button to highlight the element in the page.

### This Page

validate input -> normalize color -> identify the active tab -> ensure permission -> inject the content script -> scan -> aggregate -> display.
The side panel never touches the page DOM; it only exchanges messages with the service worker and the content script.

### Entire Site

A real same-origin crawl of the **rendered** DOM (not downloaded HTML):

- Starts from the page you are on (scanned in your own tab) and follows internal links breadth-first.
- **Page loading** (Crawl options) has two modes:
  - **Invisible - no tabs (default).** No tab or window is ever opened. Each page is downloaded (with your session cookies) and rendered in a hidden offscreen document: scripts, `<noscript>`, frames and meta refresh are removed, every linked stylesheet (including `@import`) is downloaded and inlined with its original URL, and the result is loaded into a sandboxed iframe (no `allow-scripts`, CSP blocking images, fonts, media and frames). The same scanner as for live pages then runs on it. The HTML and CSS are exactly what the server sent; **JavaScript is not executed**, so content or styles added by scripts are not seen.
  - **Temporary background tabs.** Pages open in short-lived, inactive, muted tabs - your active tab is never switched - so their scripts run; the tabs are always closed afterwards (also after errors, cancel, or a service-worker restart).
- The page you are on is always scanned live in your own tab (its exact current state).
- Defaults: max 50 pages, 3 concurrent pages, 20 s page timeout, 1 retry for transient failures. All configurable under *Crawl options*.
- URLs are normalized and de-duplicated: fragments, credentials and tracking parameters (`utm_*`, `gclid`, `fbclid` ...) are removed, query parameters are sorted, trailing slashes are ignored. External domains, non-http(s) schemes (`mailto:`, `tel:`, `javascript:` ...), downloads/assets and logout/delete-style links are skipped.
- **Coverage is reported honestly.** Pages that failed (HTTP error, timeout, redirect off-site, not HTML, no access) are listed separately, pages not reached because of the limit are counted, and a cancelled scan is labeled partial. Full coverage is only claimed when every discovered page was scanned.
- Cancel at any time with the **Cancel** button; closing the panel also cancels.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Show the UI in Chrome's native side panel. |
| `activeTab` | Lets the toolbar click inspect the current page without a prompt where Chrome allows it. It is temporary, so it is not relied on alone. |
| `scripting` | Inject the scanner into the page on demand (there are no always-on content scripts). |
| `tabs` | Read the active tab's URL/title, and open/close the temporary tabs when you choose that crawl mode. |
| `offscreen` | Create the hidden document that renders pages of a site crawl invisibly (no tabs). It exists only while a crawl runs. |
| `storage` | Remember your settings and the ids of temporary tabs (to clean up orphans). |
| optional `http://*/*`, `https://*/*` | Requested **at runtime for one origin only**, when you click Find, so the panel can keep scanning and the crawl can open background tabs on that site. |

No data is sent anywhere; there are no network calls made by the extension itself.

## Project structure

```
manifest.json
background/background.js        service worker: scan orchestration, tab context, cancellation
content/                        injected on demand
  content.js                    classic loader -> imports content-main.js (web accessible)
  content-main.js               message handlers (ping / scan / cancel / highlight)
  dom-scanner.js                batch TreeWalker scan, time-sliced
  style-scanner.js              computed-style color extraction (gates, inheritance filter)
  stylesheet-scanner.js         CSSOM index + source resolution (verified attribution only)
  css-utils.js                  declaration parsing, specificity, line lookup
  element-info.js               selectors, paths, sections, ancestors
  element-highlighter.js        shadow-DOM overlay, auto-removed
services/                       pure/shared logic
  color-normalizer.js           parsing + canonical RGBA (see "Color precision")
  color-spaces.js, color-matcher.js, url-normalizer.js
  message-service.js            typed messaging, request ids, timeouts, stale-response checks
  page-scan-service.js, site-crawler.js, temp-tab-manager.js, settings-service.js
  background-renderer.js        invisible page renderer (runs in the offscreen document)
  offscreen-scanner.js          service-worker side: owns the offscreen document, scans URLs through it
offscreen/                      hidden document used by the invisible crawl mode
shared/                         constants, helpers, validators, named colors
sidepanel/                      UI (HTML/CSS/JS), components, lazy-loaded features
  features/registry.js          add a tool here
  features/color-find/          the Color Find feature
tests/                          browser test runner, suites and fixtures
icons/
```

### Adding a tool

Add an entry to `FEATURES` in `shared/constants.js`, create `sidepanel/features/<id>/`, export `createFeature(ctx)` returning `{ mount, unmount, onScopeChange, onTabContextChange }`, and register a loader in `sidepanel/features/registry.js`.

### Messaging

One `chrome.runtime.onMessage` listener per context. Requests are `{ __wit, id, type, payload, ts }`, responses `{ __wit, requestId, ok, data | error }`. Every request has a timeout, responses are matched by id (stale ones are ignored), errors are classified into codes (`PERMISSION_DENIED`, `RESTRICTED_PAGE`, `TIMEOUT`, `CANCELLED` ...), and a long-lived port with a heartbeat keeps the service worker alive during a scan and cancels it when the panel closes.

### Color precision

Every color is reduced to canonical **RGBA with four integer channels 0-255** (alpha = `round(alpha * 255)`). Floating-point math is rounded to 6 decimals before the integer rounding to avoid `49.99999` artifacts, out-of-range values are clamped, and all fully transparent colors compare equal. Matching is exact by default; the optional **Near** mode allows +-4 per channel.

## Testing

Tests run in the browser with a tiny built-in runner (no framework).

```
python3 -m http.server 8765
# open http://localhost:8765/tests/color-normalizer.test.html
```

`?filter=<suite name>` runs a single suite. Results are shown on the page and exposed as `window.__TEST_RESULTS__`.
Suites: color parsing (including parity checks against Chrome's own color engine), color matching, CSS utils, DOM scanning (background, text, border, inline, variables, SVG, shadows, multiple properties, no-class elements, sources and line numbers, cross-origin sheets), URL normalization, results/validators, site crawler (with injected fake tabs: dedupe, limits, concurrency, failures, retries, cancel), DOM helpers.

A static fixture site for manual crawl testing is in `tests/fixtures/site/` (internal links, a logout link, a 404, external/mailto/tel/pdf links, `@import`, CSS variables, `@media`, `@layer`).

## Limitations

- Pages Chrome protects cannot be inspected: `chrome://`, the Chrome Web Store, other extensions' pages. Local `file://` pages need "Allow access to file URLs" for the extension and support This Page only.
- Not inspected: pseudo-elements (`::before`/`::after`), images, `<canvas>`, closed shadow roots, and cross-origin iframes.
- Cross-origin stylesheets that block `cssRules` cannot be read. Their colors are still found from computed styles, but no source is shown (the panel reports how many sheets were unreadable). Source details and line numbers are only shown when they can be **verified**; a line number appears only when the declaration is found exactly once in the stylesheet text.
- `box-shadow`/`text-shadow`/CSS-variable attribution relies on the browser's computed values; the "original value" is the CSSOM serialization (colors are serialized as `rgb()`).
- Entire Site, invisible mode, reads HTML + CSS only (no scripts); use the tab mode for script-heavy sites. In either mode, content that loads lazily on scroll or after interaction may not appear, and sites requiring a login only work if your browser session is logged in. The crawl is bounded (default 50 pages) and never submits forms; links that look like logout/delete actions are skipped.
- Chrome offers no API to set the side panel width. Resize it by dragging its edge; the grip on the left is only a hint.

## Roadmap

Text Find, Half/Full Width Text, Image Resolution, Telephone Number, Font Find, a settings page, export of results (CSV/JSON).
