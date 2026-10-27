import { assert, describe, it } from '../test-runner.js';
import {
  extractInternalLinks,
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from '../../services/url-normalizer.js';

const BASE = 'https://example.com/products/';
const key = (input, base = BASE) => normalizeUrl(input, base)?.key ?? null;

describe('URL normalization', () => {
  it('resolves relative URLs against the page URL', () => {
    assert.equal(key('item.html'), 'https://example.com/products/item.html');
    assert.equal(key('../about'), 'https://example.com/about');
    assert.equal(key('/contact'), 'https://example.com/contact');
    assert.equal(key('//example.com/x'), 'https://example.com/x');
  });

  it('treats duplicate spellings of the same URL as one', () => {
    const variants = ['https://example.com/about', 'https://EXAMPLE.com/about', 'https://example.com:443/about', 'https://example.com/about#team', '/about', '../about'];
    const keys = new Set(variants.map((v) => key(v)));
    assert.equal(keys.size, 1, `got ${[...keys].join(' | ')}`);
  });

  it('removes fragments (fragment-only links collapse onto the page itself)', () => {
    assert.equal(key('https://example.com/a#section'), 'https://example.com/a');
    assert.equal(key('#top', 'https://example.com/a'), 'https://example.com/a');
    assert.equal(normalizeUrl('https://example.com/a#x').url, 'https://example.com/a');
  });

  it('ignores trailing slashes for identity but keeps the navigable URL intact', () => {
    assert.equal(key('https://example.com/about/'), key('https://example.com/about'));
    assert.equal(normalizeUrl('https://example.com/about/').url, 'https://example.com/about/');
    assert.equal(key('https://example.com'), 'https://example.com/', 'root keeps its slash');
    assert.equal(key('https://example.com/a/?x=1'), key('https://example.com/a?x=1'));
  });

  it('strips tracking parameters', () => {
    assert.equal(key('https://example.com/a?utm_source=x&utm_medium=y'), 'https://example.com/a');
    assert.equal(key('https://example.com/a?gclid=1&fbclid=2&msclkid=3'), 'https://example.com/a');
    assert.equal(key('https://example.com/a?id=5&utm_campaign=z'), 'https://example.com/a?id=5');
  });

  it('keeps meaningful query parameters, order-insensitively', () => {
    assert.equal(key('https://example.com/search?q=red&page=2'), key('https://example.com/search?page=2&q=red'));
    assert.notEqual(key('https://example.com/search?q=red'), key('https://example.com/search?q=blue'));
    assert.notEqual(key('https://example.com/p?id=1'), key('https://example.com/p?id=2'));
    assert.ok(key('https://example.com/p?id=1&sort=asc').includes('id=1'));
  });

  it('rejects unsupported schemes and garbage', () => {
    for (const input of ['mailto:a@b.co', 'tel:+123', 'javascript:void(0)', 'data:text/html,hi', 'ftp://example.com/x', 'blob:https://example.com/1', 'file:///etc/passwd', 'chrome://settings', '', '   ', 'http://']) {
      assert.equal(normalizeUrl(input, BASE), null, input);
    }
    assert.equal(normalizeUrl(null), null);
    assert.equal(normalizeUrl(undefined), null);
  });

  it('distinguishes same-origin from external domains', () => {
    assert.ok(isSameOrigin('https://example.com/a', 'https://example.com/b?x=1'));
    assert.ok(!isSameOrigin('https://example.org/a', 'https://example.com/'));
    assert.ok(!isSameOrigin('http://example.com/a', 'https://example.com/'), 'different scheme = different origin');
    assert.ok(!isSameOrigin('https://sub.example.com/', 'https://example.com/'));
    assert.ok(!isSameOrigin('https://example.com:8443/', 'https://example.com/'));
  });
});

describe('Crawlable URL filtering', () => {
  it('skips downloads and static assets', () => {
    for (const url of ['https://example.com/report.pdf', 'https://example.com/a.ZIP', 'https://example.com/img/logo.png', 'https://example.com/app.js', 'https://example.com/feed.xml']) {
      assert.ok(!isCrawlableUrl(url), url);
    }
    assert.ok(isCrawlableUrl('https://example.com/about'));
    assert.ok(isCrawlableUrl('https://example.com/page.html'));
    assert.ok(isCrawlableUrl('https://example.com/page.php?id=3'));
  });

  it('never follows logout / destructive-looking GET links', () => {
    for (const url of ['https://example.com/logout', 'https://example.com/account/sign-out', 'https://example.com/?action=logout', 'https://example.com/unsubscribe/abc', 'https://example.com/items/42/delete']) {
      assert.ok(!isCrawlableUrl(url), url);
    }
    assert.ok(isCrawlableUrl('https://example.com/blog/logging-out-of-things'), 'words merely containing the text are fine');
  });

  it('extractInternalLinks de-duplicates, drops externals and unsupported links', () => {
    const links = extractInternalLinks(
      [
        'https://example.com/a', 'https://example.com/a#x', 'https://example.com/a/', '/b', '/b?utm_source=n',
        'https://other.com/c', 'mailto:x@y.z', 'tel:123', 'javascript:void(0)', '/file.pdf', '/logout', 'https://example.com/d',
      ],
      'https://example.com/',
      'https://example.com',
    );
    assert.deepEqual(links.map((l) => l.key), ['https://example.com/a', 'https://example.com/b', 'https://example.com/d']);
  });
});
