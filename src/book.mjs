#!/usr/bin/env node
/**
 * Goodreads → Hugo Books importer (NO covers)
 * - Writes: content/books/<author-last-first>/<title-slug>.md
 * - Front matter:
 *   title, author, rating (0-5), finished ([YYYY-MM-DD...]), links { amazon, openlibrary, goodreads },
 *   reference { isbn, asin }
 * - Review (if any) becomes body content
 * - finished uses Date Read; if blank, Date Added (only for Exclusive Shelf == "read")
 *
 * Idempotency / no duplicates:
 * - Running this script multiple times will NOT create duplicate files.
 * - Existing files are matched by Goodreads Book ID first, then ISBN, then title slug.
 * - When a match is found at a different path (title changed in Goodreads), the file is
 *   renamed to the new slug and the title in front matter is updated automatically.
 * - For an existing book file, finished dates are merged and the rating is updated when the
 *   Goodreads rating differs from the file's rating — but only when Goodreads has a rating
 *   (> 0). A Goodreads rating of 0 (unrated) never overwrites a rating already in the file,
 *   since you may have rated the book only in the markdown. Other fields are left untouched
 *   unless a rename occurs (in which case the title is also updated).
 * - reference.isbn/asin are backfilled onto existing files that are missing them, but a
 *   value already present in the file (e.g. entered by hand) is never overwritten.
 *
 * ASIN lookup:
 * - Goodreads exports don't include an ASIN, so it's looked up per ISBN from Open Library,
 *   then Google Books, and left blank if neither has one. Configure an Amazon Product
 *   Advertising API key in .hugo-tools.json (amazonPaApi: { accessKey, secretKey, partnerTag })
 *   to use it as a final fallback.
 *
 * Usage:
 *   node scripts/book.mjs path/to/goodreads.csv
 *
 * Notes:
 * - This script uses global fetch (Node 18+).
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

// -------------------- Config --------------------

const PROJECT_ROOT = process.cwd();

let _userConfig = {};

try {
	const cfgPath = path.join(PROJECT_ROOT, '.hugo-tools.json');

	if (existsSync(cfgPath)) {
		_userConfig = JSON.parse(readFileSync(cfgPath, 'utf8'));
	}
} catch {} // eslint-disable-line no-empty

const OUTPUT_ROOT = path.join(PROJECT_ROOT, _userConfig.booksDir ?? 'content/books');

// Optional Amazon Product Advertising API credentials for ASIN lookup fallback.
// Set via .hugo-tools.json: { "amazonPaApi": { "accessKey", "secretKey", "partnerTag" } }
const AMAZON_PA_CONFIG = _userConfig.amazonPaApi ?? null;

// -------------------- Utilities --------------------

function usageAndExit() {
	console.error('Usage: node scripts/book.mjs path/to/goodreads.csv');
	process.exit(1);
}

function slugify(s) {
	return (
		(s || '')
			.trim()
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/[\s_-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'unknown'
	);
}

/**
 * Minimal CSV parser: commas, quotes, newlines inside quoted fields.
 * Good enough for Goodreads exports.
 */
function parseCSV(text) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];

		if (inQuotes) {
			if (c === '"' && next === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				inQuotes = false;
			} else {
				field += c;
			}
		} else {
			if (c === '"') inQuotes = true;
			else if (c === ',') {
				row.push(field);
				field = '';
			} else if (c === '\r') {
				// ignore
			} else if (c === '\n') {
				row.push(field);
				rows.push(row);
				row = [];
				field = '';
			} else {
				field += c;
			}
		}
	}

	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/**
 * Goodreads exports ISBN fields like:
 *   ="9781455586417" or =""
 * Normalize to digits/X only.
 */
