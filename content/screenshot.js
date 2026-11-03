/**
 * Screenshot Taker: runs one screenshot from start to finish in the page.
 *
 *   Select Area  -> drag a rectangle -> move it -> capture -> editor
 *   Current Screen ->                   capture -> editor
 *   Full Page    -> scroll + stitch  -> editor
 *
 * The side panel only starts it and shows what is going on (events); the work
 * and the pictures stay in the page.
 */

import { MSG } from '../shared/constants.js';
import { broadcast } from '../services/message-service.js';
import { normalizeLanguage } from '../services/i18n.js';
import { CAPTURE_ERR, CaptureError, captureArea, captureCurrent, captureFullPage } from './screenshot-capture.js';
import { openEditor } from './screenshot-editor.js';
import { selectArea } from './screenshot-selector.js';
import { nextPaint } from './screenshot-ui.js';

export const SHOT_MODES = Object.freeze(['area', 'current', 'full']);

/** The run in progress (only one at a time): { job, stopSelector, editor, finished }. */
let session = null;

const emit = (event) => broadcast(MSG.SCREENSHOT_EVENT, event);

function end(current, event) {
  if (session !== current || current.finished) return;
  current.finished = true;
  session = null;
  if (!current.silent) emit(event); // a run that was replaced must not announce its end: it would stop the new one
}

/** Close whatever is open and forget the run, without telling the panel twice. */
function teardown(current, reason) {
  current.silent = reason === 'replaced';
  current.job.cancelled = true;
  current.stopSelector?.();
  if (current.editor && !current.editor.isClosed) {
    current.editor.close(); // runs onClose -> end(); the reason is reported below when still open
  }
  end(current, { state: 'cancelled', reason });
}

/**
 * Start a screenshot. A run that is still going is replaced.
 * @param {{ mode: 'area'|'current'|'full', language?: string, shadowMode?: 'closed'|'open', deps?: object }} options
 */
export function startScreenshot({ mode, language, shadowMode, deps } = {}) {
  if (!SHOT_MODES.includes(mode)) throw new Error(`Unknown screenshot mode "${mode}".`);
  if (session) teardown(session, 'replaced');

  const lang = normalizeLanguage(language);
  const current = {
    finished: false,
    editor: null,
    stopSelector: null,
    job: {
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    },
  };
  session = current;
  run(current, { mode, language: lang, shadowMode, deps }).catch((error) => {
    if (error instanceof CaptureError && error.code === CAPTURE_ERR.CANCELLED) {
      end(current, { state: 'cancelled', reason: 'user' });
    } else {
      end(current, { state: 'error', code: error?.code || 'UNKNOWN', message: error?.message || 'The screenshot could not be taken.' });
    }
  });
  return { started: true, mode };
}

async function run(current, { mode, language, shadowMode, deps }) {
  let rect = null;

  if (mode === 'area') {
    emit({ state: 'selecting' });
    const selector = selectArea({ language, shadowMode });
    current.stopSelector = selector.cancel;
    const choice = await selector.promise;
    current.stopSelector = null;
    if (!choice || current.job.cancelled) throw new CaptureError(CAPTURE_ERR.CANCELLED, 'Cancelled.');
    rect = { x: choice.x, y: choice.y, w: choice.w, h: choice.h };
    current.choice = choice;
    await nextPaint(60); // the selection overlay must be gone from the page before the photo
  }

  emit({ state: 'capturing', mode });
  let shot;
  if (mode === 'area') shot = await captureArea(current.job, rect);
  else if (mode === 'current') shot = await captureCurrent(current.job);
  else shot = await captureFullPage(current.job, (progress) => emit({ state: 'capturing', mode, progress }));
  if (current.job.cancelled || session !== current) throw new CaptureError(CAPTURE_ERR.CANCELLED, 'Cancelled.');

  current.editor = openEditor({
    canvas: shot.canvas,
    pixelRatio: shot.pixelRatio,
    mode: mode === 'area' ? 'area' : mode === 'full' ? 'scroll' : 'fit',
    rect,
    language,
    pageUrl: location.href,
    shadowMode,
    deps,
    onClose: () => end(current, { state: 'done' }),
  });
  emit({ state: 'editing', width: shot.canvas.width, height: shot.canvas.height });
  if (shot.notes.length) current.editor.notify(shot.notes[0], 'error', 6000);
  if (current.choice?.tool) current.editor.setTool(current.choice.tool);
  if (current.choice?.action === 'copy') current.editor.copy();
  if (current.choice?.action === 'save') current.editor.save();
}

/** The panel asked to stop (or started another tool). An open editor is left so drawings are not lost, unless `force`. */
export function cancelScreenshot({ force = false } = {}) {
  if (!session) return { cancelled: false };
  if (!force && session.editor && !session.editor.isClosed) return { cancelled: false, editing: true };
  teardown(session, 'panel');
  return { cancelled: true };
}

/** Copy or save from the side panel (⌘C / ⌘S) while the editor is open. */
export function commandScreenshot(action) {
  const editor = session?.editor;
  if (!editor || editor.isClosed) return { ok: false };
  if (action === 'copy') return Promise.resolve(editor.copy()).then(() => ({ ok: true }));
  if (action === 'save') return Promise.resolve(editor.save()).then(() => ({ ok: true }));
  return { ok: false };
}

/** The test hook: the editor of the run in progress. */
export function currentEditor() {
  return session?.editor || null;
}
