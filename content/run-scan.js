/**
 * One entry point for "scan this document", used by the content script and by
 * the invisible renderer. The kind of target decides the scanner:
 *   color target {r,g,b,a}  -> color scanner
 *   {kind: 'text', ...}     -> Text Find scanner
 *   {kind: 'phone', ...}    -> Telephone Number scanner
 * All return the same page-result shape.
 */

import { isPhoneQuery } from '../services/phone-matcher.js';
import { isTextQuery } from '../services/text-matcher.js';
import { scanDocument } from './dom-scanner.js';
import { scanPhoneDocument } from './phone-scanner.js';
import { scanTextDocument } from './text-scanner.js';

export function runScan(params) {
  if (isTextQuery(params.target)) return scanTextDocument(params);
  if (isPhoneQuery(params.target)) return scanPhoneDocument(params);
  return scanDocument(params);
}
