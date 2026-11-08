/**
 * CMS SNS icon rules (no DOM, no chrome.*).
 *
 * Small screens (viewport ≤ 768px): the icon must be 40 × 40 px. Space on the
 * left and right must be at least half that width (20 px) so the icon does not
 * sit on text or another section.
 *
 * PC: 30 × 30, 32 × 32 or 40 × 40 px are the usual sizes. Space on each side
 * is still at least half of the displayed width (16 px around a 32 px icon).
 *
 * Neighbouring SNS icons in the same row are a cluster, not "another section".
 */

export const SP_MAX_WIDTH = 768;
export const SP_SIZE = 40;
export const PC_USUAL_SIZES = Object.freeze([30, 32, 40]);
export const SIZE_SLACK = 1;
export const SPACE_SLACK = 0.6;

export function isSmallScreen(viewportWidth) {
  return Number(viewportWidth) <= SP_MAX_WIDTH;
}

export function screenKind(viewportWidth) {
  return isSmallScreen(viewportWidth) ? 'sp' : 'pc';
}

export function screenLabel(viewportWidth) {
  return isSmallScreen(viewportWidth) ? 'Small screen' : 'PC';
}

/** min/max width in px from `@media` conditions. Other at-rules are ignored. */
export function mediaWidthBounds(conditions = []) {
  let min = null;
  let max = null;
  for (const raw of conditions || []) {
    if (typeof raw !== 'string' || !/^@media\b/i.test(raw)) continue;
    for (const match of raw.matchAll(/max-width\s*:\s*([\d.]+)(px|em|rem)?/gi)) {
      const n = Number(match[1]);
      if (!Number.isFinite(n)) continue;
      const pxValue = match[2] === 'em' || match[2] === 'rem' ? n * 16 : n;
      max = max == null ? pxValue : Math.min(max, pxValue);
    }
    for (const match of raw.matchAll(/min-width\s*:\s*([\d.]+)(px|em|rem)?/gi)) {
      const n = Number(match[1]);
      if (!Number.isFinite(n)) continue;
      const pxValue = match[2] === 'em' || match[2] === 'rem' ? n * 16 : n;
      min = min == null ? pxValue : Math.max(min, pxValue);
    }
  }
  return { min, max };
}

export function describeRuleRange(viewportWidth) {
  const vw = Math.round(Number(viewportWidth) || 0);
  if (isSmallScreen(vw)) return `Small-screen rules apply at ${SP_MAX_WIDTH} px and below (now ${vw} px).`;
  return `PC rules apply above ${SP_MAX_WIDTH} px (now ${vw} px).`;
}

/** Only notes the user can act on: inline style, or a real @media query. */
export function cssSourceExtras(source) {
  if (!source) return [];
  if (source.origin === 'inline') return [{ kind: 'inline', text: 'Inline style attribute' }];
  return (source.conditions || [])
    .filter((item) => /^@media\b/i.test(item))
    .map((text) => ({ kind: 'media', text }));
}

export function describeCssWhere(source) {
  return cssSourceExtras(source).map((item) => item.text).join(' · ');
}

export function requiredSpacingFor(size) {
  return Math.max(0, Number(size) / 2);
}

