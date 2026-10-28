# Web Inspector Toolkit

A Chrome (Manifest V3) extension that opens a native **Side Panel** with a set of page-inspection tools.
Built with plain HTML5, CSS3 and vanilla ES6+ JavaScript - no framework, no build step, no npm, no CDN.
Everything runs locally; no page content ever leaves your device.

## Features

| Tool | Status |
| --- | --- |
| **Color Find** | Available |
| **Text Find** | Available |
| **Telephone Number** | Available |
| **Link href** | Available |
| **Font Find** | Available |
| **Half/Full Width Text** | Available |
| **Image Resolution** | Available (hover tool, not a search) |

### Color Find

Finds every element that renders a given color, on **This Page** or across the **Entire Site**.

- Input: HEX (3/4/6/8 digits), `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` and all 148 CSS color names (`red`, `green`, `blue`, `white`, `black`, `dark blue` ... case-insensitive, with autocomplete and "did you mean" hints; note CSS `green` is `#008000`, `lime` is `#00ff00`), plus a native color picker. Equivalent notations match each other: `#ffffff` = `rgb(255,255,255)` = `rgba(255,255,255,1)` = `hsl(0,0%,100%)` = `white`, but **not** `rgba(255,255,255,0.5)`.
- Scanned properties (computed from the rendered DOM): `color`, `background-color`, the four `border-*-color`, `outline-color`, `text-decoration-color`, `text-emphasis-color`, `caret-color`, `column-rule-color`, `fill`, `stroke`, `stop-color`, `flood-color`, `lighting-color`, and the individual colors inside `box-shadow` and `text-shadow`.
- Per result: element (tag, id, classes, selector, unique path), color (computed + normalized), location (page URL/title, nearest meaningful parent, section, ancestors) and CSS source (stylesheet URL, selector, property, original value, inline, CSS variable, line number).
- Actions: highlight in page, scroll to, copy HEX / selector / class names / stylesheet URL.
- Results: summary tiles, Header / Main Content / Footer / Other groups, sort (DOM order, property, tag), group by (section, property, none), tag and class filters, expandable cards, empty / loading / error states.

### Text Find

Type any word or sentence and see every place it appears, on **This Page** or across the **Entire Site** (same invisible, streaming crawl as Color Find).

- Searches the text people read, not the HTML source. Text split across inline tags (`Hello <b>big</b> world`) is found as one phrase; text in different blocks is never joined; a `<br>` counts as a space. Line breaks, tabs, non-breaking and ideographic spaces are collapsed on both sides. `<script>`, `<style>`, `<noscript>`, `<template>` and furigana (`<rt>`) are ignored.
- Options: **Match case** (off by default), **Whole word** (only applies to scripts that use spaces; Japanese, Chinese, Korean and Thai are matched as written), **Also search alt, title, placeholder…** (`alt`, `title`, `placeholder`, `aria-label`, button values), **Visible text only** (needs layout: on other pages the stylesheets are downloaded to decide what is hidden, so it is slower).
- The query is matched literally (no regular expressions) and limited to 500 characters.
- Per result: the match highlighted inside its surrounding text, where it was found (text or attribute), the element (tag, id, classes, selector, unique path) and its location (page, parent, section, ancestors).
- Actions: highlight in page, scroll to, copy text / selector / class names. Results use the same summary, grouping (section, tag, none), sorting, filters and live "Still checking the site" banner as Color Find.
- Fast by design: for other pages of a site only the HTML is downloaded (no stylesheets, no hidden frame) and searched as an inert document - nothing runs and nothing else loads.

### Telephone Number

Type a phone number in any format and see every place it appears, on **This Page** or across the **Entire Site**, with the same results, eye (highlight) shortcut, grouping and live crawl as Text Find.

- Matching is by **digits only**, so `080-1234-5678`, `08012345678`, `080 1234 5678`, `080.1234.5678`, `(080) 1234-5678` and full-width `０８０－１２３４－５６７８` all find each other. Up to 3 separator characters (space, `-`, `ー`, `.`, parentheses) are allowed between digits; any other character (letter, comma, `/`) ends the number. Digits split across tags (`080<span>-</span>1234`) are found.
- **Exact number** (on by default): the number must not be part of a longer number, so `1234-5678` is not reported inside `080-1234-5678` and `080-1234-5678` is not reported inside an ID like `080-1234-56789`. A space ends a number (`03-1234-5678 080-1111-2222` are two numbers). Turn it off to find partial numbers.
- **Treat +81 80... and 080... as the same number** (on by default): `+81 80-1234-5678`, `+81 (0)80-1234-5678` and `080-1234-5678` match each other; `+1 (555) 555-0123` matches `555-555-0123`. The country code (1-3 digits) is not checked against a list, so a different country code with the same national digits also matches.
- **Also find tel: links** (on by default): the number inside `href="tel:..."` / `callto:` is found even when the visible text is "Call us". A link whose visible text already matched is reported once.
- Input must have 4-15 digits; letters or other symbols show a clear message.