function cleanIsbn(s) {
	const raw = String(s || '').trim();

	if (!raw) return '';

	// strip leading '=' and surrounding quotes
	const stripped = raw.replace(/^=+/, '').replace(/^"+|"+$/g, '');

	return stripped.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function toISODate(dateStr) {
	const s = (dateStr || '').trim();

	if (!s) return null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

	// YYYY/MM/DD (your export uses this)
	let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);

	if (m) {
		const year = Number(m[1]);
		const month = Number(m[2]);
		const day = Number(m[3]);

		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	// M/D/YYYY
	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

	if (m) {
		const month = Number(m[1]);
		const day = Number(m[2]);
		let year = Number(m[3]);

		if (year < 100) year += 2000;

		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	// last resort
	const d = new Date(s);

	if (!Number.isNaN(d.getTime())) {
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');

		return `${yyyy}-${mm}-${dd}`;
	}

	return null;
}

function clampRating(n) {
	if (!Number.isFinite(n)) return 0;

	if (n < 0) return 0;

	if (n > 5) return 5;

	return Math.trunc(n);
}

function escapeYAMLString(s) {
	return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function uniqSortedDates(dates) {
	const set = new Set((dates || []).map((d) => String(d).trim()).filter(Boolean));

	return Array.from(set).sort(); // YYYY-MM-DD sorts lexicographically
}

function keyFor(title, author) {
	return `${title.trim().toLowerCase()}|${author.trim().toLowerCase()}`;
}

function goodreadsBookUrl(bookId) {
	return bookId ? `https://www.goodreads.com/book/show/${bookId}` : '';
}

function openLibraryIsbnUrl(isbn) {
	return isbn ? `https://openlibrary.org/search?isbn=${encodeURIComponent(isbn)}` : '';
}

function amazonSearchLink({ isbn13, isbn10, title, author }) {
	// Search by ISBN13 (most specific) > ISBN10 > title+author — search pages never 404.
	const query = isbn13 || isbn10 || `${title} ${author}`;

	return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
}

// -------------------- ASIN lookup --------------------

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open Library sometimes exposes an "amazon" identifier on an edition, which
 * for Kindle editions is the ASIN.
 */
async function lookupAsinFromOpenLibrary(isbn, fetchImpl = fetch) {
	if (!isbn) return '';

	try {
		const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`;
		const res = await fetchImpl(url);

		if (!res.ok) return '';

		const data = await res.json();
		const amazon = data?.[`ISBN:${isbn}`]?.identifiers?.amazon;

		return Array.isArray(amazon) && amazon[0] ? String(amazon[0]).trim().toUpperCase() : '';
	} catch {
		return '';
	}
}

/**
 * Google Books occasionally lists a non-ISBN "OTHER" industry identifier that
 * matches the shape of an ASIN. Best-effort only — most volumes won't have one.
 */
async function lookupAsinFromGoogleBooks(isbn, fetchImpl = fetch) {
	if (!isbn) return '';

	try {
		const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
		const res = await fetchImpl(url);

		if (!res.ok) return '';

		const data = await res.json();
		const identifiers = data?.items?.[0]?.volumeInfo?.industryIdentifiers ?? [];

		for (const id of identifiers) {
			if (id?.type !== 'OTHER') continue;

			const bare = String(id.identifier || '').trim().toUpperCase().replace(/^[A-Z]+:/, '');

			if (/^[A-Z0-9]{10}$/.test(bare) && bare !== isbn.toUpperCase()) return bare;
		}

		return '';
	} catch {
		return '';
	}
}

function hmac(key, data) {
	return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
	return createHash('sha256').update(data, 'utf8').digest('hex');
}

function amazonPaApiSignature({ secretKey, region, service, dateStamp, stringToSign }) {
	const kDate = hmac(`AWS4${secretKey}`, dateStamp);
	const kRegion = hmac(kDate, region);
	const kService = hmac(kRegion, service);
	const kSigning = hmac(kService, 'aws4_request');

	return hmac(kSigning, stringToSign).toString('hex');
}

/**
 * Official Amazon Product Advertising API v5 GetItems call, signed with SigV4.
 * Only attempted when accessKey/secretKey/partnerTag are configured.
 */
async function lookupAsinFromAmazonPa(isbn, config, fetchImpl = fetch) {
	if (!isbn || !config?.accessKey || !config?.secretKey || !config?.partnerTag) return '';

	const host = config.host || 'webservices.amazon.com';
	const region = config.region || 'us-east-1';
	const marketplace = config.marketplace || 'www.amazon.com';
	const service = 'ProductAdvertisingAPI';
	const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
	const uri = '/paapi5/getitems';

	const payload = JSON.stringify({
		ItemIds: [isbn],
		ItemIdType: 'ISBN',
		Resources: ['ItemInfo.Title'],
		PartnerTag: config.partnerTag,
		PartnerType: 'Associates',
		Marketplace: marketplace,
	});

	const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
	const dateStamp = amzDate.slice(0, 8);
	const canonicalHeaders =
		`content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\nhost:${host}\n` +
		`x-amz-date:${amzDate}\nx-amz-target:${target}\n`;
	const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
	const canonicalRequest = `POST\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
	const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
	const stringToSign =
		`AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
	const signature = amazonPaApiSignature({ secretKey: config.secretKey, region, service, dateStamp, stringToSign });
	const authorization =
		`AWS4-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;

	try {
		const res = await fetchImpl(`https://${host}${uri}`, {
			method: 'POST',
			headers: {
				'content-encoding': 'amz-1.0',
				'content-type': 'application/json; charset=utf-8',
				host,
				'x-amz-date': amzDate,
				'x-amz-target': target,
				authorization,
			},
			body: payload,
		});

		if (!res.ok) return '';

		const data = await res.json();
		const asin = data?.ItemsResult?.Items?.[0]?.ASIN;

		return asin ? String(asin).trim().toUpperCase() : '';
	} catch {
		return '';
	}
}

/**
 * Look up an ASIN for an ISBN, trying free sources first (Open Library, then
 * Google Books) and falling back to the Amazon Product Advertising API only
 * when it's configured. Returns '' when no source has a match.
 */
async function lookupAsin(isbn, amazonPaConfig, cache, fetchImpl = fetch) {
	if (!isbn) return '';

	if (cache?.has(isbn)) return cache.get(isbn);

	let asin = await lookupAsinFromOpenLibrary(isbn, fetchImpl);

	if (!asin) {
		await sleep(150);
		asin = await lookupAsinFromGoogleBooks(isbn, fetchImpl);
	}

	if (!asin && amazonPaConfig) {
		await sleep(150);
		asin = await lookupAsinFromAmazonPa(isbn, amazonPaConfig, fetchImpl);
	}

	if (cache) cache.set(isbn, asin);

	return asin;
}

/**
 * Use "Author l-f" (e.g. "Baldacci, David") → folder "baldacci-david"
 */
function authorDirFromAuthorLF(authorLF) {
	const a = (authorLF || '').trim();

	if (!a) return 'unknown';

	if (a.includes(',')) {
		const [last, first] = a.split(',', 2).map((x) => (x || '').trim());
		const lastSlug = slugify(last);
		const firstSlug = slugify(first);

		if (lastSlug && firstSlug && firstSlug !== 'unknown') return `${lastSlug}-${firstSlug}`;

		return lastSlug || firstSlug || 'unknown';
	}

	return slugify(a);
}

/**
 * Extract existing finished dates from an existing Hugo markdown file.
 *
 * Supports:
 * - finished:
 *     - "YYYY-MM-DD"
 *     - "YYYY-MM-DD"
 * - finished: "YYYY-MM-DD"   (legacy scalar; included as one date)
 *
 * Also extracts the existing `rating:` value (or null if absent/unparseable).
 */
function parseExistingMarkdown(md) {
	const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

	if (!m) return { finished: [], rating: null };

	const fm = m[1];
	const lines = fm.split('\n');
	const finished = [];

	// list style
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === 'finished:') {
			for (let j = i + 1; j < lines.length; j++) {
				const line = lines[j];

				if (/^[A-Za-z0-9_-]+:/.test(line)) break; // new top-level key

				const mm = line.match(/^\s*-\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/);

				if (mm) finished.push(mm[1]);
			}
			break;
		}
	}

	// scalar legacy style
	for (const line of lines) {
		const mm = line.match(/^finished:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/);

		if (mm) {
			finished.push(mm[1]);
			break;
		}
	}

	let rating = null;

	for (const line of lines) {
		const mm = line.match(/^rating:\s*(\d+)\s*$/);

		if (mm) {
			rating = Number(mm[1]);
			break;
		}
	}

	return { finished: uniqSortedDates(finished), rating };
}

async function fileExists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

// -------------------- Patch finished block in existing file --------------------

/**
 * Replace only the `finished:` block in an existing markdown file.
 * Leaves all other front matter (title, author, rating, links, body) untouched.
 */
function replaceFinishedBlock(md, newFinished) {
	const block = ['finished:', ...newFinished.map((d) => `  - "${d}"`)];
	const lines = md.split('\n');

	// Find the "finished:" line
	const finishedIdx = lines.findIndex((l) => /^finished:\s*$/.test(l));

	if (finishedIdx !== -1) {
		// List form: "finished:\n  - ...\n  - ..."
		// Find where the list ends (first line that doesn't start with whitespace, after the key)
		let endIdx = finishedIdx + 1;

		while (endIdx < lines.length && /^\s/.test(lines[endIdx])) {
			endIdx++;
		}
		return [...lines.slice(0, finishedIdx), ...block, ...lines.slice(endIdx)].join('\n');
	}

	// Scalar form: 'finished: "YYYY-MM-DD"' or 'finished: YYYY-MM-DD'
	const scalarIdx = lines.findIndex((l) => /^finished:\s+"?\d{4}-\d{2}-\d{2}"?\s*$/.test(l));

	if (scalarIdx !== -1) {
		return [...lines.slice(0, scalarIdx), ...block, ...lines.slice(scalarIdx + 1)].join('\n');
	}

	console.warn('  WARNING: could not locate \'finished:\' block — file left unchanged');
	return md;
}

/**
 * Update the title field in front matter, leaving everything else untouched.
 */
function updateTitleInFrontMatter(md, newTitle) {
	return md.replace(/^title:.*$/m, `title: "${escapeYAMLString(newTitle)}"`);
}

/**
 * Update the rating field in front matter, leaving everything else untouched.
 */
function updateRatingInFrontMatter(md, newRating) {
	return md.replace(/^rating:.*$/m, `rating: ${newRating}`);
}

/**
 * Extract the existing `reference: { isbn, asin }` values from a file's front matter.
 * Returns { isbn: '', asin: '' } when the block (or either field) is absent.
 */
function parseExistingReference(md) {
	const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

	if (!m) return { isbn: '', asin: '' };

	const lines = m[1].split('\n');
	let isbn = '';
	let asin = '';

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== 'reference:') continue;

		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];

			if (/^[A-Za-z0-9_-]+:/.test(line)) break; // new top-level key

			const isbnMatch = line.match(/^\s*isbn:\s*"?([^"\n]*)"?\s*$/);

			if (isbnMatch) isbn = isbnMatch[1].trim();

			const asinMatch = line.match(/^\s*asin:\s*"?([^"\n]*)"?\s*$/);

			if (asinMatch) asin = asinMatch[1].trim();
		}
		break;
	}

	return { isbn, asin };
}

