import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TASKS } = require('./vscode.js');
const pkg = require('../package.json');

test('vscode TASKS: every npx call uses --no with a hugo- prefixed bin from package.json', () => {
	const calls = TASKS.tasks.flatMap((t) => [...t.command.matchAll(/npx\s+(\S+)\s+(\S+)/g)]);

	assert.ok(calls.length >= TASKS.tasks.length);

	for (const [, flag, bin] of calls) {
		assert.equal(flag, '--no');
		assert.match(bin, /^hugo-/);
		assert.ok(pkg.bin[bin], `${bin} is not a package bin`);
	}
});

test('package.json: every bin has a hugo- prefixed alias pointing at the same script', () => {
	for (const [name, file] of Object.entries(pkg.bin)) {
		if (name.startsWith('hugo-')) continue;

		assert.equal(pkg.bin[`hugo-${name}`], file, name);
	}
});
