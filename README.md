# Web Inspector Toolkit

A Chrome side-panel toolkit for inspecting real websites — colours, text, links, fonts, images and screenshots — **entirely on your device**. Nothing is uploaded.

<p align="center">
  <img src="icons/icon128.png" width="72" alt="Web Inspector Toolkit" />
</p>

<p align="center">
  <strong>Chrome 123+</strong> &nbsp;·&nbsp; <strong>No build step</strong> &nbsp;·&nbsp; <strong>English / 日本語</strong> &nbsp;·&nbsp; <strong>Dark & light</strong>
</p>

---

## Features

- **Color Find** — locate every element that uses a colour, on this page or the whole site. Type HEX, `rgb()`, CSS names, or pick a colour.
- **Text Find** — search any word or sentence in the text people actually read, not the HTML source.
- **Telephone Number** — find a phone number in any format (`080-1234-5678`, `+81 80…`, full-width digits, `tel:` links).
- **Link href** — find every link, button or form that points to an address (exact or contains).
- **Font Find** — see which elements use a font family, including CSS source and `@font-face` files.
- **Half / Full Width Text** — find full-width numbers, letters and symbols, and mark them in red on the page.
- **Image Resolution** — hover any image or background and see its real pixel size vs how it is shown.
- **Screenshot Taker** — capture the full page, the current screen, or a selected area, then mark it up.
  - Drawing tools: pen, line, arrow, circle, rectangle, square, text
  - Highlighter (pick a colour after you drag)
  - Blur any area
  - Numbered circles (click to place 1, 2, 3…)
  - Copy to clipboard or save as PNG
  - Optional keyboard shortcut for Select Area (works without opening the panel)
- **This Page / Entire Site** — search tools can scan the tab you are on, or crawl the same site in the background.
- **English / 日本語** — switch the whole interface; page content is never translated.
- **Dark / light mode** — follows your system until you pick one.
- **Private by design** — scans and screenshots stay on your computer. The extension makes no network calls of its own.

---

## Install in Chrome

Follow these steps once. After that, click the extension icon on any website to open the side panel.

<br>

### 1. Download the ZIP

Open this repository on GitHub.

1. Click the green **<> Code** button (top right).
2. Click **Download ZIP**.

<p align="center">
  <img src="docs/setup/01-download-zip.png" width="920" alt="GitHub Code menu with Download ZIP marked" />
</p>

<p align="center"><sub>Code → Download ZIP</sub></p>

<br>

### 2. Unzip the file

Find `Web-Inspector-Toolkit-CMS_Extension-main.zip` in your Downloads folder and unzip it.

- **Mac** — double-click the ZIP. A folder with the same name appears next to it.
- **Windows** — right-click the ZIP → **Extract All…**

You will load **that unzipped folder** in Chrome — the one that contains `manifest.json`.

<br>

### 3. Open Manage extensions

1. Open **Google Chrome**.
2. Click the **⋮** menu (top right).
3. Hover **Extensions**.
4. Click **Manage extensions**.

<p align="center">
  <img src="docs/setup/03-manage-extensions.png" width="920" alt="Chrome menu: Extensions → Manage extensions" />
</p>

<p align="center"><sub>⋮ → Extensions → Manage extensions</sub></p>

<br>

### 4. Turn on Developer mode

On the Extensions page, turn on **Developer mode** in the **top-right corner**.

<p align="center">
  <img src="docs/setup/04-developer-mode.jpg" width="920" alt="Developer mode toggle in the top-right of chrome://extensions" />
</p>

<p align="center"><sub>Enable Developer mode</sub></p>

<br>

### 5. Load the unpacked folder

1. Click **Load unpacked** (top left).

<p align="center">
  <img src="docs/setup/05-load-unpacked.jpg" width="920" alt="Load unpacked button on the Extensions page" />
</p>

<p align="center"><sub>Load unpacked</sub></p>

2. Select the unzipped project folder (it must contain `manifest.json`, `background`, `content`, `sidepanel`…).
3. Click **Select**.

<p align="center">
  <img src="docs/setup/06-select-folder.jpg" width="920" alt="File picker showing the unzipped extension folder" />
</p>

<p align="center"><sub>Select the unzipped folder, then Select</sub></p>

**Web Inspector Toolkit** now appears in your extension list.

<br>

### 6. Allow it in Incognito (optional)

To use the toolkit in Incognito windows:

1. On the Extensions page, click **Details** on the Web Inspector Toolkit card.

<p align="center">
  <img src="docs/setup/07-details.jpg" width="920" alt="Details button on the Web Inspector Toolkit card" />
</p>

<p align="center"><sub>Details</sub></p>

2. Scroll down and turn on **Allow in Incognito**.

<p align="center">
  <img src="docs/setup/08-allow-incognito.jpg" width="920" alt="Allow in Incognito toggle on the extension details page" />
</p>

<p align="center"><sub>Allow in Incognito</sub></p>

---

## That’s all

Open any website, click the **Web Inspector Toolkit** icon in the Chrome toolbar, and the side panel opens on the right.

If you do not see the icon: click the puzzle-piece (extensions) button in the toolbar, then pin **Web Inspector Toolkit**.

The first time a tool needs page access, Chrome will ask once — accept, then continue.
