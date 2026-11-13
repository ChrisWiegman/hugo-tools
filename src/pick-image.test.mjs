import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { urlFromImagesDir, appendMarkdown, insertImage, copyToClipboard, yearMonthIn, moveFile } = require('./pick-image.js');

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
	const imgLines = lines.filter((l) => l.startsWith('  - '));

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

// ---------------------------------------------------------------------------
// insertImage — other list styles
// ---------------------------------------------------------------------------

test('insertImage: converts an empty inline list', () => {
	const result = insertImage('---\ntitle: x\nimages: []\n---\nbody', '/images/a.jpg');

	assert.equal(result, '---\ntitle: x\nimages:\n  - /images/a.jpg\n---\nbody');
});

test('insertImage: converts a populated inline list', () => {
	const result = insertImage('---\nimages: ["/images/old.jpg"]\n---\n', '/images/new.jpg');

	assert.equal(result, '---\nimages:\n  - /images/old.jpg\n  - /images/new.jpg\n---\n');
});

test('insertImage: converts a scalar value', () => {
	const result = insertImage('---\nimages: /images/old.jpg\n---\n', '/images/new.jpg');

	assert.equal(result, '---\nimages:\n  - /images/old.jpg\n  - /images/new.jpg\n---\n');
});

test('insertImage: keeps existing items at zero indent', () => {
	const result = insertImage('---\nimages:\n- /images/old.jpg\ntags:\n  - a\n---\n', '/images/new.jpg');

	assert.equal(result, '---\nimages:\n- /images/old.jpg\n- /images/new.jpg\ntags:\n  - a\n---\n');
});

test('insertImage: keeps existing items at four-space indent', () => {
	const result = insertImage('---\nimages:\n    - /images/old.jpg\n---\n', '/images/new.jpg');

	assert.equal(result, '---\nimages:\n    - /images/old.jpg\n    - /images/new.jpg\n---\n');
});

test('insertImage: ignores an images: line in the body', () => {
	const result = insertImage('---\ntitle: x\n---\nimages:\n  - nope\n', '/images/new.jpg');

	assert.ok(result.endsWith('![](/images/new.jpg)\n'));
	assert.ok(result.includes('  - nope'));
});

test('insertImage: preserves CRLF line endings', () => {
	const result = insertImage('---\r\nimages:\r\n  -\r\n---\r\nbody', '/images/a.jpg');

	assert.equal(result, '---\r\nimages:\r\n  - /images/a.jpg\r\n---\r\nbody');
});

// ---------------------------------------------------------------------------
// copyToClipboard
// ---------------------------------------------------------------------------

function recordingExec(failFor = []) {
	const calls = [];
	const exec = (cmd, args, opts) => {
		calls.push({ cmd, args, input: opts.input });

		if (failFor.includes(cmd)) throw new Error('not found');
	};

	return { calls, exec };
}

test('copyToClipboard: macOS passes text to pbcopy on stdin, not through a shell', () => {
	const { calls, exec } = recordingExec();
	const text = '/images/2026/05/$(touch pwned)"`x`.png';

	assert.equal(copyToClipboard(text, { platform: 'darwin', exec }), true);
	assert.deepEqual(calls, [{ cmd: 'pbcopy', args: [], input: text }]);
});

test('copyToClipboard: Linux falls through to the next available tool', () => {
	const { calls, exec } = recordingExec(['xclip']);

	assert.equal(copyToClipboard('/a.png', { platform: 'linux', exec }), true);
	assert.deepEqual(calls.map((c) => c.cmd), ['xclip', 'xsel']);
});

test('copyToClipboard: returns false when no tool works', () => {
	const { exec } = recordingExec(['clip']);

	assert.equal(copyToClipboard('/a.png', { platform: 'win32', exec }), false);
});

// ---------------------------------------------------------------------------
// yearMonthIn
// ---------------------------------------------------------------------------

test('yearMonthIn: uses the configured timezone, not the machine timezone', () => {
	// 03:00 UTC on Jan 1 is still Dec 31 in Chicago
	const date = new Date('2026-01-01T03:00:00Z');

	assert.deepEqual(yearMonthIn('America/Chicago', date), { year: '2025', month: '12' });
	assert.deepEqual(yearMonthIn('Asia/Tokyo', date), { year: '2026', month: '01' });
});

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------

test('moveFile: renames within the same filesystem', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-image-'));
	const src = path.join(dir, 'a.jpg');
	const dest = path.join(dir, 'b.jpg');

	fs.writeFileSync(src, 'img');
	moveFile(src, dest);
	assert.equal(fs.existsSync(src), false);
	assert.equal(fs.readFileSync(dest, 'utf8'), 'img');
	fs.rmSync(dir, { recursive: true });
});

test('moveFile: falls back to copy + delete on EXDEV', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-image-'));
	const src = path.join(dir, 'a.jpg');
	const dest = path.join(dir, 'b.jpg');
	const crossDevice = {
		...fs,
		renameSync() {
			throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
		},
	};

	fs.writeFileSync(src, 'img');
	moveFile(src, dest, crossDevice);
	assert.equal(fs.existsSync(src), false);
	assert.equal(fs.readFileSync(dest, 'utf8'), 'img');
	fs.rmSync(dir, { recursive: true });
});

test('moveFile: rethrows other errors', () => {
	const failing = {
		renameSync() {
			throw Object.assign(new Error('denied'), { code: 'EACCES' });
		},
	};

	assert.throws(() => moveFile('a', 'b', failing), /denied/);
});