/**
 * Insert or replace the `reference:` block in front matter, leaving everything
 * else untouched. Inserts a new block just before the closing `---` when none exists.
 */
function upsertReferenceInFrontMatter(md, { isbn, asin }) {
	const block = [
		'reference:',
		`  isbn: "${escapeYAMLString(isbn)}"`,
		`  asin: "${escapeYAMLString(asin)}"`,
	];
	const lines = md.split('\n');
	const refIdx = lines.findIndex((l) => /^reference:\s*$/.test(l));

	if (refIdx !== -1) {
		let endIdx = refIdx + 1;

		while (endIdx < lines.length && /^\s/.test(lines[endIdx])) {
			endIdx++;
		}
		return [...lines.slice(0, refIdx), ...block, ...lines.slice(endIdx)].join('\n');
	}

	const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');

	if (closingIdx === -1) {
		console.warn('  WARNING: could not locate front matter to insert \'reference:\' block — file left unchanged');
		return md;
	}

	return [...lines.slice(0, closingIdx), ...block, ...lines.slice(closingIdx)].join('\n');
}

// -------------------- Existing-file index --------------------

/**
 * Extract the Goodreads book ID from a file's links.goodreads front-matter field.
 * Matches: goodreads: "https://www.goodreads.com/book/show/12345678"
 */