### Link href

Type any address and see every link, anchor or button that points to it, on **This Page** or across the **Entire Site** (same invisible, streaming crawl and results as the other tools, with the eye shortcut).

- Examples: `https://www.line.me/en/`, `https://www.instagram.com/?locale=ja_%C3%A5JP`, `line.me/en/`, `/contact`, `mailto:hello@example.com`.
- Relative links are resolved against the page they are on, so `<a href="/en/">` on `https://www.line.me` counts as `https://www.line.me/en/`. The result shows the link as written, the full address, the link text (or aria-label / title / image alt) and the element.
- **Exact link** (on by default) compares whole addresses. Ignored because they do not change where a link goes: case of scheme and host, default port, order of query parameters, `%XX` upper/lower case, readable vs escaped characters (`å` = `%C3%A5`), a trailing slash on a path and the `#fragment` (unless you type one). Different path, different query value or an extra parameter are different addresses. A link that is only a `#fragment` is not matched by a full address. A typed path (`/contact`) only matches links to that path on the page's own site; `#top`, `?page=2` or `about.html` are compared with the link as written.
- **Exact link** off: every link that merely contains the typed text matches (case-insensitive, escaped or readable), for example `instagram.com` finds all Instagram links.
- **Ignore http/https and www** (on by default): `http://line.me/en/` matches `https://www.line.me/en/`. A typed address without a scheme always behaves this way.
- **Also buttons, forms and click handlers** (on by default): besides `href` of anchors, image maps, SVG links and `<link>` elements, it reads `formaction`, form `action`, `data-href` / `data-url` / `data-link` / `data-link-url` / `data-target-url` / `data-redirect-url` and addresses written in `onclick` (`location.href='...'`, `window.open('...')`, absolute URLs).
- Links that scripts add or build later, `<iframe>` sources and links drawn inside images are not found.

### Font Find

Type a font family and see every element that uses it, on **This Page** or across the **Entire Site** (same invisible, streaming crawl and results as the other tools, with the eye shortcut).

