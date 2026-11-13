import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractFrontmatter, parseListItems, generatePrefixes } = require('./extract-tags.js');

// ---------------------------------------------------------------------------
// extractFrontmatter
// ---------------------------------------------------------------------------

test('extractFrontmatter: returns frontmatter content between --- delimiters', () => {
	const content = '---\ntitle: My Post\ndraft: true\n---\nBody text here.';

	assert.equal(extractFrontmatter(content), 'title: My Post\ndraft: true');
});

test('extractFrontmatter: returns null when no frontmatter', () => {
	assert.equal(extractFrontmatter('Just body text with no delimiters.'), null);
});

test('extractFrontmatter: returns null when only one --- delimiter', () => {
	assert.equal(extractFrontmatter('---\ntitle: foo\nno closing delimiter'), null);
});

test('extractFrontmatter: handles empty frontmatter block', () => {
	assert.equal(extractFrontmatter('---\n\n---\nBody.'), '');
});

test('extractFrontmatter: does not include body content', () => {
	const content = '---\ntitle: foo\n---\nThis body should not appear.';
	const result = extractFrontmatter(content);

	assert.ok(!result.includes('This body'));
});

test('extractFrontmatter: handles --- appearing in body without confusion', () => {
	const content = '---\ntitle: foo\n---\nBody line.\n---\nAnother section.';
	const result = extractFrontmatter(content);

	assert.equal(result, 'title: foo');
});

// ---------------------------------------------------------------------------
// parseListItems
// ---------------------------------------------------------------------------

test('parseListItems: parses a simple list', () => {
	const fm = 'tags:\n  - JavaScript\n  - Go\n';

	assert.deepEqual(parseListItems(fm, 'tags'), ['JavaScript', 'Go']);
});

test('parseListItems: strips double quotes from values', () => {
	const fm = 'categories:\n  - "Technology"\n  - "Open Source"\n';

	assert.deepEqual(parseListItems(fm, 'categories'), ['Technology', 'Open Source']);
});

test('parseListItems: strips single quotes from values', () => {
	const fm = 'tags:\n  - \'JavaScript\'\n';

	assert.deepEqual(parseListItems(fm, 'tags'), ['JavaScript']);
});

test('parseListItems: returns empty array when key is not present', () => {
	assert.deepEqual(parseListItems('title: My Post\n', 'tags'), []);
});

test('parseListItems: returns empty array for empty file', () => {
	assert.deepEqual(parseListItems('', 'tags'), []);
});

test('parseListItems: handles multiple spaces before list items', () => {
	const fm = 'tags:\n    - foo\n    - bar\n';

	assert.deepEqual(parseListItems(fm, 'tags'), ['foo', 'bar']);
});

test('parseListItems: does not confuse tags and categories', () => {
	const fm = 'categories:\n  - Tech\ntags:\n  - Go\n';

	assert.deepEqual(parseListItems(fm, 'tags'), ['Go']);
	assert.deepEqual(parseListItems(fm, 'categories'), ['Tech']);
});

test('parseListItems: single item list', () => {
	const fm = 'tags:\n  - solo\n';

	assert.deepEqual(parseListItems(fm, 'tags'), ['solo']);
});

test('parseListItems: keeps the last item when the list ends the frontmatter', () => {
	const fm = extractFrontmatter('---\ntitle: x\ncategories:\n  - Tech\ntags:\n  - a\n  - b\n---\nbody');

	assert.deepEqual(parseListItems(fm, 'tags'), ['a', 'b']);
	assert.deepEqual(parseListItems(fm, 'categories'), ['Tech']);
});

test('parseListItems: parses inline lists', () => {
	assert.deepEqual(parseListItems('tags: [a, "b c", \'d\']\n', 'tags'), ['a', 'b c', 'd']);
	assert.deepEqual(parseListItems('tags: []\n', 'tags'), []);
});

test('parseListItems: parses a scalar value', () => {
	assert.deepEqual(parseListItems('categories: Tech\n', 'categories'), ['Tech']);
});

test('parseListItems: ignores empty placeholder items', () => {
	assert.deepEqual(parseListItems('tags:\n  -\ntitle: x\n', 'tags'), []);
});

test('extractFrontmatter: handles CRLF line endings', () => {
	const fm = extractFrontmatter('---\r\ntitle: x\r\ntags:\r\n  - a\r\n---\r\nbody');

	assert.equal(fm, 'title: x\ntags:\n  - a');
	assert.deepEqual(parseListItems(fm, 'tags'), ['a']);
});

// ---------------------------------------------------------------------------
// generatePrefixes
// ---------------------------------------------------------------------------

test('generatePrefixes: single word returns a string', () => {
	assert.equal(generatePrefixes('Go'), 'go');
});

test('generatePrefixes: single word with no abbreviation returns lowercase string', () => {
	assert.equal(generatePrefixes('JavaScript'), 'javascript');
});

test('generatePrefixes: multi-word returns array including concatenated form', () => {
	const result = generatePrefixes('Open Source');

	assert.ok(Array.isArray(result));
	assert.ok(result.includes('open source'));
	assert.ok(result.includes('opensource'));
});

test('generatePrefixes: known abbreviation is included', () => {
	const result = generatePrefixes('Technology');

	assert.ok(Array.isArray(result));
	assert.ok(result.includes('technology'));
	assert.ok(result.includes('tech'));
});

test('generatePrefixes: multi-word with abbreviation includes all forms', () => {
	const result = generatePrefixes('Web Development');

	assert.ok(result.includes('web development'));
	assert.ok(result.includes('webdevelopment'));
	assert.ok(result.includes('webdev'));
	assert.ok(result.includes('web'));
});

test('generatePrefixes: Open Source includes oss abbreviation', () => {
	const result = generatePrefixes('Open Source');

	assert.ok(result.includes('oss'));
});
