#!/usr/bin/env node
'use strict';

/**
 * Publishes a Hugo draft post now or on a specified date.
 * Usage:
 *   node scripts/publish.js content/drafts/My\ Draft.md now
 *   node scripts/publish.js content/drafts/My\ Draft.md later 2026-01-05
 *
 * later mode sets publish datetime to 08:00 America/Chicago on the chosen date.
 *
 * Behavior:
 * - Always overrides `date:` with the generated date (now/later).
 * - If the draft already had a different `date:`, emits a prominent GitHub Actions warning
 *   annotation (and a stderr warning when not in Actions).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');

const TZ = config.timezone;

// --- Timezone helpers ---

function getChicagoOffset(date) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ,
		timeZoneName: 'longOffset',
	}).formatToParts(date);

	// e.g. "GMT-06:00" → "-06:00"
	return parts.find((p) => p.type === 'timeZoneName').value.replace('GMT', '');
}

function toChicagoISO(date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(date);
	const get = (type) => parts.find((p) => p.type === type).value;
	let hour = get('hour');

	if (hour === '24') hour = '00';

	return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${getChicagoOffset(date)}`;
}

function getChicagoDateParts(date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const get = (type) => parts.find((p) => p.type === type).value;

	return { year: get('year'), month: get('month'), day: get('day') };
}

function chicagoAt8AM(dateStr) {
	// Returns ISO 8601 string for 08:00:00 America/Chicago on the given YYYY-MM-DD date.
	// Uses noon UTC to determine the DST-correct offset, then back-computes the UTC time for 08:00 local.
	const [year, month, day] = dateStr.split('-').map(Number);
	const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
	const offset = getChicagoOffset(noonUTC); // e.g. "-06:00"
	const match = offset.match(/([+-])(\d{2}):(\d{2})/);
	const offsetSign = match[1] === '+' ? 1 : -1;
	const offsetTotalMins = (parseInt(match[2], 10) * 60 + parseInt(match[3], 10)) * offsetSign;
	// UTCtime = localtime - offset  →  08:00 local = (8 - offsetHours) UTC
	const utcHour = 8 - offsetTotalMins / 60;
	const target = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));

	return `${dateStr}T08:00:00${getChicagoOffset(target)}`;
}

// --- Front matter helpers ---

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitFrontMatter(text) {
	if (!text.startsWith('---')) return { fm: '', body: text, had: false };

	const m1 = text.match(/^---\s*\n/);

	if (!m1) return { fm: '', body: text, had: false };

	const rest = text.slice(m1[0].length);
	const m2 = rest.match(/(?:^|\n)---\s*(?:\n|$)/m);

	if (!m2) return { fm: '', body: text, had: false };

	// When the match begins with \n that \n is the last line of fm, not part of the delimiter.
	const fmEnd = m2[0][0] === '\n' ? m2.index + 1 : m2.index;
	const fm = rest.slice(0, fmEnd);
	const body = rest.slice(m2.index + m2[0].length).replace(/^[\r\n]+/, '');

	return { fm, body, had: true };
}

function ensureLine(fm, key, value) {
	const ek = escapeRegex(key);
	const line = `${key}: ${value}`;

	if (new RegExp(`^${ek}\\s*:.*$`, 'm').test(fm)) {
		return fm.replace(new RegExp(`^${ek}\\s*:.*$`, 'gm'), line);
	}

	return fm.trimEnd() + (fm.trim() ? '\n' : '') + line + '\n';
}

function getScalarValue(fm, key) {
	const m = fm.match(new RegExp(`^${escapeRegex(key)}\\s*:\\s*(.*?)\\s*$`, 'm'));

	return m ? m[1].trim() : null;
}

function removeKey(fm, key) {
	const ek = escapeRegex(key);

	fm = fm.replace(new RegExp(`^${ek}[ \\t]*:[ \\t]*\\n(?:[ \\t]*-[ \\t]*.*\\n)+`, 'gm'), '');
	fm = fm.replace(new RegExp(`^${ek}\\s*:.*(?:\\n|$)`, 'gm'), '');
	return fm;
}

function ensurePlaceholderList(fm, key) {
	const ek = escapeRegex(key);

	if (new RegExp(`^${ek}\\s*:\\s*\\n(?:\\s*-\\s*.*\\n)+`, 'm').test(fm)) return fm;

	return fm.trimEnd() + (fm.trim() ? '\n' : '') + `${key}:\n  -\n`;
}

function parseTitleFromFm(fm) {
	const m = fm.match(/^title\s*:\s*(.+)/m);

	if (!m) return null;

	let raw = m[1].trim();

	if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))) {
		raw = raw.slice(1, -1);
	}

	return raw.trim() || null;
}

function titleFromBasename(b) {
	return b.replace(/[-_]/g, ' ')
		.split(' ')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function slugify(s) {
	s = s.trim().toLowerCase()
		.replace(/[\s_]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');
	return s || 'post';
}

function stripQuotes(val) {
	const v = val.trim();

	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) {
		return v.slice(1, -1).trim();
	}

	return v;
}

function extractListValues(fm, key) {
	const ek = escapeRegex(key);
	const blockMatch = fm.match(new RegExp(`^${ek}\\s*:\\s*\\n((?:\\s*-\\s*.*\\n)+)`, 'm'));

	if (blockMatch) {
		return blockMatch[1].split('\n')
			.map((line) => line.match(/^\s*-\s*(.+)\s*$/))
			.filter(Boolean)
			.map((m) => stripQuotes(m[1]))
			.filter((v) => v);
	}

	const scalar = getScalarValue(fm, key);

	if (scalar) {
		return scalar.split(',').map(stripQuotes).filter((v) => v);
	}

	return [];
}

function hasCategory(fm, name) {
	const target = name.trim().toLowerCase();

	for (const key of ['category', 'categories']) {
		for (const val of extractListValues(fm, key)) {
			if (val.toLowerCase() === target) return true;
		}
	}
	return false;
}

function ghaWarning(msg, file) {
	const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

	if (file) {
		process.stderr.write(`::warning file=${esc(file)},line=1,col=1::${esc(msg)}\n`);
	} else {
		process.stderr.write(`::warning::${esc(msg)}\n`);
	}
}

// --- Date title helpers for notes ---

// Matches titles like "Monday, 29 March, 2026"
const DATE_TITLE_RE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2} (January|February|March|April|May|June|July|August|September|October|November|December), \d{4}$/;

function formatChicagoDateTitle(isoStr) {
	const date = new Date(isoStr);
	const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(date);
	const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: '2-digit' }).format(date);
	const month = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(date);
	const year = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' }).format(date);

	return `${weekday}, ${day} ${month}, ${year}`;
}

function formatChicagoTime(isoStr) {
	const date = new Date(isoStr);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(date);
	const get = (type) => parts.find((p) => p.type === type).value;
	let hour = get('hour');

	if (hour === '24') hour = '00';

	return `${hour}:${get('minute')}`;
}

// --- Content processing ---

function processContent(text, mode, baseName, dateStamp, publishStamp, draftPath) {
	let { fm, body, had } = splitFrontMatter(text); // eslint-disable-line prefer-const

	if (!had) {
		fm = '';
		body = text.replace(/^[\r\n]+/, '');
	}

	const rawTitle = parseTitleFromFm(fm);
	const trimmedBody = body.trim();
	const wordCount = trimmedBody ? trimmedBody.split(/\s+/).length : 0;
	const hasAnyCategory = extractListValues(fm, 'category').length > 0 ||
    extractListValues(fm, 'categories').length > 0;
	const isNote = (hasCategory(fm, 'personal') || !hasAnyCategory) && wordCount < 350;

	fm = removeKey(fm, 'publishDate');

	const targetDate = mode === 'now' ? dateStamp : publishStamp;

	const existingDate = getScalarValue(fm, 'date');

	if (existingDate !== null && existingDate !== targetDate) {
		const warnMsg = `Draft already had date: ${existingDate} — overriding with generated date: ${targetDate}`;

		if (process.env.GITHUB_ACTIONS === 'true') {
			ghaWarning(warnMsg, draftPath);
		} else {
			process.stderr.write(`WARN: ${warnMsg}\n`);
		}
	}

	fm = ensureLine(fm, 'date', targetDate);

	let title = rawTitle || titleFromBasename(baseName);

	if (isNote) {
		if (!rawTitle) {
			title = formatChicagoDateTitle(targetDate);
		}

		if (DATE_TITLE_RE.test(title)) {
			title = `${title} - ${formatChicagoTime(targetDate)}`;
		}
	}

	const slug = slugify(title);

	fm = ensureLine(fm, 'title', `"${title}"`);
	fm = ensureLine(fm, 'draft', 'false');

	if (!isNote && !fm.match(/^description\s*:/m)) {
		fm = ensureLine(fm, 'description', '""');
	}

	if (isNote) {
		for (const key of ['images', 'description', 'tags', 'category', 'categories']) {
			fm = removeKey(fm, key);
		}
		fm = ensureLine(fm, 'date', targetDate);
	} else {
		fm = ensurePlaceholderList(fm, 'categories');
		fm = ensurePlaceholderList(fm, 'tags');
	}

	if (!isNote) {
		if (!hasAnyCategory) {
			throw new Error(`Error: post has ${wordCount} words — notes must be under 350 words. Add categories and tags to publish as a post instead.`);
		}

		if (!rawTitle) {
			throw new Error('Error: post must have a title in front matter before publishing');
		}

		if (extractListValues(fm, 'tags').length === 0) {
			throw new Error('Error: post must have at least one tag before publishing');
		}
	}

	fm = fm.trimEnd() + '\n';
	const updated = `---\n${fm}---\n\n${body.trimStart()}`;

	return { slug, typeDir: isNote ? 'notes' : 'posts', updated };
}

// --- Interactive prompt ---

async function ask(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

// --- Main ---

async function main() {
	config.requireHugoSite();

	const draftPath = process.argv[2];
	let mode = process.argv[3] || '';

	if (!draftPath) {
		console.error('Error: draft path required (e.g. content/drafts/My Draft.md)');
		process.exit(1);
	}

	const draftsPrefix = config.draftsDir.replace(/\\/g, '/').replace(/\/$/, '');

	if (!draftPath.startsWith(draftsPrefix + '/') || !draftPath.endsWith('.md')) {
		console.error(`Error: draft must be under ${config.draftsDir}/*.md`);
		process.exit(1);
	}

	if (!fs.existsSync(draftPath)) {
		console.error(`Error: file not found: ${draftPath}`);
		process.exit(1);
	}

	if (!mode) {
		mode = await ask('Choose mode: now | later\n');
	}

	const now = new Date();
	let dateStamp = '';
	let publishStamp = '';
	let year, month, day;

	if (mode === 'now') {
		dateStamp = toChicagoISO(now);
		({ year, month, day } = getChicagoDateParts(now));
	} else if (mode === 'later') {
		let pubDate = process.argv[4] || '';

		if (!pubDate) {
			pubDate = await ask('Enter publish date (YYYY-MM-DD):\n');
		}

		if (!/^\d{4}-\d{2}-\d{2}$/.test(pubDate)) {
			console.error('Error: date must be YYYY-MM-DD');
			process.exit(1);
		}

		publishStamp = chicagoAt8AM(pubDate);
		year = pubDate.slice(0, 4);
		month = pubDate.slice(5, 7);
		day = pubDate.slice(8, 10);
	} else {
		console.error('Error: mode must be \'now\' or \'later\'');
		process.exit(1);
	}

	const baseName = path.basename(draftPath, '.md');
	const text = fs.readFileSync(draftPath, 'utf8');

	let slug, typeDir, updated;

	try {
		({ slug, typeDir, updated } = processContent(
			text, mode, baseName, dateStamp, publishStamp, draftPath,
		));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}

	const baseDir = typeDir === 'notes' ? config.notesDir : config.postsDir;
	const destDir = path.join(baseDir, year);
	const destPath = path.join(destDir, `${month}-${day}-${slug}.md`);

	if (fs.existsSync(destPath)) {
		console.error(`Error: destination already exists: ${destPath}`);
		process.exit(1);
	}

	fs.mkdirSync(destDir, { recursive: true });
	fs.writeFileSync(destPath, updated, 'utf8');
	fs.unlinkSync(draftPath);

	console.log('Published:');
	console.log(`  ${destPath}`);
}

if (require.main === module) {
	process.on('SIGINT', () => {
		console.log('\nCancelled.');
		process.exit(0);
	});

	main().catch((err) => {
		console.error('Error:', err);
		process.exit(1);
	});
}

module.exports = {
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
};