export function px(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

export function cssPx(value) {
  if (value == null || value === '' || value === 'auto' || value === 'none' || value === 'normal') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function formatCssDecl(used) {
  if (!used) return '';
  const value = used.value || (Number.isFinite(used.px) ? `${px(used.px)}px` : '');
  return `${used.property}: ${value}`;
}

export function effectiveCssPx(list = []) {
  return (list || []).reduce((sum, item) => sum + (Number(item.px) || 0), 0);
}

export function displayedSize(width, height) {
  return { w: Math.round(Number(width) || 0), h: Math.round(Number(height) || 0) };
}

function near(actual, expected, slack = SIZE_SLACK) {
  return Math.abs(Number(actual) - Number(expected)) <= slack;
}

const KINDS = [
  { id: 'instagram', label: 'Instagram', re: /instagram|\binsta\b|-w-instagram/i },
  { id: 'line', label: 'LINE', re: /line\.me|-w-line(?:-|\b)|\bline\b/i },
  { id: 'facebook', label: 'Facebook', re: /facebook|\bfb\b|-w-facebook/i },
  { id: 'x', label: 'X', re: /twitter\.com|(?:^|\/\/)x\.com|\btwitter\b|-w-twitter/i },
  { id: 'youtube', label: 'YouTube', re: /youtube|-w-youtube/i },
  { id: 'tiktok', label: 'TikTok', re: /tiktok/i },
  { id: 'mail', label: 'Mail', re: /mailto:|\be-?mail\b|-w-mail/i },
  { id: 'calendar', label: 'Calendar', re: /calendar|予約カレンダー/i },
  { id: 'reservation', label: 'Reservation', re: /reserv|ご予約|予約はこちら/i },
  { id: 'contact', label: 'Contact', re: /\/contact|お問い合わせ|-w-contact/i },
];

const GENERIC = /[-_./]sns\b|\bsns[-_.]|-w-sns|social[-_]?icon|\bsocial\b/i;

/**
 * Name the SNS control from href / alt / class / file / visible text.
 * Returns null when nothing SNS-like is present.
 */
export function classifySns({ href = '', alt = '', className = '', src = '', text = '' } = {}) {
  const blob = `${href}\n${alt}\n${className}\n${src}\n${text}`;
  for (const kind of KINDS) {
    if (kind.re.test(blob)) return { id: kind.id, label: kind.label };
  }
  if (GENERIC.test(blob)) return { id: 'sns', label: 'SNS' };
  return null;
}

export function looksLikeSnsIcon(info, box) {
  if (classifySns(info)) return true;
  if (!box) return false;
  const w = Number(box.w) || 0;
  const h = Number(box.h) || 0;
  if (w < 16 || h < 16 || w > 96 || h > 96) return false;
  return Math.abs(w - h) <= 8;
}

/** True when two icon boxes sit in one row with only a short gap between them. */
export function areSideBySide(a, b) {
  if (!a || !b) return false;
  const minW = Math.min(a.w, b.w);
  const maxW = Math.max(a.w, b.w);
  if (minW < 12 || maxW > minW * 1.8) return false;
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const minH = Math.min(a.h, b.h);
  if (!(minH > 0) || overlap < minH * 0.45) return false;
  const gap = a.x <= b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const limit = Math.max(minW, 32) * 1.35;
  return gap >= -2 && gap <= limit;
}

/**
 * Gap from `icon` to the nearest other box in the same horizontal band.
 * `others` must already exclude the icon, its wrappers and SNS neighbours.
 */
export function clearanceFromRects(icon, others, viewportWidth) {
  let leftStop = 0;
  let rightStop = Number(viewportWidth) || 0;
  const iconRight = icon.x + icon.w;
  for (const r of others || []) {
    if (!(r.w > 1 && r.h > 1)) continue;
    const yOverlap = Math.min(icon.y + icon.h, r.y + r.h) - Math.max(icon.y, r.y);
    if (yOverlap < 4) continue;
    const rRight = r.x + r.w;
    if (rRight <= icon.x + 0.5) leftStop = Math.max(leftStop, rRight);
    else if (r.x >= iconRight - 0.5) rightStop = Math.min(rightStop, r.x);
    else if (r.x < icon.x) leftStop = Math.max(leftStop, Math.min(rRight, icon.x));
    else if (rRight > iconRight) rightStop = Math.min(rightStop, Math.max(r.x, iconRight));
  }
  return { left: icon.x - leftStop, right: rightStop - iconRight };
}

function sizeIssues({ size, small }) {
  const issues = [];
  const suggestions = [];
  if (small) {
    if (!near(size.w, SP_SIZE) || !near(size.h, SP_SIZE)) {
      issues.push('size');
      suggestions.push(`Set this icon to 40 × 40 px on small screens (now ${size.w} × ${size.h} px).`);
    }
    return { issues, suggestions, spacingBasis: SP_SIZE };
  }
  if (!near(size.w, size.h)) {
    issues.push('size');
    suggestions.push(`Keep the icon square on PC (now ${size.w} × ${size.h} px); usual sizes are 30 × 30, 32 × 32 or 40 × 40 px.`);
    return { issues, suggestions, spacingBasis: Math.max(size.w, size.h) };
  }
  if (size.w < 24 || size.w > 64) {
    issues.push('size');
    suggestions.push(`On PC use 30 × 30, 32 × 32 or 40 × 40 px (now ${size.w} × ${size.h} px).`);
  } else if (!PC_USUAL_SIZES.some((n) => near(size.w, n))) {
    suggestions.push('Usual PC sizes are 30 × 30, 32 × 32 or 40 × 40 px. Spacing must still be at least half the width.');
  }
  return { issues, suggestions, spacingBasis: size.w };
}

function suggestCssSide(side, list, requiredSpace, issues, suggestions) {
  const total = effectiveCssPx(list);
  if (total + SPACE_SLACK >= requiredSpace) return;
  issues.push('spacing');
  if (!list.length) {
    suggestions.push(`Add at least ${px(requiredSpace)} px of ${side} spacing with margin-${side}, padding-${side} or gap (now 0 px).`);
    return;
  }
  if (list.length === 1) {
    suggestions.push(`Increase ${list[0].property} to at least ${px(requiredSpace)} px (now ${list[0].value}).`);
    return;
  }
  suggestions.push(`Increase the ${side} spacing to at least ${px(requiredSpace)} px (now ${list.map(formatCssDecl).join(' + ')}).`);
}

/**
 * @param {{
 *   width: number,
 *   height: number,
 *   spacing?: { left: number, right: number, leftFromViewport?: boolean, rightFromViewport?: boolean },
 *   cssSpacing?: { left: Array<{property:string,value:string,px:number}>, right: Array<{property:string,value:string,px:number}> },
 *   cssSize?: Array<{property:string,value:string,px:number}>,
 *   trailing?: boolean,
 *   viewportWidth: number,
 * }} input
 */
export function checkSnsIcon({ width, height, spacing = {}, cssSpacing, cssSize = [], trailing = true, viewportWidth }) {
  const size = displayedSize(width, height);
  const small = isSmallScreen(viewportWidth);
  const sized = sizeIssues({ size, small });
  const requiredSpace = requiredSpacingFor(sized.spacingBasis);
  const issues = [...sized.issues];
  const suggestions = [...sized.suggestions];
  const left = Number(spacing.left);
  const right = Number(spacing.right);
  const hasCss = cssSpacing != null;

  if (hasCss) {
    const cssLeft = cssSpacing.left || [];
    const cssRight = cssSpacing.right || [];
    if (cssRight.length || trailing) suggestCssSide('right', cssRight, requiredSpace, issues, suggestions);
    if (cssLeft.length) suggestCssSide('left', cssLeft, requiredSpace, issues, suggestions);
  } else {
    if (Number.isFinite(left) && !spacing.leftFromViewport && left + SPACE_SLACK < requiredSpace) {
      issues.push('spacing');
      suggestions.push(`Give the left side at least ${px(requiredSpace)} px of space (now ${px(left)} px).`);
    }
    if (Number.isFinite(right) && !spacing.rightFromViewport && right + SPACE_SLACK < requiredSpace) {
      issues.push('spacing');
      suggestions.push(`Give the right side at least ${px(requiredSpace)} px of space (now ${px(right)} px).`);
    }
  }

  const ok = issues.length === 0;
  const cssLeftPx = hasCss ? effectiveCssPx(cssSpacing.left) : null;
  const cssRightPx = hasCss ? effectiveCssPx(cssSpacing.right) : null;
  return {
    ok,
    screen: small ? 'sp' : 'pc',
    screenLabel: screenLabel(viewportWidth),
    viewportWidth: Math.round(Number(viewportWidth) || 0),
    size,
    requiredSize: small ? { w: SP_SIZE, h: SP_SIZE } : null,
    requiredSpace,
    cssSize,
    cssSpacing: cssSpacing || { left: [], right: [] },
    spacing: {
      left: hasCss ? cssLeftPx : Number.isFinite(left) ? Math.round(left * 10) / 10 : null,
      right: hasCss ? cssRightPx : Number.isFinite(right) ? Math.round(right * 10) / 10 : null,
    },
    issues: [...new Set(issues)],
    suggestions,
    summary: ok ? 'This width matches the size and side-space rules.' : 'This width breaks the SNS rules.',
  };
}

/**
 * Icons in one row must share one size, and the gaps between them must match.
 * `items` is `{ box: { x, y, w, h } }[]` already sorted or not.
 */
export function checkSnsCluster(items = []) {
  const boxes = items
    .map((item) => item.box || item)
    .filter((box) => box && box.w > 0 && box.h > 0)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const issues = [];
  const suggestions = [];
  if (boxes.length < 2) {
    return { ok: true, sameSize: true, sameGap: true, gaps: [], cssGaps: [], sizes: boxes.map((b) => displayedSize(b.w, b.h)), issues, suggestions };
  }
  const sizes = boxes.map((box) => displayedSize(box.w, box.h));
  const sameSize = sizes.every((size) => near(size.w, sizes[0].w) && near(size.h, sizes[0].h));
  if (!sameSize) {
    issues.push('uniformSize');
    suggestions.push(`Make every SNS icon in this row the same size (now ${sizes.map((size) => `${size.w} × ${size.h}`).join(', ')}).`);
  }
  const gaps = [];
  for (let i = 1; i < boxes.length; i += 1) {
    gaps.push(boxes[i].x - (boxes[i - 1].x + boxes[i - 1].w));
  }
  const roundedGaps = gaps.map((gap) => Math.round(gap * 10) / 10);
  let sameGap = roundedGaps.length <= 1 || roundedGaps.every((gap) => near(gap, roundedGaps[0], 1));
  const cssRights = items.map((item) => item.cssSpacing?.right);
  const useCss = items.length >= 2 && cssRights.every((list) => Array.isArray(list));
  if (useCss) {
    const totals = cssRights.map((list) => effectiveCssPx(list));
    sameGap = totals.every((value) => near(value, totals[0], 1));
    if (!sameGap) {
      issues.push('uniformGap');
      suggestions.push(
        `Keep the space between SNS icons the same (now ${cssRights
          .map((list) => (list.length ? list.map(formatCssDecl).join(' + ') : '0 px'))
          .join(', ')}).`,
      );
    }
  } else if (!sameGap) {
    issues.push('uniformGap');
    suggestions.push(`Keep the space between SNS icons the same (now ${roundedGaps.map((gap) => `${px(gap)} px`).join(', ')}).`);
  }
  return {
    ok: issues.length === 0,
    sameSize,
    sameGap,
    gaps: roundedGaps,
    cssGaps: useCss ? cssRights.map((list) => (list.length ? list.map(formatCssDecl).join(' + ') : '0 px')) : [],
    sizes,
    issues,
    suggestions,
  };
}