- Input: write it any way. A name (`Noto Sans JP`), a quoted name, a list (`"Noto Sans JP", arial, sans-serif`) or a CSS line pasted from a stylesheet or DevTools - `font-family: "Noto Sans JP", arial, sans-serif;`, indented, over several lines, with `!important`, the `font:` shorthand, or inside a whole `.title { ... }` rule or `style="..."` attribute. The font names are read out of it, and a line under the input shows what was understood and what will be searched. Quotes, capitals, extra spaces and full-width letters do not matter. A font that comes from a CSS variable (`var(--x)`) cannot be read - type the name instead.
- **Which fonts from what you typed**: *the first font only* (default - pasting a whole list finds "the font"; the rest are fallbacks), *any of the fonts*, or *all of the fonts, in that order* (other fonts may sit between them).
- What is searched is the element's computed `font-family` list (for example `"Shippori Mincho", "Noto Sans JP", sans-serif`), so the cascade, inheritance, the `font` shorthand and CSS variables are already applied by the browser.
- **Exact match** (on by default): `Roboto` does not find `Roboto Slab`. Off (partial match): any name containing the text matches (`Noto` finds `Noto Sans JP` and `Noto Serif`).
- **Only where it is the first choice**: the font must be the first in the element's list, not a fallback.
- **Also elements that inherit it**: by default an element is reported where the font is applied (its list differs from its parent's). This also lists every element that inherits the list and has text of its own.
- Per result: the font list with the searched font marked, its place in the list (first choice or fallback), whether it is set on the element or inherited, the web font behind it (the `@font-face` files with format and weight, or a Google Fonts stylesheet linked on the page; "generic family" for `serif`, `monospace` ...), the element, the location and the **CSS source** (stylesheet, selector, declaration, CSS variable, line number, "inherited from").
- The CSS source follows the same truthfulness rules as Color Find: only the winning declaration (by `!important`, inline, layer, specificity and order) can be the source, and only when it really lists the font after variables are resolved. Otherwise the card says it could not be verified.
- It reports the font the CSS **asks for**. A page cannot see whether the visitor's browser had it installed, so the tool never claims which font was actually drawn. A font with no `@font-face` and no Google Fonts link is described as "installed on the visitor's device, or from a source this page does not show".

### Half/Full Width Text

Finds full-width characters in the text of a page or of the whole site, and marks them in red on the page.

- Tick the kinds of full-width characters to find (only parentheses are ticked at first, and there are no text fields): numbers (`０１２`), letters (`ＡＢｃ`), parentheses and brackets (`（）［］`), colons and semicolons (`：；`), percent (`％`), question and exclamation marks (`？！`), commas and periods (`，．`), hyphens, slashes, `￥` and other symbols, and spaces (the ideographic space `U+3000`). "Select all" / "Select none" are provided; at least one kind must be ticked.
- A result is one **run** of characters: `２０２４` is one result, not four; `０３－１２３４` joins a number, a hyphen and numbers.
- Normal Japanese punctuation (`、。「」【】ー`) is not full-width text in this sense (it has no half-width twin) and is never reported.
- Per result: the characters in context (white on red), the kinds, the character codes (`U+FF11`), the same text in the other form (`２０２４` -> `2024`), and the element, location and selector like the other tools. The eye button scrolls to and highlights the element.
- **Marks on the page**: the found characters are marked white on red, like the bookmarklet this replaces, but without rewriting the page. It uses the CSS Custom Highlight API (Chrome 105+), so no tags are inserted, scripts, forms and layout keep working, and "Remove marks from the page" (or closing the tool) clears them. Untick "Mark the characters on the page" to only list the results. In Entire Site, the page you are viewing is marked; opening a result on another page marks that page.
- Only text is searched (not scripts, styles, attributes, images or canvas). Entire Site reads the other pages as HTML without running their scripts.

### Image Resolution

Not a search: open the tool, then move the pointer over any image on the page and a card next to the pointer shows its size. Switch it off with the toggle, with **Esc** on the page, or by choosing another tool (it also stops when the panel closes).

- **Images it reads**: `<img>` and `<picture>`, `<input type="image">`, SVG `<image>`, and **CSS background images** (hero banners, patterns, sprites).
- **Through whatever is on top**: the whole stack of elements under the pointer is checked (`elementsFromPoint`, including open shadow roots), so text, links, buttons and transparent layers over an image do not hide it. If an icon sits on a banner, the icon (the topmost picture) is shown; move onto the banner to see the banner.
- **Backgrounds are tested where they are really painted**: `background-size` (`cover`, `contain`, lengths, percentages), `background-position` (including `calc()` offsets), `background-repeat` (`repeat`, `space`, `round`), `background-origin`, `background-clip` and several layers are all applied, so the empty part of a box that does not repeat its picture is not reported, and for a repeating pattern the copy under the pointer is outlined.
- **The card shows**: the image's **actual pixel size** (big, the size of the file, like DevTools' "Intrinsic size"), the size it is displayed at on the page, how they compare ("Shown at its own size", "2× image, sharp on high-density screens", "Enlarged 1.5× - can look soft", "Shrunk 3.4×"), aspect ratio, format and file size when the browser reports it, alt text, the file name, a small preview, and for backgrounds the size of the element box. A frame with the size is drawn around the picture.
- **Side panel**: the last image stays in the panel with the same details, a **Copy size** (the actual size, `800x533`) and a **Copy address** button, so it can be used after the pointer moves on. Options: include background images, outline, preview (remembered).
- It follows the active tab and starts again after a reload; where the site is not yet allowed, an **Allow access** button asks once. Nothing on the page is modified; the card is drawn in a closed shadow root that ignores the pointer.

### Language (English / 日本語)

The switch at the top right of the panel (**EN** | **日本語**) changes the whole interface between English (the default) and Japanese, in both directions, and the choice is remembered.

