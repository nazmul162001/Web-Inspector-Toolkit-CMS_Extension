<table align="center">
  <tr>
    <td bgcolor="#FFE56B" align="center">
      <strong><font color="#111827">To open 日本語 in a new tab: hold ⌘ (Mac) or Ctrl (Windows) and click 日本語.</font></strong>
    </td>
  </tr>
</table>


<p align="center">
  <strong>English</strong>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/nazmul162001/Web-Inspector-Toolkit-CMS_Extension/blob/main/README.ja.md" target="_blank" rel="noopener noreferrer">日本語</a>
</p>

# Web Inspector Toolkit

<p align="center">
  <img src="icons/icon128.png" width="72" alt="Web Inspector Toolkit" />
</p>

---

## Features

| | |
| :---: | --- |
| <mark><strong>Color Find</strong></mark> | Locate every element that uses a colour, on this page or the whole site. Type HEX, `rgb()`, CSS names, or pick a colour. |
| <mark><strong>Text Find</strong></mark> | Search any word or sentence in the text people actually read, not the HTML source. |
| <mark><strong>Telephone Number</strong></mark> | Find a phone number in any format (`080-1234-5678`, `+81 80…`, full-width digits, `tel:` links). |
| <mark><strong>Link href</strong></mark> | Find every link, button or form that points to an address (exact or contains). |
| <mark><strong>Font Find</strong></mark> | See which elements use a font family, including CSS source and `@font-face` files. |
| <mark><strong>Half / Full Width Text</strong></mark> | Find full-width numbers, letters and symbols, and mark them in red on the page. |
| <mark><strong>Inspect/Download image</strong></mark> | Hover any image, background, mask, border image or `::before` / `::after` picture and see its real pixel size vs how it is shown. |
| <mark><strong>Official Icon</strong></mark> | A library of official icons. Thumbnails are 50×50; Download saves the original file. |
| <mark><strong>Image Convert</strong></mark> | Convert PNG, JPG, WebP or SVG. Pick the original format first so the file picker only accepts that type. One file downloads directly; several files download as a zip. Quality is kept. |
| <mark><strong>Image Resize</strong></mark> | Resize one or more images. Width starts at 800px and height stays auto unless you set it. One file downloads directly; several files download as a zip. |
| <mark><strong>Remove Background</strong></mark> | Cut the subject out of a photo on this device. A wipe shows the transparent result, then you download a PNG. |
| <mark><strong>Screenshot Taker</strong></mark> | Capture the full page, the current screen, or a selected area, then mark it up.<br>• Drawing tools: pen, line, arrow, circle, rectangle, square, text<br>• Highlighter (pick a colour after you drag)<br>• Blur any area<br>• Numbered circles (click to place 1, 2, 3…)<br>• Copy to clipboard or save as PNG<br>• Optional keyboard shortcut for Select Area (works without opening the panel) |
| <mark><strong>This Page / Entire Site</strong></mark> | Search tools can scan the tab you are on, or crawl the same site in the background. |
| <mark><strong>English / 日本語</strong></mark> | Switch the whole interface. Page content is never translated. |
| <mark><strong>Dark / light mode</strong></mark> | Follows your system until you pick one. |
| <mark><strong>Private by design</strong></mark> | Scans and screenshots stay on your computer. The extension makes no network calls of its own. |

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
