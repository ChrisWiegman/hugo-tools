#!/usr/bin/env node
'use strict';

// Moves an image into assets/images/<year>/<month>/ and inserts a reference
// into a Hugo content file — appending to the frontmatter images: array when
// present, or appending a markdown image tag to the body otherwise.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function urlFromImagesDir(imagesDir, year, month, filename) {
	const urlBase = imagesDir.replace(/^assets\//, '');

	return `/${urlBase}/${year}/${month}/${filename}`;
}

function appendMarkdown(content, urlPath) {
	return `${content.trimEnd()}\n\n![](${urlPath})\n`;
}

function cleanItem(raw) {
	return raw.trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Returns the `images:` value rewritten as a block list with urlPath appended.
 * Handles block lists at any indent, the `  -` placeholder, inline `[a, b]`
 * lists and single scalar values.
 */
function rewriteImagesField(lines, idx, urlPath) {
	const rest = lines[idx].replace(/^images\s*:/, '').trim();
	let items = [];
	let indent = '  ';
	let end = idx + 1;

	if (rest.startsWith('[')) {
		items = rest.replace(/^\[|\]$/g, '').split(',').map(cleanItem);
	} else if (rest) {
		items = [cleanItem(rest)];
	} else {
		let first = true;

		while (end < lines.length) {
			const m = lines[end].match(/^(\s*)-(?:\s+(.*))?\s*$/);

			if (!m) break;

			if (first) {
				indent = m[1];
				first = false;
			}

			items.push(m[2] ? m[2].trim() : '');
			end++;
		}
	}

	items = items.filter(Boolean);
	items.push(urlPath);

	return [...lines.slice(0, idx), 'images:', ...items.map((item) => `${indent}- ${item}`), ...lines.slice(end)];
}

function insertImage(content, urlPath) {
	const crlf = content.includes('\r\n');
	const text = crlf ? content.replace(/\r\n/g, '\n') : content;
	const restore = (out) => (crlf ? out.replace(/\n/g, '\r\n') : out);

	if (!text.startsWith('---\n')) {
		return restore(appendMarkdown(text, urlPath));
	}

	const lines = text.split('\n');
	const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');

	if (closeIdx === -1) {
		return restore(appendMarkdown(text, urlPath));
	}

	const imagesIdx = lines.findIndex((l, i) => i > 0 && i < closeIdx && /^images\s*:/.test(l));

	if (imagesIdx === -1) {
		return restore(appendMarkdown(text, urlPath));
	}

	return restore(rewriteImagesField(lines, imagesIdx, urlPath).join('\n'));
}

/**
 * Copy text to the system clipboard. Commands are run with execFileSync and the text
 * passed on stdin — never through a shell — so filenames can't inject commands.
 * Returns true on success.
 */
function copyToClipboard(text, { platform = process.platform, exec = execFileSync } = {}) {
	const candidates = {
		darwin: [['pbcopy', []]],
		win32: [['clip', []]],
	}[platform] || [
		['xclip', ['-selection', 'clipboard']],
		['xsel', ['--clipboard', '--input']],
		['wl-copy', []],
	];

	for (const [cmd, args] of candidates) {
		try {
			exec(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
			return true;
		} catch {
			// try next
		}
	}

	return false;
}

if (require.main === module) {
	config.requireHugoSite();

	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.error('Usage: pick-image <image-file> [content-file]');
		process.exit(1);
	}

	const imageFile = path.resolve(args[0]);
	const contentFile = args[1] ? path.resolve(args[1]) : null;

	if (!fs.existsSync(imageFile)) {
		console.error(`Image not found: ${imageFile}`);
		process.exit(1);
	}

	const ext = path.extname(imageFile).toLowerCase();

	if (!IMAGE_EXTS.has(ext)) {
		console.error(`Unsupported image format: ${ext}`);
		process.exit(1);
	}

	const now = new Date();
	const year = now.getFullYear().toString();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const filename = path.basename(imageFile);
	const destDir = path.join(process.cwd(), config.imagesDir, year, month);
	const destFile = path.join(destDir, filename);
	const urlPath = urlFromImagesDir(config.imagesDir, year, month, filename);

	fs.mkdirSync(destDir, { recursive: true });

	if (path.resolve(imageFile) !== path.resolve(destFile)) {
		if (fs.existsSync(destFile)) {
			console.error(`File already exists at destination: ${destFile}`);
			process.exit(1);
		}

		fs.renameSync(imageFile, destFile);
		console.log(`Moved to: ${destFile}`);
	}

	if (!contentFile) {
		if (copyToClipboard(urlPath)) {
			console.log(`Path copied to clipboard: ${urlPath}`);
		} else {
			console.log(`Path: ${urlPath}`);
			console.log('(clipboard unavailable — copy the path above manually)');
		}

		process.exit(0);
	}

	if (!fs.existsSync(contentFile)) {
		console.error(`Content file not found: ${contentFile}`);
		process.exit(1);
	}

	const original = fs.readFileSync(contentFile, 'utf8');
	const updated = insertImage(original, urlPath);

	fs.writeFileSync(contentFile, updated);
	console.log(`Updated: ${path.relative(process.cwd(), contentFile)}`);
}

module.exports = { urlFromImagesDir, appendMarkdown, insertImage, copyToClipboard };
