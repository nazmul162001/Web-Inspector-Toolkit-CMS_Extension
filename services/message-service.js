/**
 * Centralized messaging for every extension context (side panel, service
 * worker, content scripts).
 *
 * All `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` /
 * `chrome.runtime.onMessage` usage in the project lives in this file.
 *
 * Wire format
 * -----------
 *   request : { __wit: 1, id, type, payload, ts }
 *   response: { __wit: 1, requestId, ok: true,  data }
 *             { __wit: 1, requestId, ok: false, error: { code, message, details } }
 *
 * - Requests get a unique `id`; the response must echo it as `requestId`, so a
 *   late or mismatched response can never be mistaken for the current one.
 * - Requests time out (configurable; `0` disables - use cancellation instead
 *   for long jobs).
 * - Events are one-way messages (`broadcast`) received via `onEvent`.
 * - Exactly one `chrome.runtime.onMessage` listener is installed per context
 *   and routes by `type`.
 */

import { ERR, MESSAGE_TIMEOUT_MS, SESSION_PORT_PREFIX } from '../shared/constants.js';
import { createError, serializeError, uid, withTimeout } from '../shared/helpers.js';

const MARK = '__wit';
const isEnvelope = (message) => !!message && message[MARK] === 1 && typeof message.type === 'string';

/* ------------------------------------------------------------ Outbound */

function createRequest(type, payload) {
  return { [MARK]: 1, id: uid('req'), type, payload, ts: Date.now() };
}

/** Map low-level chrome.runtime error messages to stable error codes. */
export function classifyChromeError(error) {
  const text = String(error?.message || error || '');
  if (/receiving end does not exist|could not establish connection/i.test(text)) {
    return createError(ERR.NO_RECEIVER, 'No script is listening in the target.', { cause: text });
  }
  if (/message port closed|channel closed/i.test(text)) {
    return createError(ERR.PORT_CLOSED, 'The target closed before replying.', { cause: text });
  }
  if (/cannot access (contents of )?(the )?(page|url)|extension manifest must request permission/i.test(text)) {
    return createError(
      /file:\/\//i.test(text) ? ERR.FILE_ACCESS : ERR.PERMISSION_DENIED,
      'The extension does not have access to this page.',
      { cause: text },
    );
  }
  if (/cannot access a chrome|chrome:\/\/|chrome-extension:\/\/|gallery|webstore/i.test(text)) {
    return createError(ERR.RESTRICTED_PAGE, 'Chrome does not allow extensions on this page.', { cause: text });
  }
  return error instanceof Error && error.code ? error : createError(ERR.UNKNOWN, text || 'Unknown error');
}

async function dispatch(send, request, timeoutMs) {
  let response;
  try {
    response = await withTimeout(
      Promise.resolve().then(send),
      timeoutMs,
      ERR.TIMEOUT,
      `No response to ${request.type} within ${Math.round(timeoutMs / 1000)}s.`,
    );
  } catch (error) {
    throw error?.code === ERR.TIMEOUT ? error : classifyChromeError(error);
  }
  if (!response || response[MARK] !== 1 || response.requestId === undefined) {
    throw createError(ERR.NO_RESPONSE, `No handler answered ${request.type}.`);
  }
  if (response.requestId !== request.id) {
    throw createError(ERR.STALE_RESPONSE, `Ignored a mismatched response to ${request.type}.`);
  }
  if (!response.ok) {
    const { code, message, details } = response.error || {};
    throw createError(code || ERR.UNKNOWN, message || 'Request failed', details);
  }
  return response.data;
}

/** Side panel / content script -> service worker. */
export function sendToBackground(type, payload, { timeoutMs = MESSAGE_TIMEOUT_MS } = {}) {
  const request = createRequest(type, payload);
  return dispatch(() => chrome.runtime.sendMessage(request), request, timeoutMs);
}

/**
 * Service worker -> offscreen document. Extension pages share one message bus,
 * so only the context that registered a handler for `type` answers.
 */
export function sendToOffscreen(type, payload, { timeoutMs = MESSAGE_TIMEOUT_MS } = {}) {
  const request = createRequest(type, payload);
  return dispatch(() => chrome.runtime.sendMessage(request), request, timeoutMs);
}

/** Service worker -> content script in one tab (top frame by default). */
export function sendToTab(tabId, type, payload, { timeoutMs = MESSAGE_TIMEOUT_MS, frameId = 0 } = {}) {
  const request = createRequest(type, payload);
  return dispatch(() => chrome.tabs.sendMessage(tabId, request, { frameId }), request, timeoutMs);
}

/** One-way event to every extension page that is listening. Never throws. */
export function broadcast(type, payload) {
  const message = createRequest(type, payload);
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* no receivers - fine */
  }
}

/* ------------------------------------------------------------- Inbound */

const handlers = new Map();
const eventListeners = new Map();
let listenerInstalled = false;

function route(message, sender, sendResponse) {
  if (!isEnvelope(message)) return false;

  const handler = handlers.get(message.type);
  if (handler) {
    Promise.resolve()
      .then(() => handler(message.payload, { sender, message }))
      .then((data) => sendResponse({ [MARK]: 1, requestId: message.id, ok: true, data }))
      .catch((error) =>
        sendResponse({ [MARK]: 1, requestId: message.id, ok: false, error: serializeError(error) }),
      );
    return true; // keep the channel open for the async response
  }

  const listeners = eventListeners.get(message.type);
  if (listeners) {
    listeners.forEach((callback) => {
      try {
        callback(message.payload, { sender, message });
      } catch (error) {
        console.error(`[messages] event listener for ${message.type} failed`, error);
      }
    });
  }
  return false;
}

function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  chrome.runtime.onMessage.addListener(route);
}

/**
 * Register request handlers: `{ [type]: async (payload, { sender }) => data }`.
 * Thrown errors are serialized back to the caller.
 */
export function registerHandlers(map) {
  Object.entries(map).forEach(([type, handler]) => handlers.set(type, handler));
  ensureListener();
}

/** Subscribe to a broadcast event. Returns an unsubscribe function. */
export function onEvent(type, callback) {
  if (!eventListeners.has(type)) eventListeners.set(type, new Set());
  eventListeners.get(type).add(callback);
  ensureListener();
  return () => eventListeners.get(type)?.delete(callback);
}

/* ------------------------------------------------------------ Sessions */

const HEARTBEAT_MS = 20000;

/**
 * Side panel side: open a long-lived port. It (a) keeps the service worker
 * alive while a long crawl is running via periodic heartbeats and (b) lets the
 * service worker cancel in-flight scans and close temporary tabs the moment
 * the panel closes.
 */
export function openSession(sessionId) {
  const port = chrome.runtime.connect({ name: `${SESSION_PORT_PREFIX}${sessionId}` });
  const timer = setInterval(() => {
    try {
      port.postMessage({ heartbeat: Date.now() });
    } catch {
      clearInterval(timer);
    }
  }, HEARTBEAT_MS);
  port.onDisconnect.addListener(() => clearInterval(timer));
  return { sessionId, close: () => port.disconnect() };
}

/** Service worker side: observe panel sessions. */
export function watchSessions({ onDisconnect }) {
  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(SESSION_PORT_PREFIX)) return;
    const sessionId = port.name.slice(SESSION_PORT_PREFIX.length);
    port.onDisconnect.addListener(() => onDisconnect(sessionId));
  });
}
