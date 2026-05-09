import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { urlFromImagesDir, appendMarkdown, insertImage } = require('./pick-image.js');

// ---------------------------------------------------------------------------
// urlFromImagesDir
// ---------------------------------------------------------------------------

test('urlFromImagesDir: strips assets/ prefix', () => {
  assert.equal(urlFromImagesDir('assets/images', '2026', '05', 'photo.jpg'), '/images/2026/05/photo.jpg');
});

test('urlFromImagesDir: preserves dir without assets/ prefix', () => {
  assert.equal(urlFromImagesDir('images', '2026', '05', 'photo.jpg'), '/images/2026/05/photo.jpg');
});

test('urlFromImagesDir: preserves custom directory name', () => {
  assert.equal(urlFromImagesDir('assets/media', '2026', '05', 'photo.jpg'), '/media/2026/05/photo.jpg');
});

// ---------------------------------------------------------------------------
// appendMarkdown
// ---------------------------------------------------------------------------

test('appendMarkdown: appends image tag with blank line separator', () => {
  const result = appendMarkdown('Body text.\n', '/images/2026/05/photo.jpg');
  assert.equal(result, 'Body text.\n\n![](/images/2026/05/photo.jpg)\n');
});

test('appendMarkdown: trims trailing whitespace before appending', () => {
  const result = appendMarkdown('Body text.\n\n\n', '/images/2026/05/photo.jpg');
  assert.equal(result, 'Body text.\n\n![](/images/2026/05/photo.jpg)\n');
});

test('appendMarkdown: works when content has no trailing newline', () => {
  const result = appendMarkdown('Body text.', '/images/2026/05/photo.jpg');
  assert.equal(result, 'Body text.\n\n![](/images/2026/05/photo.jpg)\n');
});

// ---------------------------------------------------------------------------
// insertImage — no frontmatter or no images: field → markdown fallback
// ---------------------------------------------------------------------------

test('insertImage: appends markdown when no frontmatter', () => {
  const content = 'Just a plain body.\n';
  const result = insertImage(content, '/images/2026/05/photo.jpg');
  assert.ok(result.includes('![](/images/2026/05/photo.jpg)'));
  assert.ok(result.includes('Just a plain body.'));
});

test('insertImage: appends markdown when frontmatter has no images: field', () => {
  const content = '---\ntitle: "My Post"\n---\nBody text.\n';
  const result = insertImage(content, '/images/2026/05/photo.jpg');
  assert.ok(result.includes('![](/images/2026/05/photo.jpg)'));
  assert.ok(result.includes('Body text.'));
});

// ---------------------------------------------------------------------------
// insertImage — frontmatter images: array manipulation
// ---------------------------------------------------------------------------

test('insertImage: replaces placeholder (  -) with real path', () => {
  const content = '---\ntitle: "My Post"\nimages:\n  -\n---\nBody.\n';
  const result = insertImage(content, '/images/2026/05/photo.jpg');
  assert.ok(result.includes('  - /images/2026/05/photo.jpg'));
  assert.ok(!result.includes('\n  -\n'));
  assert.ok(!result.includes('![]('));
});

test('insertImage: appends to existing single-item images array', () => {
  const content = '---\ntitle: "My Post"\nimages:\n  - /images/2026/01/old.jpg\n---\nBody.\n';
  const result = insertImage(content, '/images/2026/05/new.jpg');
  assert.ok(result.includes('  - /images/2026/01/old.jpg'));
  assert.ok(result.includes('  - /images/2026/05/new.jpg'));
  assert.ok(!result.includes('![]('));
});

test('insertImage: appends to existing multi-item images array', () => {
  const content = '---\nimages:\n  - /images/2026/01/a.jpg\n  - /images/2026/02/b.jpg\n---\n';
  const result = insertImage(content, '/images/2026/05/c.jpg');
  const lines = result.split('\n');
  const imgLines = lines.filter(l => l.startsWith('  - '));
  assert.equal(imgLines.length, 3);
  assert.equal(imgLines[2], '  - /images/2026/05/c.jpg');
});

test('insertImage: does not duplicate existing items', () => {
  const content = '---\nimages:\n  - /images/2026/01/a.jpg\n---\n';
  const result = insertImage(content, '/images/2026/05/b.jpg');
  const count = (result.match(/ {2}- \/images/g) || []).length;
  assert.equal(count, 2);
});

test('insertImage: leaves other frontmatter fields untouched', () => {
  const content = '---\ntitle: "My Post"\nimages:\n  -\ncategories:\n  - Tech\ntags:\n  - go\n---\nBody.\n';
  const result = insertImage(content, '/images/2026/05/photo.jpg');
  assert.ok(result.includes('title: "My Post"'));
  assert.ok(result.includes('categories:\n  - Tech'));
  assert.ok(result.includes('tags:\n  - go'));
  assert.ok(result.includes('Body.'));
});

test('insertImage: body content is preserved when updating frontmatter', () => {
  const content = '---\ntitle: "My Post"\nimages:\n  -\n---\nThis is the body.\n';
  const result = insertImage(content, '/images/2026/05/photo.jpg');
  assert.ok(result.includes('This is the body.'));
});
