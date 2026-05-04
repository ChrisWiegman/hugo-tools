import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  processContent,
  splitFrontMatter,
  ensureLine,
  ensurePlaceholderList,
  getScalarValue,
  removeKey,
  extractListValues,
  hasCategory,
  parseTitleFromFm,
  titleFromBasename,
  slugify,
  stripQuotes,
  chicagoAt8AM,
  formatChicagoDateTitle,
  formatChicagoTime,
} = require('./publish.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Produces a body string of exactly n space-separated words.
function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

// Mirrors the output of `hugo new content/drafts/<file>.md` using the drafts
// archetype, followed by the perl one-liner that strips the date: line.
// Callers can override any field; categories/tags default to placeholder lists.
function makeDraft({
  title = '',
  description = '',
  categories = null, // null → placeholder "  -", array → real values
  tags = null,       // null → placeholder "  -", array → real values
  body = '',
  publishDate,
} = {}) {
  const lines = [
    '---',
    `title: "${title}"`,
    `description: "${description}"`,
    'draft: true',
    'images:',
    '  -',
    'categories:',
  ];

  if (categories === null) {
    lines.push('  -');
  } else {
    for (const c of categories) lines.push(`  - ${c}`);
  }

  lines.push('tags:');
  if (tags === null) {
    lines.push('  -');
  } else {
    for (const t of tags) lines.push(`  - ${t}`);
  }

  if (publishDate !== undefined) lines.push(`publishDate: ${publishDate}`);
  lines.push('---');
  if (body) lines.push('', body);
  return lines.join('\n');
}

const NOW_STAMP   = '2026-05-04T10:00:00-05:00';
const LATER_STAMP = '2026-06-01T08:00:00-05:00';
const DRAFT_PATH  = 'content/drafts/my-post.md';

// ---------------------------------------------------------------------------
// splitFrontMatter
// ---------------------------------------------------------------------------

test('splitFrontMatter: parses standard frontmatter', () => {
  const { fm, body, had } = splitFrontMatter('---\ntitle: foo\n---\nbody text');
  assert.equal(had, true);
  assert.ok(fm.includes('title: foo'));
  assert.ok(body.includes('body text'));
});

test('splitFrontMatter: returns had=false when no opening ---', () => {
  const { had, body } = splitFrontMatter('just body text');
  assert.equal(had, false);
  assert.equal(body, 'just body text');
});

test('splitFrontMatter: handles empty frontmatter block', () => {
  const { fm, had } = splitFrontMatter('---\n---\nbody');
  assert.equal(had, true);
  assert.equal(fm, '');
});

test('splitFrontMatter: body after closing --- is preserved', () => {
  const { body } = splitFrontMatter('---\nfoo: bar\n---\nline1\nline2');
  assert.ok(body.includes('line1'));
  assert.ok(body.includes('line2'));
});

test('splitFrontMatter: trailing newline in fm preserved for list parsing', () => {
  // Regression: when closing --- immediately follows a list item, the \n
  // before --- must remain in fm so extractListValues can match.
  const text = '---\ncategories:\n  - Personal\n---\nbody';
  const { fm } = splitFrontMatter(text);
  assert.ok(fm.endsWith('\n'), 'fm should end with newline');
  assert.ok(fm.includes('  - Personal'));
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: lowercases and hyphenates spaces', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: strips special characters', () => {
  assert.equal(slugify("It's Great!"), 'its-great');
});

test('slugify: collapses multiple hyphens', () => {
  assert.equal(slugify('a--b---c'), 'a-b-c');
});

test('slugify: falls back to "post" for empty string', () => {
  assert.equal(slugify(''), 'post');
});

// ---------------------------------------------------------------------------
// parseTitleFromFm
// ---------------------------------------------------------------------------

test('parseTitleFromFm: returns quoted title without quotes', () => {
  assert.equal(parseTitleFromFm('title: "My Post"'), 'My Post');
});

test('parseTitleFromFm: returns unquoted title', () => {
  assert.equal(parseTitleFromFm('title: My Post'), 'My Post');
});

test('parseTitleFromFm: returns null when title key is absent', () => {
  assert.equal(parseTitleFromFm('draft: true\n'), null);
});

test('parseTitleFromFm: returns null for empty quoted title (archetype default)', () => {
  assert.equal(parseTitleFromFm('title: ""\n'), null);
});

// ---------------------------------------------------------------------------
// titleFromBasename
// ---------------------------------------------------------------------------

test('titleFromBasename: hyphen-separated becomes Title Case', () => {
  assert.equal(titleFromBasename('my-draft-post'), 'My Draft Post');
});

test('titleFromBasename: underscore-separated becomes Title Case', () => {
  assert.equal(titleFromBasename('my_draft_post'), 'My Draft Post');
});

// ---------------------------------------------------------------------------
// extractListValues
// ---------------------------------------------------------------------------

test('extractListValues: reads YAML list items', () => {
  const fm = 'tags:\n  - foo\n  - bar\n';
  assert.deepEqual(extractListValues(fm, 'tags'), ['foo', 'bar']);
});

test('extractListValues: strips quotes from items', () => {
  const fm = 'tags:\n  - "foo"\n  - \'bar\'\n';
  assert.deepEqual(extractListValues(fm, 'tags'), ['foo', 'bar']);
});

test('extractListValues: returns [] for key not present', () => {
  assert.deepEqual(extractListValues('title: foo\n', 'tags'), []);
});

test('extractListValues: returns [] for archetype placeholder list (  -)', () => {
  assert.deepEqual(extractListValues('tags:\n  -\n', 'tags'), []);
});

// ---------------------------------------------------------------------------
// hasCategory
// ---------------------------------------------------------------------------

test('hasCategory: finds match in categories key', () => {
  assert.equal(hasCategory('categories:\n  - Technology\n', 'Technology'), true);
});

test('hasCategory: finds match in category key (singular)', () => {
  assert.equal(hasCategory('category:\n  - Personal\n', 'personal'), true);
});

test('hasCategory: is case-insensitive', () => {
  assert.equal(hasCategory('categories:\n  - PERSONAL\n', 'personal'), true);
});

test('hasCategory: returns false for placeholder list', () => {
  assert.equal(hasCategory('categories:\n  -\n', 'personal'), false);
});

test('hasCategory: returns false when not present', () => {
  assert.equal(hasCategory('categories:\n  - Technology\n', 'personal'), false);
});

// ---------------------------------------------------------------------------
// getScalarValue / ensureLine / removeKey
// ---------------------------------------------------------------------------

test('getScalarValue: reads a scalar front matter value', () => {
  assert.equal(getScalarValue('date: 2026-05-04\n', 'date'), '2026-05-04');
});

test('getScalarValue: returns null when key absent', () => {
  assert.equal(getScalarValue('title: foo\n', 'date'), null);
});

test('ensureLine: adds a new key when absent', () => {
  const result = ensureLine('title: foo\n', 'draft', 'false');
  assert.ok(result.includes('draft: false'));
});

test('ensureLine: overwrites an existing key', () => {
  const result = ensureLine('draft: true\n', 'draft', 'false');
  assert.ok(result.includes('draft: false'));
  assert.ok(!result.includes('draft: true'));
});

test('removeKey: removes a scalar key', () => {
  const result = removeKey('publishDate: 2026-01-01\ntitle: foo\n', 'publishDate');
  assert.ok(!result.includes('publishDate'));
  assert.ok(result.includes('title: foo'));
});

test('removeKey: removes a list key and its items', () => {
  const result = removeKey('tags:\n  - foo\n  - bar\ntitle: x\n', 'tags');
  assert.ok(!result.includes('tags:'));
  assert.ok(result.includes('title: x'));
});

test('removeKey: removes placeholder list', () => {
  const result = removeKey('tags:\n  -\ntitle: x\n', 'tags');
  assert.ok(!result.includes('tags:'));
  assert.ok(result.includes('title: x'));
});

// ---------------------------------------------------------------------------
// chicagoAt8AM
// ---------------------------------------------------------------------------

test('chicagoAt8AM: returns CST offset in winter', () => {
  assert.equal(chicagoAt8AM('2026-01-15'), '2026-01-15T08:00:00-06:00');
});

test('chicagoAt8AM: returns CDT offset in summer', () => {
  assert.equal(chicagoAt8AM('2026-07-15'), '2026-07-15T08:00:00-05:00');
});

// ---------------------------------------------------------------------------
// processContent — note detection
// ---------------------------------------------------------------------------

test('processContent: placeholder categories (no real cats) → note', () => {
  const text = makeDraft({ body: words(10) });
  const { typeDir } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(typeDir, 'notes');
});

test('processContent: personal category with short body → note', () => {
  const text = makeDraft({ categories: ['Personal'], body: words(10) });
  const { typeDir } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(typeDir, 'notes');
});

test('processContent: non-personal category with tags → post', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Technology'], tags: ['JavaScript'], body: words(10) });
  const { typeDir } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(typeDir, 'posts');
});

test('processContent: long post (>=200 words) with categories → post', () => {
  const text = makeDraft({ title: 'Long Post', categories: ['Technology'], tags: ['Go'], body: words(200) });
  const { typeDir } = processContent(text, 'now', 'long-post', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(typeDir, 'posts');
});

// ---------------------------------------------------------------------------
// processContent — frontmatter mutations
// ---------------------------------------------------------------------------

test('processContent: sets draft: false', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('draft: false'));
  assert.ok(!updated.includes('draft: true'));
});

