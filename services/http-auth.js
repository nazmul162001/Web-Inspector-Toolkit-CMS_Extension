/**
 * HTTP Basic Auth for Entire Site fetches. Credentials stay in memory for
 * one crawl; they are never written to storage or logs.
 */

import { ERR } from '../shared/constants.js';

export function parseAuthRealm(header) {
  const text = String(header || '');
  const quoted = /realm\s*=\s*"([^"]*)"/i.exec(text);
  if (quoted) return quoted[1];
  const bare = /realm\s*=\s*([^\s,]+)/i.exec(text);
  return bare ? bare[1] : '';
}

export function basicAuthorization(username, password) {
  const token = `${String(username ?? '')}:${String(password ?? '')}`;
  const bytes = unescape(encodeURIComponent(token));
  return `Basic ${btoa(bytes)}`;
}

export function isUnauthorized(error) {
  if (!error) return false;
  if (error.code === ERR.AUTH_REQUIRED) return true;
  if (error.code === ERR.HTTP_ERROR && Number(error.details?.status) === 401) return true;
  return /HTTP 401\b/.test(String(error.message || ''));
}
