import { afterEach, assert, describe as baseDescribe, it } from '../test-runner.js';
import { createPhoneMatcher, isPhoneQuery, parsePhoneInput, phoneFromHref, sanitizePhoneQuery } from '../../services/phone-matcher.js';
import { scanPhoneDocument } from '../../content/phone-scanner.js';
import { runScan } from '../../content/run-scan.js';
import { createBackgroundRenderer } from '../../services/background-renderer.js';
import { isScanTarget, parseScanRequest } from '../../shared/validators.js';
import { DEFAULT_SETTINGS } from '../../services/settings-service.js';

const phone = (number, extra = {}) => sanitizePhoneQuery({ kind: 'phone', number, ...extra });

/** Matched strings of `text` for a query. */
function find(number, text, extra) {
  const query = phone(number, extra);
  assert.ok(query, `query "${number}" is valid`);
  return createPhoneMatcher(query)
    .find(text)
    .map(({ start, end }) => text.slice(start, end));
}

const created = [];
function describe(name, define) {
  baseDescribe(name, () => {
    afterEach(() => {
      while (created.length) created.pop().remove();
    });
    define();
  });
}

describe('Phone input', () => {
  it('accepts any common way of writing a number', () => {
    for (const input of ['080-1234-5678', '08012345678', '080 1234 5678', '(080) 1234-5678', '080.1234.5678', '+81 80 1234 5678', '０８０－１２３４－５６７８', ' 080‐1234‐5678 ']) {
      const result = parsePhoneInput(input);
      assert.ok(result.ok, input);
      assert.equal(result.query.digits.replace(/^81/, '0').length >= 10, true, input);
    }
    assert.equal(parsePhoneInput('０８０－１２３４－５６７８').query.digits, '08012345678');
    assert.equal(parsePhoneInput('+81 80 1234 5678').query.plus, true);
    assert.equal(parsePhoneInput('080-1234-5678').query.plus, false);
  });

  it('rejects empty, lettered, too short and too long input with a helpful message', () => {
    for (const bad of ['', '   ', 'call me', '080-1234-abcd', '12-3', '1234567890123456', '08+012345678', 'x'.repeat(60)]) {
      const result = parsePhoneInput(bad);
      assert.equal(result.ok, false, bad);
      assert.ok(result.error.length > 5, bad);
    }
  });

  it('sanitizes untrusted queries and keeps only known fields', () => {
    const query = sanitizePhoneQuery({ kind: 'phone', number: '080-1234-5678', exact: 0, evil: '<x>' });
    assert.deepEqual(query, {
      kind: 'phone',
      number: '080-1234-5678',
      digits: '08012345678',
      plus: false,
      exact: true,
      international: true,
      includeLinks: true,
    });
    assert.equal(sanitizePhoneQuery({ kind: 'phone', number: 'abc' }), null);
    assert.equal(sanitizePhoneQuery({ kind: 'text', text: 'x' }), null);
    assert.ok(isPhoneQuery(query));
    assert.ok(!isPhoneQuery({ r: 1, g: 2, b: 3, a: 255 }));
  });

  it('reads the number out of tel: links', () => {
    assert.equal(phoneFromHref('tel:+81-80-1234-5678'), '+81-80-1234-5678');
    assert.equal(phoneFromHref('TEL:080%201234%205678'), '080 1234 5678');
    assert.equal(phoneFromHref('tel:0312345678;ext=12'), '0312345678');
    assert.equal(phoneFromHref('callto:0312345678'), '0312345678');
    assert.equal(phoneFromHref('mailto:a@b.c'), null);
    assert.equal(phoneFromHref('tel:'), null);
    assert.equal(phoneFromHref(null), null);
  });
});