test('processContent: sets date to dateStamp in now mode', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes(`date: ${NOW_STAMP}`));
});

test('processContent: sets date to publishStamp in later mode', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'later', 'my-post', '', LATER_STAMP, DRAFT_PATH);
  assert.ok(updated.includes(`date: ${LATER_STAMP}`));
});

test('processContent: removes publishDate key', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], publishDate: '2026-01-01', body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(!updated.includes('publishDate'));
});

test('processContent: slug is derived from frontmatter title', () => {
  const text = makeDraft({ title: 'Hello World', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { slug } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(slug, 'hello-world');
});

test('processContent: body content is preserved', () => {
  const body = 'This is the body. ' + words(5);
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], body });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('This is the body.'));
});

// ---------------------------------------------------------------------------
// processContent — post-specific frontmatter
// ---------------------------------------------------------------------------

test('processContent: preserves existing description for post', () => {
  const text = makeDraft({ title: 'My Post', description: 'Existing desc', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('description: "Existing desc"'));
});

test('processContent: retains placeholder description when post has no description set', () => {
  // Archetype provides description: "" — processContent should not overwrite it
  const text = makeDraft({ title: 'My Post', categories: ['Tech'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('description:'));
});

test('processContent: categories block is present in published post', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Technology'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('categories:'));
});

test('processContent: tags block is present in published post', () => {
  const text = makeDraft({ title: 'My Post', categories: ['Technology'], tags: ['go'], body: words(10) });
  const { updated } = processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(updated.includes('tags:'));
});

// ---------------------------------------------------------------------------
// processContent — note-specific frontmatter
// ---------------------------------------------------------------------------

test('processContent: strips tags from note', () => {
  const text = makeDraft({ body: words(5) });
  const { updated } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(!updated.includes('tags:'));
});

test('processContent: strips categories from note', () => {
  const text = makeDraft({ categories: ['Personal'], body: words(5) });
  const { updated } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(!updated.includes('categories:'));
});

test('processContent: strips description from note', () => {
  const text = makeDraft({ body: words(5) });
  const { updated } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(!updated.includes('description:'));
});

test('processContent: strips images from note', () => {
  const text = makeDraft({ body: words(5) });
  const { updated } = processContent(text, 'now', 'a-note', NOW_STAMP, '', DRAFT_PATH);
  assert.ok(!updated.includes('images:'));
});

// ---------------------------------------------------------------------------
// processContent — no frontmatter input
// ---------------------------------------------------------------------------

test('processContent: handles draft with no frontmatter as note', () => {
  const { typeDir } = processContent(words(5), 'now', 'quick-note', NOW_STAMP, '', DRAFT_PATH);
  assert.equal(typeDir, 'notes');
});

// ---------------------------------------------------------------------------
// processContent — error cases
// ---------------------------------------------------------------------------

test('processContent: throws for 200+ word draft with no real categories', () => {
  const text = makeDraft({ body: words(200) });
  assert.throws(
    () => processContent(text, 'now', 'long-post', NOW_STAMP, '', DRAFT_PATH),
    /notes must be under 200 words/
  );
});

test('processContent: throws for post without a frontmatter title', () => {
  // title: "" is the archetype default — parseTitleFromFm returns null
  const text = makeDraft({ categories: ['Technology'], tags: ['go'], body: words(10) });
  assert.throws(
    () => processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH),
    /must have a title/
  );
});

test('processContent: throws for post with placeholder tags only', () => {
  // tags: - (placeholder) counts as no tags
  const text = makeDraft({ title: 'My Post', categories: ['Technology'], body: words(10) });
  assert.throws(
    () => processContent(text, 'now', 'my-post', NOW_STAMP, '', DRAFT_PATH),
    /must have at least one tag/
  );
});

// ---------------------------------------------------------------------------
// stripQuotes
// ---------------------------------------------------------------------------

test('stripQuotes: strips double quotes', () => {
  assert.equal(stripQuotes('"hello"'), 'hello');
});

test('stripQuotes: strips single quotes', () => {
  assert.equal(stripQuotes("'hello'"), 'hello');
});

test('stripQuotes: returns value unchanged when no quotes', () => {
  assert.equal(stripQuotes('hello'), 'hello');
});

test('stripQuotes: preserves internal spaces', () => {
  assert.equal(stripQuotes('"hello world"'), 'hello world');
});

test('stripQuotes: trims surrounding whitespace', () => {
  assert.equal(stripQuotes('  hello  '), 'hello');
});

// ---------------------------------------------------------------------------
// ensurePlaceholderList
// ---------------------------------------------------------------------------

test('ensurePlaceholderList: adds placeholder when key is absent', () => {
  const result = ensurePlaceholderList('title: foo\n', 'tags');
  assert.ok(result.includes('tags:\n  -\n'));
});

test('ensurePlaceholderList: does not add when list with items already present', () => {
  const fm = 'tags:\n  - go\n';
  const result = ensurePlaceholderList(fm, 'tags');
  assert.equal(result, fm);
});

test('ensurePlaceholderList: does not add when placeholder already present', () => {
  const fm = 'tags:\n  -\n';
  const result = ensurePlaceholderList(fm, 'tags');
  assert.equal(result, fm);
});

// ---------------------------------------------------------------------------
// formatChicagoDateTitle / formatChicagoTime
// ---------------------------------------------------------------------------

test('formatChicagoDateTitle: formats as Weekday, DD Month, YYYY', () => {
  assert.equal(formatChicagoDateTitle('2026-05-04T10:00:00-05:00'), 'Monday, 04 May, 2026');
});

test('formatChicagoDateTitle: uses Chicago time (CDT in summer)', () => {
  // 2026-07-15 is a Wednesday
  assert.equal(formatChicagoDateTitle('2026-07-15T08:00:00-05:00'), 'Wednesday, 15 July, 2026');
});

test('formatChicagoTime: returns HH:MM in 24-hour format', () => {
  assert.equal(formatChicagoTime('2026-05-04T10:30:00-05:00'), '10:30');
});

test('formatChicagoTime: pads minutes to two digits', () => {
  assert.equal(formatChicagoTime('2026-05-04T08:05:00-05:00'), '08:05');
});
