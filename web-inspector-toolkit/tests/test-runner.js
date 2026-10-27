/**
 * Minimal in-browser test runner (no framework, no build step).
 *
 *   import { describe, it, assert, runAll } from './test-runner.js';
 *   describe('thing', () => { it('works', () => assert.equal(1, 1)); });
 *   runAll(document.getElementById('report'));
 *
 * Results are rendered into the page and exposed on `window.__TEST_RESULTS__`
 * so they can also be read by automation.
 */

const suites = [];
let currentSuite = null;

export function describe(name, define) {
  const suite = { name, tests: [], before: null, after: null };
  suites.push(suite);
  currentSuite = suite;
  define();
  currentSuite = null;
}

export function it(name, fn) {
  if (!currentSuite) throw new Error('it() must be called inside describe()');
  currentSuite.tests.push({ name, fn });
}

export function beforeEach(fn) {
  currentSuite.before = fn;
}

export function afterEach(fn) {
  currentSuite.after = fn;
}

/* --------------------------------------------------------------- Assertions */

class AssertionError extends Error {}

const show = (value) => {
  try {
    return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 0) ?? String(value);
  } catch {
    return String(value);
  }
};

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => deepEqual(a[key], b[key]));
}

export const assert = {
  ok(value, message = 'expected a truthy value') {
    if (!value) throw new AssertionError(message);
  },
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      throw new AssertionError(message || `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  notEqual(actual, expected, message) {
    if (Object.is(actual, expected)) throw new AssertionError(message || `expected value to differ from ${show(expected)}`);
  },
  deepEqual(actual, expected, message) {
    if (!deepEqual(actual, expected)) {
      throw new AssertionError(message || `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  near(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new AssertionError(message || `expected ${actual} within ±${tolerance} of ${expected}`);
    }
  },
  throws(fn, message = 'expected function to throw') {
    try {
      fn();
    } catch {
      return;
    }
    throw new AssertionError(message);
  },
  async rejects(promise, message = 'expected promise to reject') {
    try {
      await promise;
    } catch {
      return;
    }
    throw new AssertionError(message);
  },
};

/* ------------------------------------------------------------------ Runner */

const STYLE = `
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e8eaf0; }
  #report { max-width: 920px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .summary { padding: 12px 16px; border-radius: 8px; margin: 12px 0 20px; font-weight: 600; }
  .summary.pass { background: #12372b; color: #6fe0b9; } .summary.fail { background: #3b1a21; color: #ff8b9a; }
  .suite { margin: 0 0 16px; border: 1px solid #272c38; border-radius: 8px; overflow: hidden; }
  .suite > h2 { margin: 0; padding: 8px 14px; font-size: 14px; background: #171a21; }
  .test { padding: 5px 14px; border-top: 1px solid #1e222b; display: flex; gap: 10px; }
  .test .mark { width: 14px; flex: none; } .test.pass .mark { color: #43c59e; } .test.fail .mark { color: #f2687a; }
  .test .err { color: #f2687a; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
`;

export async function runAll(container, { filter } = {}) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const results = { passed: 0, failed: 0, total: 0, failures: [], suites: [] };
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.textContent = 'Running…';
  container.append(summary);

  for (const suite of suites) {
    if (filter && !suite.name.includes(filter)) continue;
    const section = document.createElement('section');
    section.className = 'suite';
    section.innerHTML = '<h2></h2>';
    section.firstChild.textContent = suite.name;
    container.append(section);
    const suiteResult = { name: suite.name, passed: 0, failed: 0 };

    for (const test of suite.tests) {
      results.total += 1;
      const row = document.createElement('div');
      let error = null;
      try {
        if (suite.before) await suite.before();
        await test.fn();
      } catch (caught) {
        error = caught;
      } finally {
        try {
          if (suite.after) await suite.after();
        } catch (caught) {
          error ||= caught;
        }
      }
      row.className = `test ${error ? 'fail' : 'pass'}`;
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = error ? '✗' : '✓';
      const label = document.createElement('div');
      label.textContent = test.name;
      if (error) {
        const detail = document.createElement('div');
        detail.className = 'err';
        detail.textContent = error.message || String(error);
        label.append(detail);
        results.failed += 1;
        suiteResult.failed += 1;
        results.failures.push(`${suite.name} › ${test.name}: ${error.message || error}`);
      } else {
        results.passed += 1;
        suiteResult.passed += 1;
      }
      row.append(mark, label);
      section.append(row);
    }
    results.suites.push(suiteResult);
  }

  const ok = results.failed === 0;
  summary.className = `summary ${ok ? 'pass' : 'fail'}`;
  summary.textContent = `${results.passed} / ${results.total} tests passed${ok ? '' : ` — ${results.failed} failed`}`;
  document.title = `${ok ? 'PASS' : 'FAIL'} ${results.passed}/${results.total}`;
  window.__TEST_RESULTS__ = { ...results, done: true };
  return results;
}