describe('Phone matching', () => {
  it('finds the same number however it is written', () => {
    const text = 'A 080-1234-5678, B 08012345678, C 080 1234 5678, D (080) 1234-5678, E 080.1234.5678, F ０８０－１２３４－５６７８, G 080‐1234‐5678';
    for (const typed of ['080-1234-5678', '08012345678', '080 1234 5678', '(080)1234-5678', '０８０１２３４５６７８']) {
      assert.equal(find(typed, text).length, 7, typed);
    }
  });

  it('returns exactly the written number, not the words around it', () => {
    assert.deepEqual(find('08012345678', 'Call 080 1234 5678 now'), ['080 1234 5678']);
    assert.deepEqual(find('08012345678', 'TEL:080-1234-5678.'), ['080-1234-5678']);
    assert.equal(find('03-1234-5678', 'Tokyo (03) 1234-5678 office').length, 1);
  });

  it('never merges digits across letters, commas or long gaps', () => {
    assert.equal(find('12345678', 'ab1234cd5678').length, 0);
    assert.equal(find('12345678', '1,234,5678').length, 0);
    assert.equal(find('12345678', '1234 -  - 5678').length, 0);
    assert.equal(find('12345678', '1234 - 5678').length, 1);
  });

  it('exact mode rejects parts of longer numbers; turning it off allows them', () => {
    assert.equal(find('1234-5678', 'call 080-1234-5678').length, 0);
    assert.equal(find('080-1234', 'call 080-1234-5678').length, 0);
    assert.equal(find('080-1234-5678', 'id 080-1234-56789').length, 0);
    assert.equal(find('080-1234-5678', 'id 1080-1234-5678').length, 0);
    assert.deepEqual(find('1234-5678', 'call 080-1234-5678', { exact: false }), ['1234-5678']);
    assert.equal(find('080-1234-5678', 'id 080-1234-56789', { exact: false }).length, 1);
  });

  it('a space ends a number, so neighbouring numbers are found separately', () => {
    const text = '03-1234-5678 080-1111-2222';
    assert.deepEqual(find('0312345678', text), ['03-1234-5678']);
    assert.deepEqual(find('08011112222', text), ['080-1111-2222']);
  });

  it('finds every occurrence, in order, without overlaps', () => {
    assert.equal(find('0312345678', '03-1234-5678 / 0312345678 / 03 1234 5678').length, 3);
  });

  it('treats +81 and 0 as the same number when international matching is on', () => {
    assert.deepEqual(find('080-1234-5678', 'Call +81 80-1234-5678 today'), ['+81 80-1234-5678']);
    assert.deepEqual(find('080-1234-5678', 'Call +81 (0)80 1234 5678 today'), ['+81 (0)80 1234 5678']);
    assert.deepEqual(find('080-1234-5678', 'Call +81-80-1234-5678'), ['+81-80-1234-5678']);
    assert.deepEqual(find('+81 80 1234 5678', 'Call 080-1234-5678'), ['080-1234-5678']);
    assert.deepEqual(find('+81 80 1234 5678', 'Call +81 80-1234-5678'), ['+81 80-1234-5678']);
    assert.deepEqual(find('555-555-0123', 'Call +1 (555) 555-0123'), ['+1 (555) 555-0123']);
    assert.equal(find('080-1234-5678', 'Call +81 80-1234-5678', { international: false }).length, 0);
    assert.equal(find('+81 80 1234 5678', 'Call 080-1234-5678', { international: false }).length, 0);
  });

  it('does not invent matches for other numbers', () => {
    assert.equal(find('080-1234-5678', 'Call 090-1234-5678 or 080-1234-5679 or 080-1234-567').length, 0);
  });
});

/* -------------------------------------------------------------- Scanning */

async function scan(html, number, extra, options = {}) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  created.push(root);
  return scanPhoneDocument({ root, target: phone(number, extra), options });
}