- Everything the extension writes is translated: tool names and options, hints, results, counts, notices, errors, and the card that Image Resolution draws on the page (it follows the panel's language at once).
- What comes from the website is never translated: the page's own text, URLs, selectors, class and tag names, CSS values, page titles and file names.
- Switching back to English restores the exact original text, without rebuilding anything, so results, typed text and the scroll position stay as they are.
- A rare message that has no Japanese yet is simply shown in English.
- The extension name and description in `chrome://extensions` are not localised.

### Dark / light mode

The sun / moon button left of the language switch changes the panel between dark and light. Until you press it the panel follows the system setting of Chrome / your computer; after that your choice is kept. The button shows where it leads (a sun while dark, a moon while light). Colours are set in one place (`:root` in `sidepanel/sidepanel.css`, with `light-dark()`), which is why the extension needs Chrome 123 or newer. The card Image Resolution draws on the page stays dark so it reads on any website.

## Installation

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `web-inspector-toolkit` folder.
4. Pin the extension from the puzzle-piece menu.
5. Open a website and click the toolbar icon - the side panel opens on the right.

Requires Chrome 123 or newer. There is nothing to build or install.

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
- **Checks every internal page, invisibly - no options to set.** No tab or window is ever opened. Each page is downloaded (with your session cookies) and rendered in a hidden offscreen document: scripts, `<noscript>`, frames and meta refresh are removed, every linked stylesheet (including `@import`) is downloaded and inlined with its original URL, and the result is loaded into a sandboxed iframe (no `allow-scripts`, CSP blocking images, fonts, media and frames). The same scanner as for live pages then runs on it. The HTML and CSS are exactly what the server sent; **JavaScript is not executed**, so content or styles added only by scripts on those pages are not seen. (The service worker can still use short-lived background tabs for a script-running crawl through its internal `mode: 'tabs'` option; the UI no longer exposes it.)
- **Fast.** About 12 pages are fetched in parallel, stylesheets shared between pages are indexed once, and **results stream into the panel as each page finishes** - the first matches (your current page) show in well under a second, and the list keeps growing with a "Still checking the site" banner until the crawl completes. Total time is dominated by how fast the website's server answers (measured on the test site: 79 pages in about 8 seconds, first results in about 0.5 s).
- The page you are on is always scanned live in your own tab (its exact current state).
- Internal defaults: 12 parallel pages, a 2000-page safety cap, 20 s page timeout, 1 retry for transient failures.
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
  text-scanner.js               shared flow scan (inline joining, attributes, links) + Text Find
  phone-scanner.js              Telephone Number scan (uses the flow scan)
  href-scanner.js               Link href scan (href, formaction, data-href, onclick)
  font-scanner.js, font-source.js  Font Find scan and its CSS source resolver
  width-scanner.js, width-marks.js  Half/Full Width Text scan and the red marks (CSS Custom Highlight API)
  image-inspector.js            Image Resolution hover inspector (card, outline, background painting hit test)
  run-scan.js                   picks the color, text, phone, link, font or width scanner for a target
  element-registry.js           element ids for highlight requests
services/                       pure/shared logic
  color-normalizer.js           parsing + canonical RGBA (see "Color precision")
  color-spaces.js, color-matcher.js, url-normalizer.js
  text-matcher.js               Text Find query rules (case folding, whitespace, whole word)
  phone-matcher.js              Telephone Number rules (digits, separators, exact, +81/0)
  href-matcher.js               Link href rules (resolving, normalizing, exact / contains)
  font-matcher.js               Font Find rules (font lists, names, @font-face / Google Fonts parsing)
  width-matcher.js              Half/Full Width Text rules (kinds of characters, runs, conversion)
  image-geometry.js             Image Resolution maths (background size / position / repeat, ratio, wording)
  theme.js                      dark / light / system theme helpers
  i18n.js, i18n-ja.js           interface language: translate() and the English -> Japanese dictionary and patterns
  message-service.js            typed messaging, request ids, timeouts, stale-response checks
  page-scan-service.js, site-crawler.js, temp-tab-manager.js, settings-service.js
  background-renderer.js        invisible page renderer (runs in the offscreen document)
  offscreen-scanner.js          service-worker side: owns the offscreen document, scans URLs through it
offscreen/                      hidden document used by the invisible crawl mode
shared/                         constants, helpers, validators, named colors
sidepanel/                      UI (HTML/CSS/JS), components, lazy-loaded features
  i18n-dom.js                   translates the panel in place (remembers the English original of every text)
  features/registry.js          add a tool here
  features/color-find/          the Color Find feature
  features/text-find/           the Text Find feature
  features/telephone/           the Telephone Number feature
  features/link-href/           the Link href feature
  features/font-find/           the Font Find feature
  features/width-text/          the Half/Full Width Text feature
  features/image-resolution/    the Image Resolution tool
  features/search-feature.js    shared controller for the search tools (Text Find, Telephone, Link href, Font Find, Half/Full Width Text)
  features/scan-ui.js           status block, error text and live results shared by the tools
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
Suites: color parsing (including parity checks against Chrome's own color engine), color matching, CSS utils, DOM scanning (background, text, border, inline, variables, SVG, shadows, multiple properties, no-class elements, sources and line numbers, cross-origin sheets), URL normalization, results/validators, site crawler (with injected fake tabs: dedupe, limits, concurrency, failures, retries, cancel), DOM helpers, Text Find, Telephone Number, Link href, Font Find and Half/Full Width Text matching/scanning (formats, exact mode, +81/0, split tags, tel: links, address normalizing, buttons and forms, font lists, place in the list, @font-face files, CSS source, invisible renderer, character kinds, runs, conversion, red marks that leave the DOM untouched), Image Resolution (CSS background layout, finding images under text and overlays, shadow roots, the card), the English / Japanese language switch (translation, page data left alone, exact restore to English, the header switch) and the dark / light switch.

A static fixture site for manual crawl testing is in `tests/fixtures/site/` (internal links, a logout link, a 404, external/mailto/tel/pdf links, `@import`, CSS variables, `@media`, `@layer`).

## Limitations

- Pages Chrome protects cannot be inspected: `chrome://`, the Chrome Web Store, other extensions' pages. Local `file://` pages need "Allow access to file URLs" for the extension and support This Page only.
- Not inspected: pseudo-elements (`::before`/`::after`), images, `<canvas>`, closed shadow roots, and cross-origin iframes.
- Cross-origin stylesheets that block `cssRules` cannot be read. Their colors are still found from computed styles, but no source is shown (the panel reports how many sheets were unreadable). Source details and line numbers are only shown when they can be **verified**; a line number appears only when the declaration is found exactly once in the stylesheet text.
- `box-shadow`/`text-shadow`/CSS-variable attribution relies on the browser's computed values; the "original value" is the CSSOM serialization (colors are serialized as `rgb()`).
- Entire Site, invisible mode, reads HTML + CSS only (no scripts); colors that only scripts add on other pages are not included. Content that loads lazily on scroll or after interaction may not appear, and sites requiring a login only work if your browser session is logged in. The crawl is bounded by a 2000-page safety cap and never submits forms; links that look like logout/delete actions are skipped.
- Text Find does not read text inside images, `<canvas>`, closed shadow roots or cross-origin iframes, and not text that Chrome translates or scripts change after the page was read (it searches the page as it currently is, so a page Chrome has auto-translated is searched in the translated language). On other pages of a site, text added only by JavaScript is not seen.
- Telephone Number does not read numbers drawn inside images or `<canvas>`, closed shadow roots or cross-origin iframes, and on other pages of a site not numbers that only scripts add. Numbers written as words are not recognised.
- Link href reads the links in the HTML of each page. Links built by scripts, inside images, closed shadow roots or cross-origin iframes are not found, and only `onclick` handlers written as attributes are read (not `addEventListener`).
- Font Find reads the CSS, not the pixels: it cannot tell whether a font was really installed or loaded for a visitor, and fonts set by scripts after load, or inside images, canvas, closed shadow roots and cross-origin iframes, are not found. Stylesheets that block `cssRules` (cross-origin) hide their rules, so a source may be unavailable for them (the panel says how many); Google Fonts stylesheets are still recognised from their `family=` address.
- Half/Full Width Text searches text nodes only. Marking needs Chrome 105+ (the list of results works without it), only the page you are viewing is marked while searching,. Text Chrome has translated is searched as it currently is.
- Image Resolution looks at the top page only: images inside iframes are not inspected. CSS pictures in `::before`/`::after`, `border-image`, `mask-image`, `<video>` posters and `<canvas>` are not reported. For `<img>` the displayed size is the element's content box (with `object-fit` the picture itself may be drawn smaller or cropped). File size is shown only when the browser exposes it for that image (same-origin or CORS-enabled).
- Chrome offers no API to set the side panel width. Resize it by dragging its edge; the grip on the left is only a hint.

## Roadmap

a settings page (the gear icon was replaced by the language switch), export of results (CSV/JSON).
