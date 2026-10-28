/**
 * Telephone Number scan: the same flow scan as Text Find (so a number split
 * across <span>s or broken by a <br> is still one number), with phone matching
 * rules from services/phone-matcher.js, plus the `tel:` links of the page.
 */

import { createPhoneMatcher, phoneFromHref } from '../services/phone-matcher.js';
import { scanFlows } from './text-scanner.js';

/** @param {object} params see scanFlows, plus `target` (a sanitized phone query) */
export function scanPhoneDocument({ target, options: _options, ...params }) {
  const matcher = createPhoneMatcher(target);
  return scanFlows(params, {
    finder: matcher,
    linkValue: target.includeLinks
      ? (element) => (element.localName === 'a' || element.localName === 'area' ? phoneFromHref(element.getAttribute('href')) : null)
      : () => null,
  });
}