describe('Phone scanning (live DOM)', () => {
  it('finds a number in text and reports the element, section and context', async () => {
    const result = await scan('<footer><p class="t" id="x">Reservations: 080-1234-5678 (10:00-19:00)</p></footer>', '08012345678');
    assert.equal(result.matches.length, 1);
    const match = result.matches[0];
    assert.equal(match.text, '080-1234-5678');
    assert.equal(match.before, 'Reservations: ');
    assert.equal(match.after, ' (10:00-19:00)');
    assert.equal(match.kind, 'text');
    const element = result.elements[0];
    assert.equal(element.tag, 'p');
    assert.equal(element.id, 'x');
    assert.equal(element.location.section, 'footer');
  });

  it('finds a number split over several inline elements or a line break', async () => {
    const split = await scan('<p class="p">Tel <span>080</span>-<b>1234</b>-<a href="#">5678</a></p>', '080-1234-5678');
    assert.equal(split.matches.length, 1);
    assert.equal(split.matches[0].text, '080-1234-5678');
    assert.equal(split.elements[0].tag, 'p');
    const br = await scan('<p>080<br>1234 5678</p>', '08012345678');
    assert.equal(br.matches.length, 1);
  });

  it('does not join numbers in different blocks', async () => {
    assert.equal((await scan('<div>080-1234</div><div>5678</div>', '08012345678')).matches.length, 0);
  });

  it('finds tel: links, also when their visible text is not a number', async () => {
    const html = '<a class="call" href="tel:+81-80-1234-5678">Call us</a>';
    const result = await scan(html, '080-1234-5678');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].kind, 'link');
    assert.equal(result.matches[0].attribute, 'href');
    assert.equal(result.matches[0].text, '+81-80-1234-5678');
    assert.equal((await scan(html, '080-1234-5678', { includeLinks: false })).matches.length, 0);
  });

  it('reports a number once when the link text already shows it', async () => {
    const result = await scan('<p><a href="tel:08012345678">080-1234-5678</a></p>', '08012345678');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].kind, 'text');
  });

  it('keeps the link result when the text beside it does not match', async () => {
    const result = await scan('<p>Call 080-1234-5678</p><a href="tel:08012345678">Phone</a>', '08012345678');
    assert.deepEqual(result.matches.map((m) => m.kind), ['text', 'link']);
  });

  it('ignores script, style and template content and other digits', async () => {
    const result = await scan(
      '<p>080-1234-5678</p><script>var t="080-1234-5678"</script><template>080-1234-5678</template><p>080-1234-5679</p>',
      '08012345678',
    );
    assert.equal(result.matches.length, 1);
  });

  it('works on a parsed document without layout', async () => {
    const doc = new DOMParser().parseFromString('<body><main><p>Tel +81 80-1234-5678</p></main></body>', 'text/html');
    const result = await scanPhoneDocument({ doc, target: phone('080-1234-5678') });
    assert.equal(result.matches.length, 1);
    assert.equal(result.elements[0].rendered, null);
  });

  it('runScan dispatches phone targets to the phone scanner', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>080-1234-5678</p>';
    document.body.append(root);
    created.push(root);
    const result = await runScan({ root, target: phone('08012345678') });
    assert.equal(result.matches[0].text, '080-1234-5678');
  });
});

/* -------------------------------------------------------- Renderer / API */

describe('Phone search through requests and the invisible renderer', () => {
  it('accepts phone queries as scan targets and sanitizes them', () => {
    assert.ok(isScanTarget(phone('080-1234-5678')));
    assert.ok(!isScanTarget({ kind: 'phone', number: 'nope' }));
    const request = parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'phone', number: ' 080-1234-5678 ', evil: 1 } });
    assert.equal(request.target.kind, 'phone');
    assert.equal(request.target.digits, '08012345678');
    assert.equal('evil' in request.target, false);
    assert.throws(() => parseScanRequest({ scanId: 's', tabId: 1, target: { kind: 'phone', number: 'abc' } }));
  });

  it('has sensible saved defaults', () => {
    assert.deepEqual(DEFAULT_SETTINGS.phone, { query: '', exact: true, international: true, includeLinks: true, groupMode: 'section' });
  });

  it('finds the tel: link of a served page without downloading stylesheets', async () => {
    const holder = document.createElement('div');
    document.body.append(holder);
    created.push(holder);
    const requests = [];
    const renderer = createBackgroundRenderer({
      container: holder,
      fetchImpl: (input, init) => {
        requests.push(String(input));
        return fetch(input, init);
      },
    });
    const url = new URL('../fixtures/site/index.html', import.meta.url).href;
    const page = await renderer.scanUrl(url, { target: phone('555-555-0123'), options: { collectLinks: true }, timeoutMs: 15000 });
    assert.equal(page.matches.length, 1);
    assert.equal(page.matches[0].kind, 'link');
    assert.equal(page.matches[0].text, '+15555550123');
    assert.equal(requests.length, 1, 'only the HTML was downloaded');
    assert.equal(holder.querySelectorAll('iframe').length, 0);
  });
});
