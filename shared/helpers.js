/**
 * Small, dependency-free helpers shared by every extension context.
 * Nothing here touches `chrome.*` at import time.
 */

import { ERR } from './constants.js';

/* ----------------------------------------------------------------- Misc */

let uidCounter = 0;

export function uid(prefix = 'id') {
  uidCounter += 1;
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}_${random}`;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function truncate(text, max) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, Math.max(0, max - 1))}…` : str;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/* ----------------------------------------------------------- Async utils */

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createError(ERR.CANCELLED, 'Cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(createError(ERR.CANCELLED, 'Cancelled'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let yieldChannel = null;

/**
 * Yield to the event loop without timer throttling. `setTimeout(0)` is clamped
 * to >= 1 s in background tabs, which would make crawl tabs painfully slow;
 * MessageChannel tasks are not throttled.
 */
export function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') return setTimeout(resolve, 0);
    if (!yieldChannel) yieldChannel = { channel: new MessageChannel(), queue: [] };
    const { channel, queue } = yieldChannel;
    if (queue.length === 0) {
      channel.port1.onmessage = () => {
        const callbacks = queue.splice(0);
        callbacks.forEach((cb) => cb());
      };
    }
    queue.push(resolve);
    channel.port2.postMessage(0);
  });
}

export function withTimeout(promise, ms, code = ERR.TIMEOUT, message = 'Operation timed out') {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createError(code, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function debounce(fn, wait = 150) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, wait = 250) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...pendingArgs);
        }, remaining);
      }
    }
  };
}

/* ---------------------------------------------------------------- Errors */

export function createError(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export function serializeError(error) {
  return {
    code: error?.code || ERR.UNKNOWN,
    message: error?.message || String(error ?? 'Unknown error'),
    details: error?.details,
  };
}

export const isCancelled = (error) => error?.code === ERR.CANCELLED;

/* -------------------------------------------------------------- Emitter */

export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return () => listeners.get(event)?.delete(callback);
    },
    emit(event, ...args) {
      listeners.get(event)?.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[emitter] listener for "${event}" failed`, error);
        }
      });
    },
  };
}

/* ------------------------------------------------------------ DOM (UI)  */

/**
 * Tiny hyperscript helper used by the side panel. Text is always inserted
 * with textContent so page-derived strings can never become markup.
 *
 *   el('button', { class: 'btn', onClick: fn, 'aria-label': 'Go' }, 'Go')
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) {
        if (name.startsWith('--')) node.style.setProperty(name, v); // custom properties need setProperty
        else node.style[name] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  appendChildren(node, children);
  return node;
}

/** Like `node.replaceChildren(...)` but skips null/undefined/false instead of rendering them as text. */
export function setChildren(node, ...children) {
  node.replaceChildren();
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Parse a trusted static SVG/HTML string (never page data) into a node. */
export function fromTemplate(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ------------------------------------------------------------- Clipboard */

/**
 * Copy text to the clipboard. Uses the async Clipboard API where available and
 * falls back to a hidden textarea + execCommand('copy').
 */
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
