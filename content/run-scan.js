/**
 * One entry point for "scan this document", used by the content script and by
 * the invisible renderer. The kind of target decides the scanner:
 *   color target {r,g,b,a}  -> color scanner
 *   {kind: 'text', ...}     -> Text Find scanner
 *   {kind: 'phone', ...}    -> Telephone Number scanner
 *   {kind: 'href', ...}     -> Link (href) scanner
 *   {kind: 'font', ...}     -> Font Find scanner
 * All return the same page-result shape.
 */

import { isFontQuery } from '../services/font-matcher.js';
import { isHrefQuery } from '../services/href-matcher.js';
import { isPhoneQuery } from '../services/phone-matcher.js';
import { isTextQuery } from '../services/text-matcher.js';
import { scanDocument } from './dom-scanner.js';
import { scanFontDocument } from './font-scanner.js';
import { scanHrefDocument } from './href-scanner.js';
import { scanPhoneDocument } from './phone-scanner.js';
import { scanTextDocument } from './text-scanner.js';

export function runScan(params) {
  if (isTextQuery(params.target)) return scanTextDocument(params);
  if (isPhoneQuery(params.target)) return scanPhoneDocument(params);
  if (isHrefQuery(params.target)) return scanHrefDocument(params);
  if (isFontQuery(params.target)) return scanFontDocument(params);
  return scanDocument(params);
}
