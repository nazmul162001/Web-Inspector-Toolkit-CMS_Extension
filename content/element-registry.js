/**
 * Remembers the elements reported by scans so highlight / scroll requests can
 * find them again. WeakRefs: the registry never keeps a page element alive.
 * Shared by the color scanner and the text scanner.
 */

import { uid } from '../shared/helpers.js';

/** Identifies this content-script lifetime; element ids are only valid within it. */
export const CONTEXT_ID = uid('ctx');

const elementRegistry = new Map();
let nextElementId = 1;

/** @returns {number} an id for `element`, valid until the page is reloaded */
export function registerElement(element) {
  const elementId = nextElementId;
  nextElementId += 1;
  elementRegistry.set(elementId, new WeakRef(element));
  return elementId;
}

export function lookupRegisteredElement(elementId) {
  const element = elementRegistry.get(elementId)?.deref();
  return element && element.isConnected ? element : null;
}
