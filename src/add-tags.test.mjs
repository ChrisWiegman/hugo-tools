import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSelection, formatList } = require('./add-tags.js');

test('parseSelection: blank or 0 means done', () => {
	assert.deepEqual(parseSelection('', 3), { type: 'done' });
	assert.deepEqual(parseSelection('  0 ', 3), { type: 'done' });
});

test('parseSelection: a number in range picks that option', () => {
	assert.deepEqual(parseSelection('1', 3), { type: 'pick', index: 0 });
	assert.deepEqual(parseSelection(' 3\n', 3), { type: 'pick', index: 2 });
});

test('parseSelection: typos and out-of-range numbers are invalid, not done', () => {
	for (const answer of ['4', '-1', 'x', '2a', '1.5']) {
		assert.deepEqual(parseSelection(answer, 3), { type: 'invalid' }, answer);
	}
});

test('formatList: renders items or a placeholder', () => {
	assert.equal(formatList(['a', 'b']), '  - a\n  - b');
	assert.equal(formatList([]), '  -');
});
