import { runAll } from './test-runner.js';

import './suites/color-parsing.test.js';
import './suites/color-matching.test.js';
import './suites/css-utils.test.js';
import './suites/dom-scanning.test.js';
import './suites/url-normalizer.test.js';
import './suites/results-and-validators.test.js';
import './suites/site-crawler.test.js';
import './suites/helpers.test.js';
import './suites/color-names.test.js';
import './suites/background-renderer.test.js';
import './suites/text-find.test.js';
import './suites/phone-find.test.js';

const filter = new URLSearchParams(location.search).get('filter') || undefined;
runAll(document.getElementById('report'), { filter });
