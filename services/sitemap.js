/**
 * Extra Entire Site discovery: robots.txt Sitemap: lines and sitemap.xml.
 * Pages the header never links to (old articles, legal pages, CMS entries)
 * still show up here, so a site-wide search can actually visit them.
 */

import { ERR } from '../shared/constants.js';
import { createError } from '../shared/helpers.js';
import { parseAuthRealm } from './http-auth.js';
import { isSameOrigin } from './url-normalizer.js';

const MAX_SITEMAP_FILES = 30;
const MAX_SITEMAP_URLS = 5000;
const MAX_SITEMAP_DEPTH = 4;
const FETCH_MS = 5000;

const XML_ESCAPE = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXml(text) {
  return String(text).replace(/&(?:amp|lt|gt|quot|apos);/g, (token) => XML_ESCAPE[token] || token);
}

export function parseSitemapLocs(xml) {
  return Array.from(String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi), (match) => decodeXml(match[1].trim()).trim()).filter(Boolean);
}

export function parseRobotsSitemaps(text) {
  return Array.from(String(text || '').matchAll(/^\s*sitemap:\s*(\S+)/gim), (match) => match[1].trim()).filter(Boolean);
}

function isSitemapDocument(url, xml) {
  if (/<sitemapindex[\s>]/i.test(xml)) return true;
  return /sitemap/i.test(url) && /\.xml(\?|$)/i.test(url) && /<sitemap[\s>]/i.test(xml);
}

function resolveAgainst(raw, base) {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

/**
 * Download a text/xml resource for crawl discovery. 401 throws AUTH_REQUIRED
 * so the crawler can prompt; any other failure is an empty string.
 */
export async function fetchCrawlText(url, { origin, authorization, signal, timeoutMs = FETCH_MS } = {}) {
  const headers = { Accept: 'application/xml, text/xml, text/plain, */*' };
  if (authorization) headers.Authorization = authorization;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) {
    clearTimeout(timer);
    return '';
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    const finalUrl = response.url || url;
    if (origin && !isSameOrigin(finalUrl, origin)) return '';
    if (response.status === 401) {
      throw createError(ERR.AUTH_REQUIRED, 'This site asks for a username and password.', {
        status: 401,
        url,
        realm: parseAuthRealm(response.headers.get('www-authenticate')),
      });
    }
    if (!response.ok) return '';
    return await response.text();
  } catch (error) {
    if (error?.code === ERR.AUTH_REQUIRED) throw error;
    return '';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * @returns {Promise<string[]>} absolute URLs listed by the site map (not yet filtered)
 */
export async function collectSitemapUrls({ origin, fetchText, signal, maxUrls = MAX_SITEMAP_URLS } = {}) {
  if (!origin || typeof fetchText !== 'function') return [];
  const urls = [];
  const seenXml = new Set();
  const seenUrl = new Set();

  const remember = (href) => {
    if (!href || seenUrl.has(href) || urls.length >= maxUrls) return;
    seenUrl.add(href);
    urls.push(href);
  };

  async function loadXml(url, depth) {
    if (signal?.aborted) return;
    if (depth > MAX_SITEMAP_DEPTH || seenXml.size >= MAX_SITEMAP_FILES) return;
    const absolute = resolveAgainst(url, `${origin}/`);
    if (!absolute || seenXml.has(absolute) || (origin && !isSameOrigin(absolute, origin))) return;
    seenXml.add(absolute);
    const xml = await fetchText(absolute);
    if (!xml) return;
    const locs = parseSitemapLocs(xml);
    const nested = isSitemapDocument(absolute, xml);
    for (const loc of locs) {
      if (signal?.aborted || urls.length >= maxUrls) return;
      const resolved = resolveAgainst(loc, absolute);
      if (!resolved) continue;
      if (nested) await loadXml(resolved, depth + 1);
      else if (/\.xml(\?|$)/i.test(resolved) && /sitemap/i.test(resolved)) await loadXml(resolved, depth + 1);
      else if (!origin || isSameOrigin(resolved, origin)) remember(resolved);
    }
  }

  const robotsUrl = `${origin}/robots.txt`;
  const robots = await fetchText(robotsUrl);
  for (const entry of parseRobotsSitemaps(robots)) {
    const resolved = resolveAgainst(entry, robotsUrl);
    if (resolved) await loadXml(resolved, 0);
  }
  await loadXml(`${origin}/sitemap.xml`, 0);
  return urls;
}