function extractGoodreadsId(md) {
	const m = md.match(/goodreads:\s*"https:\/\/www\.goodreads\.com\/book\/show\/(\d+)"/);

	return m ? m[1] : null;
}

/**
 * Extract ISBNs stored in a file's links front matter fields.
 * Checks the openlibrary URL (reliable) and the amazon URL (only when it looks like a bare ISBN).
 */
function extractFileIsbns(md) {
	const isbns = new Set();

	// openlibrary: "https://openlibrary.org/search?isbn=9780062694430"
	const ol = md.match(/openlibrary:\s*"https:\/\/openlibrary\.org\/search\?isbn=([0-9X]+)"/i);

	if (ol) isbns.add(ol[1].toUpperCase());

	// amazon: "https://www.amazon.com/s?k=9780062694430" — only when the query is a bare ISBN
	const am = md.match(/amazon:\s*"https:\/\/www\.amazon\.com\/s\?k=([0-9X]{10,13})"/i);

	if (am) isbns.add(am[1].toUpperCase());

	return Array.from(isbns);
}

/**
 * Scan all existing book files and build lookup maps by Goodreads Book ID and ISBN.
 * These are used to match incoming CSV rows even when the title (and thus slug) has changed.
 */
async function buildExistingIndex(outputRoot) {
	const byGoodreadsId = new Map(); // bookId → absolute filePath
	const byIsbn = new Map();        // isbn (normalized) → absolute filePath

	let dirEntries;

	try {
		dirEntries = await fs.readdir(outputRoot, { withFileTypes: true });
	} catch {
		return { byGoodreadsId, byIsbn };
	}

	for (const entry of dirEntries) {
		if (!entry.isDirectory()) continue;

		const dirPath = path.join(outputRoot, entry.name);

		let fileEntries;

		try {
			fileEntries = await fs.readdir(dirPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const fileEntry of fileEntries) {
			if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue;

			const filePath = path.join(dirPath, fileEntry.name);

			let content;

			try {
				content = await fs.readFile(filePath, 'utf8');
			} catch {
				continue;
			}

			const gid = extractGoodreadsId(content);

			if (gid && !byGoodreadsId.has(gid)) {
				byGoodreadsId.set(gid, filePath);
			}

			for (const isbn of extractFileIsbns(content)) {
				if (!byIsbn.has(isbn)) byIsbn.set(isbn, filePath);
			}
		}
	}

	return { byGoodreadsId, byIsbn };
}

/**
 * Find the existing file for a book, preferring Goodreads ID match, then ISBN, then slug.
 * Returns the absolute path if found, or null.
 */
async function findExistingFile(b, outPath, index) {
	if (b.bookId && index.byGoodreadsId.has(b.bookId)) {
		return index.byGoodreadsId.get(b.bookId);
	}

	if (b.isbn13 && index.byIsbn.has(b.isbn13)) {
		return index.byIsbn.get(b.isbn13);
	}

	if (b.isbn10 && index.byIsbn.has(b.isbn10)) {
		return index.byIsbn.get(b.isbn10);
	}

	if (await fileExists(outPath)) {
		return outPath;
	}

	return null;
}

/**
 * Remove a directory if it is empty (best-effort; ignores errors).
 */
async function removeIfEmpty(dirPath) {
	try {
		const entries = await fs.readdir(dirPath);

		if (entries.length === 0) await fs.rmdir(dirPath);
	} catch {
		// ignore
	}
}

// -------------------- Writing front matter --------------------

function toFrontMatter({ title, author, rating, finished, links, reference }) {
	const lines = [];

	lines.push('---');
	lines.push(`title: "${escapeYAMLString(title)}"`);
	lines.push(`author: "${escapeYAMLString(author)}"`);
	lines.push(`rating: ${rating}`);
	lines.push('finished:');
	for (const d of finished) lines.push(`  - "${escapeYAMLString(d)}"`);

	lines.push('links:');
	lines.push(`  amazon: "${escapeYAMLString(links.amazon)}"`);
	lines.push(`  openlibrary: "${escapeYAMLString(links.openlibrary)}"`);
	lines.push(`  goodreads: "${escapeYAMLString(links.goodreads)}"`);

	lines.push('reference:');
	lines.push(`  isbn: "${escapeYAMLString(reference?.isbn ?? '')}"`);
	lines.push(`  asin: "${escapeYAMLString(reference?.asin ?? '')}"`);

	lines.push('---');
	return lines.join('\n');
}

// -------------------- Main --------------------

const HUGO_CONFIGS = [
	'hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json',
	'config.toml', 'config.yaml', 'config.yml', 'config.json',
	'config',
];

async function main() {
	if (!HUGO_CONFIGS.some((name) => existsSync(path.join(PROJECT_ROOT, name)))) {
		process.stderr.write('Error: no Hugo config file found. Run this command from the root of your Hugo site.\n');
		process.exit(1);
	}

	const csvPath = process.argv[2];

	if (!csvPath) usageAndExit();

	const csvText = await fs.readFile(csvPath, 'utf8');
	const rows = parseCSV(csvText);

	if (rows.length < 2) {
		console.error('CSV appears empty or missing header row.');
		process.exit(1);
	}

	const header = rows[0].map((h) => (h ?? '').trim());
	const idx = (name) => header.indexOf(name);

	// Columns from your sample
	const iBookId = idx('Book Id');
	const iTitle = idx('Title');
	const iAuthor = idx('Author');
	const iAuthorLF = idx('Author l-f');
	const iIsbn = idx('ISBN');
	const iIsbn13 = idx('ISBN13');
	const iRating = idx('My Rating');
	const iDateRead = idx('Date Read');
	const iDateAdded = idx('Date Added');
	const iShelf = idx('Exclusive Shelf');
	const iReview = idx('My Review');
	const iReadCount = idx('Read Count');

	const required = [
		['Book Id', iBookId],
		['Title', iTitle],
		['Author', iAuthor],
		['Author l-f', iAuthorLF],
		['ISBN', iIsbn],
		['ISBN13', iIsbn13],
		['My Rating', iRating],
		['Date Read', iDateRead],
		['Date Added', iDateAdded],
		['Exclusive Shelf', iShelf],
		['My Review', iReview],
		['Read Count', iReadCount],
	];
	const missing = required.filter(([, i]) => i === -1).map(([n]) => n);

	if (missing.length) {
		console.error(`CSV is missing expected columns: ${missing.join(', ')}`);
		process.exit(1);
	}

	// Aggregate by Title+Author, collecting finished dates from CSV rows
	const books = new Map();

	let seenRows = 0;
	let importedRows = 0;

	for (let r = 1; r < rows.length; r++) {
		seenRows++;
		const row = rows[r];

		const bookId = String(row[iBookId] || '').trim();
		const title = String(row[iTitle] || '').trim();
		const author = String(row[iAuthor] || '').trim();
		const authorLF = String(row[iAuthorLF] || '').trim();

		if (!title || !author) continue;

		// Only import read shelf so Date Added fallback doesn't imply "finished" for to-read/currently-reading
		const shelf = String(row[iShelf] || '').trim().toLowerCase();

		if (shelf !== 'read') continue;

		importedRows++;

		const rating = clampRating(Number(String(row[iRating] || '').trim() || 0));
		const review = String(row[iReview] || '').trim();
		const readCount = Number(String(row[iReadCount] || '').trim() || 0);

		const isbn10 = cleanIsbn(row[iIsbn]);
		const isbn13 = cleanIsbn(row[iIsbn13]);

		const dateReadISO = toISODate(String(row[iDateRead] || ''));
		const dateAddedISO = toISODate(String(row[iDateAdded] || ''));
		const chosen = dateReadISO || dateAddedISO || null;

		const k = keyFor(title, author);

		if (!books.has(k)) {
			books.set(k, {
				bookId,
				title,
				author,
				authorLF,
				rating,
				isbn10,
				isbn13,
				readCount,
				finished: [],
				review: review || '',
			});
		}

		const b = books.get(k);

		// Keep "best" metadata across duplicate rows
		if (rating > b.rating) b.rating = rating;

		if (!b.review && review) b.review = review;

		if (!b.isbn13 && isbn13) b.isbn13 = isbn13;

		if (!b.isbn10 && isbn10) b.isbn10 = isbn10;

		if (!b.bookId && bookId) b.bookId = bookId;

		if (chosen) b.finished.push(chosen);

		if (Number.isFinite(readCount) && readCount > (b.readCount || 0)) b.readCount = readCount;
	}

	const bookList = Array.from(books.values());

	console.log(
		`Parsed rows: ${seenRows}, importing read-shelf rows: ${importedRows}, unique books: ${bookList.length}`,
	);

	// Build index of existing files for smart matching (by Goodreads ID and ISBN)
	console.log('Indexing existing book files...');
	const index = await buildExistingIndex(OUTPUT_ROOT);

	console.log(
		`  Indexed ${index.byGoodreadsId.size} Goodreads IDs, ${index.byIsbn.size} ISBNs`,
	);

	// ---- Write markdown ----
	// - New files: write everything from CSV data.
	// - Existing files matched by Goodreads ID or ISBN: if the title/slug changed, rename
	//   the file and update the title in front matter; always merge new finished dates.
	// - Existing files with no changes: skip.
	let written = 0;
	let createdNew = 0;
	let mergedExisting = 0;
	let renamedFiles = 0;
	let skippedUnchanged = 0;
	let ratingsUpdated = 0;
	let referencesUpdated = 0;

	const asinCache = new Map();

	for (const b of bookList) {
		const authorDir = authorDirFromAuthorLF(b.authorLF);
		const filename = `${slugify(b.title)}.md`;
		const outPath = path.join(OUTPUT_ROOT, authorDir, filename);
		const isbnBest = b.isbn13 || b.isbn10;

		const existingPath = await findExistingFile(b, outPath, index);

		if (existingPath) {
			const titleChanged = existingPath !== outPath;

			// Read the existing file
			const existingContent = await fs.readFile(existingPath, 'utf8');
			const { finished: existingFinished, rating: existingRating } = parseExistingMarkdown(existingContent);
			const finishedMerged = uniqSortedDates([...existingFinished, ...b.finished]);

			const hasNewDates =
				finishedMerged.length !== existingFinished.length ||
        finishedMerged.some((d, i) => d !== existingFinished[i]);

			// Only let Goodreads override the file's rating when Goodreads actually has one (> 0).
			// A rating of 0 usually means "not rated on Goodreads" — the file may carry a rating
			// entered by hand there instead, so leave it alone rather than clobbering it with 0.
			const hasRatingChange = b.rating > 0 && existingRating !== null && b.rating !== existingRating;

			// Never clobber an isbn/asin already present in the file — only fill blanks.
			const { isbn: existingIsbn, asin: existingAsin } = parseExistingReference(existingContent);
			const finalIsbn = existingIsbn || isbnBest || '';
			let finalAsin = existingAsin;

			if (!finalAsin && finalIsbn) {
				finalAsin = await lookupAsin(finalIsbn, AMAZON_PA_CONFIG, asinCache);
			}

			const hasReferenceChange = finalIsbn !== existingIsbn || finalAsin !== existingAsin;

			if (!titleChanged && !hasNewDates && !hasRatingChange && !hasReferenceChange) {
				skippedUnchanged++;
				continue;
			}

			// Apply patches
			let patched = existingContent;

			if (hasNewDates) {
				patched = replaceFinishedBlock(patched, finishedMerged);
			}

			if (hasRatingChange) {
				patched = updateRatingInFrontMatter(patched, b.rating);
				ratingsUpdated++;

				const rel = path.relative(OUTPUT_ROOT, existingPath);

				console.log(`  RATING UPDATED: ${rel} (${existingRating} -> ${b.rating})`);
			}

			if (hasReferenceChange) {
				patched = upsertReferenceInFrontMatter(patched, { isbn: finalIsbn, asin: finalAsin });
				referencesUpdated++;

				const rel = path.relative(OUTPUT_ROOT, existingPath);

				console.log(`  REFERENCE UPDATED: ${rel} (isbn: "${finalIsbn}", asin: "${finalAsin}")`);
			}

			if (titleChanged) {
				patched = updateTitleInFrontMatter(patched, b.title);
			}

			if (titleChanged) {
				// Write to new path, remove old path, clean up empty author dir
				await fs.mkdir(path.dirname(outPath), { recursive: true });
				await fs.writeFile(outPath, patched, 'utf8');
				await fs.unlink(existingPath);
				await removeIfEmpty(path.dirname(existingPath));

				const relOld = path.relative(OUTPUT_ROOT, existingPath);
				const relNew = path.relative(OUTPUT_ROOT, outPath);

				console.log(`  RENAMED: ${relOld}`);
				console.log(`       --> ${relNew}`);
				renamedFiles++;
			} else {
				await fs.writeFile(existingPath, patched, 'utf8');
			}

			written++;
			mergedExisting++;
		} else {
			// New file — write full content from CSV data
			createdNew++;

			const finishedMerged = uniqSortedDates(b.finished);

			const links = {
				amazon: amazonSearchLink({ isbn13: b.isbn13, isbn10: b.isbn10, title: b.title, author: b.author }),
				openlibrary: openLibraryIsbnUrl(isbnBest),
				goodreads: goodreadsBookUrl(b.bookId),
			};

			const reference = {
				isbn: isbnBest,
				asin: isbnBest ? await lookupAsin(isbnBest, AMAZON_PA_CONFIG, asinCache) : '',
			};

			const fm = toFrontMatter({
				title: b.title,
				author: b.author,
				rating: b.rating,
				finished: finishedMerged,
				links,
				reference,
			});

			const bodyToWrite = b.review ? `\n\n${b.review}\n` : '\n';

			await fs.mkdir(path.dirname(outPath), { recursive: true });
			await fs.writeFile(outPath, fm + bodyToWrite, 'utf8');
			written++;
		}
	}

	if (written > 0) {
		const libraryPath = path.join(PROJECT_ROOT, 'content', 'library.md');

		try {
			const libraryContent = await fs.readFile(libraryPath, 'utf8');
			const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
			const updated = libraryContent.replace(
				/^date:.*$/m,
				`date: ${now}`,
			);

			await fs.writeFile(libraryPath, updated, 'utf8');
			console.log(`  Updated library.md date to ${now}`);
		} catch (err) {
			console.warn(`  WARNING: could not update library.md: ${err.message}`);
		}
	}

	console.log(
		'Done.\n' +
      `  Books written:           ${written}\n` +
      `  New files created:       ${createdNew}\n` +
      `  Existing files updated:  ${mergedExisting}\n` +
      `  Files renamed:           ${renamedFiles}\n` +
      `  Ratings updated:         ${ratingsUpdated}\n` +
      `  References updated:      ${referencesUpdated}\n` +
      `  Existing files skipped:  ${skippedUnchanged}\n` +
      `  Content output:          ${OUTPUT_ROOT}\n`,
	);
}

// Only run main() when executed directly as a script (not imported by tests)
const isMain =
	path.resolve(new URL(import.meta.url).pathname) === path.resolve(process.argv[1] ?? '');

if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export {
	slugify,
	cleanIsbn,
	toISODate,
	clampRating,
	escapeYAMLString,
	uniqSortedDates,
	authorDirFromAuthorLF,
	keyFor,
	goodreadsBookUrl,
	openLibraryIsbnUrl,
	amazonSearchLink,
	parseCSV,
	parseExistingMarkdown,
	replaceFinishedBlock,
	updateTitleInFrontMatter,
	updateRatingInFrontMatter,
	parseExistingReference,
	upsertReferenceInFrontMatter,
	extractGoodreadsId,
	extractFileIsbns,
	toFrontMatter,
	buildExistingIndex,
	findExistingFile,
	lookupAsinFromOpenLibrary,
	lookupAsinFromGoogleBooks,
	lookupAsinFromAmazonPa,
	lookupAsin,
};
