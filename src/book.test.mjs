import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
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
	parseExistingCover,
	upsertCoverInFrontMatter,
	extractGoodreadsId,
	extractFileIsbns,
	toFrontMatter,
	buildExistingIndex,
	findExistingFile,
	lookupAsinFromOpenLibrary,
	lookupAsinFromGoogleBooks,
	lookupAsinFromAmazonPa,
	lookupAsin,
	extFromContentType,
	coverUrlFromAssetPath,
	fetchOpenLibraryCover,
	fetchGoogleBooksCover,
	fetchBookCover,
	saveCover,
} from './book.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempDir(fn) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-test-'));

	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function sampleMarkdown({
	title = 'Test Book',
	author = 'John Doe',
	rating = 4,
	finished = ['2023-01-15'],
	goodreadsId = '12345',
	isbn13 = '9781234567890',
	reference = null,
} = {}) {
	const lines = [
		'---',
		`title: "${title}"`,
		`author: "${author}"`,
		`rating: ${rating}`,
		'finished:',
		...finished.map((d) => `  - "${d}"`),
		'links:',
		`  amazon: "https://www.amazon.com/s?k=${isbn13}"`,
		`  openlibrary: "https://openlibrary.org/search?isbn=${isbn13}"`,
		`  goodreads: "https://www.goodreads.com/book/show/${goodreadsId}"`,
	];

	if (reference) {
		lines.push('reference:', `  isbn: "${reference.isbn ?? ''}"`, `  asin: "${reference.asin ?? ''}"`);
	}

	lines.push('---', '');
	return lines.join('\n');
}

function fakeFetch(map) {
	return async (url) => {
		for (const [match, handler] of map) {
			const matches = typeof match === 'string' ? url.includes(match) : match.test(url);

			if (matches) return typeof handler === 'function' ? handler(url) : handler;
		}

		throw new Error(`fakeFetch: no handler for ${url}`);
	};
}

function jsonResponse(body, ok = true) {
	return { ok, json: async () => body };
}

function imageResponse(bytes, contentType = 'image/jpeg', ok = true) {
	const buf = Buffer.from(bytes);

	return {
		ok,
		headers: { get: () => contentType },
		arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	};
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: basic lowercase and hyphenation', () => {
	assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: collapses multiple spaces and hyphens', () => {
	assert.equal(slugify('Hello   World--Test'), 'hello-world-test');
});

test('slugify: removes special characters', () => {
	assert.equal(slugify('It\'s a Test!'), 'its-a-test');
});

test('slugify: strips em-dashes and mdash-like punctuation', () => {
	assert.equal(slugify('Title\u2014Subtitle'), 'titlesubtitle');
});

test('slugify: normalizes unicode accents', () => {
	assert.equal(slugify('Café Résumé'), 'cafe-resume');
});

test('slugify: returns \'unknown\' for empty string', () => {
	assert.equal(slugify(''), 'unknown');
});

test('slugify: returns \'unknown\' for null', () => {
	assert.equal(slugify(null), 'unknown');
});

test('slugify: trims leading and trailing hyphens', () => {
	assert.equal(slugify('  ---hello---  '), 'hello');
});

// ---------------------------------------------------------------------------
// cleanIsbn
// ---------------------------------------------------------------------------

test('cleanIsbn: Goodreads ISBN13 format ="..."', () => {
	assert.equal(cleanIsbn('="9781234567890"'), '9781234567890');
});

test('cleanIsbn: Goodreads ISBN10 format ="..."', () => {
	assert.equal(cleanIsbn('="1234567890"'), '1234567890');
});

test('cleanIsbn: empty Goodreads field =""', () => {
	assert.equal(cleanIsbn('=""'), '');
});

test('cleanIsbn: plain ISBN string passed through', () => {
	assert.equal(cleanIsbn('9780062694430'), '9780062694430');
});

test('cleanIsbn: normalizes to uppercase (X check digit)', () => {
	assert.equal(cleanIsbn('019x'), '019X');
});

test('cleanIsbn: null returns empty string', () => {
	assert.equal(cleanIsbn(null), '');
});

test('cleanIsbn: undefined returns empty string', () => {
	assert.equal(cleanIsbn(undefined), '');
});

// ---------------------------------------------------------------------------
// toISODate
// ---------------------------------------------------------------------------

test('toISODate: already ISO YYYY-MM-DD passthrough', () => {
	assert.equal(toISODate('2023-09-10'), '2023-09-10');
});

test('toISODate: YYYY/MM/DD format', () => {
	assert.equal(toISODate('2023/9/10'), '2023-09-10');
});

test('toISODate: YYYY/M/D zero-pads month and day', () => {
	assert.equal(toISODate('2024/1/5'), '2024-01-05');
});

test('toISODate: M/D/YYYY format', () => {
	assert.equal(toISODate('3/20/2024'), '2024-03-20');
});

test('toISODate: M/D/YY treats 2-digit year as 20xx', () => {
	assert.equal(toISODate('1/5/23'), '2023-01-05');
});

test('toISODate: empty string returns null', () => {
	assert.equal(toISODate(''), null);
});

test('toISODate: null returns null', () => {
	assert.equal(toISODate(null), null);
});

test('toISODate: invalid string returns null', () => {
	assert.equal(toISODate('not-a-date'), null);
});

test('toISODate: invalid month 13 in YYYY/MM/DD returns null', () => {
	assert.equal(toISODate('2023/13/01'), null);
});

// ---------------------------------------------------------------------------
// clampRating
// ---------------------------------------------------------------------------

test('clampRating: 0 stays 0', () => assert.equal(clampRating(0), 0));
test('clampRating: 3 stays 3', () => assert.equal(clampRating(3), 3));
test('clampRating: 5 stays 5', () => assert.equal(clampRating(5), 5));
test('clampRating: -1 clamps to 0', () => assert.equal(clampRating(-1), 0));
test('clampRating: 6 clamps to 5', () => assert.equal(clampRating(6), 5));
test('clampRating: NaN returns 0', () => assert.equal(clampRating(NaN), 0));
test('clampRating: 3.9 truncates to 3', () => assert.equal(clampRating(3.9), 3));
test('clampRating: Infinity is non-finite, returns 0', () => assert.equal(clampRating(Infinity), 0));

// ---------------------------------------------------------------------------
// escapeYAMLString
// ---------------------------------------------------------------------------

test('escapeYAMLString: escapes double quotes', () => {
	assert.equal(escapeYAMLString('say "hello"'), 'say \\"hello\\"');
});

test('escapeYAMLString: escapes backslashes', () => {
	assert.equal(escapeYAMLString('a\\b'), 'a\\\\b');
});

test('escapeYAMLString: empty string', () => {
	assert.equal(escapeYAMLString(''), '');
});

test('escapeYAMLString: null becomes empty string', () => {
	assert.equal(escapeYAMLString(null), '');
});

test('escapeYAMLString: plain string unchanged', () => {
	assert.equal(escapeYAMLString('Hello World'), 'Hello World');
});

// ---------------------------------------------------------------------------
// uniqSortedDates
// ---------------------------------------------------------------------------

test('uniqSortedDates: deduplicates identical dates', () => {
	assert.deepEqual(
		uniqSortedDates(['2023-01-15', '2023-01-15', '2024-03-20']),
		['2023-01-15', '2024-03-20'],
	);
});

test('uniqSortedDates: sorts chronologically', () => {
	assert.deepEqual(
		uniqSortedDates(['2024-03-20', '2023-01-15']),
		['2023-01-15', '2024-03-20'],
	);
});

test('uniqSortedDates: filters empty/blank entries', () => {
	assert.deepEqual(uniqSortedDates(['2023-01-15', '', '  ']), ['2023-01-15']);
});

test('uniqSortedDates: empty array returns empty array', () => {
	assert.deepEqual(uniqSortedDates([]), []);
});

test('uniqSortedDates: null returns empty array', () => {
	assert.deepEqual(uniqSortedDates(null), []);
});

// ---------------------------------------------------------------------------
// authorDirFromAuthorLF
// ---------------------------------------------------------------------------

test('authorDirFromAuthorLF: \'Last, First\' becomes \'last-first\'', () => {
	assert.equal(authorDirFromAuthorLF('Baldacci, David'), 'baldacci-david');
});

test('authorDirFromAuthorLF: single name without comma', () => {
	assert.equal(authorDirFromAuthorLF('Homer'), 'homer');
});

test('authorDirFromAuthorLF: empty returns \'unknown\'', () => {
	assert.equal(authorDirFromAuthorLF(''), 'unknown');
});

test('authorDirFromAuthorLF: null returns \'unknown\'', () => {
	assert.equal(authorDirFromAuthorLF(null), 'unknown');
});

test('authorDirFromAuthorLF: handles special chars in name', () => {
	assert.equal(authorDirFromAuthorLF('O\'Brien, Tim'), 'obrien-tim');
});

test('authorDirFromAuthorLF: handles suffix-only after comma', () => {
	assert.equal(authorDirFromAuthorLF('King, Jr.'), 'king-jr');
});

// ---------------------------------------------------------------------------
// keyFor
// ---------------------------------------------------------------------------

test('keyFor: combines lowercased title and author with pipe', () => {
	assert.equal(keyFor('Test Book', 'John Doe'), 'test book|john doe');
});

test('keyFor: trims whitespace before combining', () => {
	assert.equal(keyFor('  Test Book  ', '  John Doe  '), 'test book|john doe');
});

// ---------------------------------------------------------------------------
// goodreadsBookUrl / openLibraryIsbnUrl / amazonSearchLink
// ---------------------------------------------------------------------------

test('goodreadsBookUrl: returns correct URL for a book ID', () => {
	assert.equal(
		goodreadsBookUrl('12345'),
		'https://www.goodreads.com/book/show/12345',
	);
});

test('goodreadsBookUrl: empty ID returns empty string', () => {
	assert.equal(goodreadsBookUrl(''), '');
	assert.equal(goodreadsBookUrl(null), '');
});

test('openLibraryIsbnUrl: returns correct search URL', () => {
	assert.equal(
		openLibraryIsbnUrl('9781234567890'),
		'https://openlibrary.org/search?isbn=9781234567890',
	);
});

test('openLibraryIsbnUrl: empty ISBN returns empty string', () => {
	assert.equal(openLibraryIsbnUrl(''), '');
});

test('amazonSearchLink: prefers ISBN13', () => {
	const url = amazonSearchLink({
		isbn13: '9781234567890',
		isbn10: '1234567890',
		title: 'Test',
		author: 'Doe',
	});

	assert.ok(url.includes('9781234567890'), `expected ISBN13 in URL, got: ${url}`);
});

test('amazonSearchLink: falls back to ISBN10 when no ISBN13', () => {
	const url = amazonSearchLink({
		isbn13: '',
		isbn10: '1234567890',
		title: 'Test',
		author: 'Doe',
	});

	assert.ok(url.includes('1234567890'), `expected ISBN10 in URL, got: ${url}`);
});

test('amazonSearchLink: falls back to title+author when no ISBNs', () => {
	const url = amazonSearchLink({ isbn13: '', isbn10: '', title: 'My Book', author: 'Jane' });

	// encodeURIComponent uses %20, not +
	assert.ok(url.includes('My%20Book'), `expected title in URL, got: ${url}`);
});

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

test('parseCSV: parses simple two-row CSV', () => {
	const csv = 'col1,col2,col3\nval1,val2,val3\n';
	const rows = parseCSV(csv);

	assert.deepEqual(rows[0], ['col1', 'col2', 'col3']);
	assert.deepEqual(rows[1], ['val1', 'val2', 'val3']);
});

test('parseCSV: handles quoted fields containing commas', () => {
	const csv = 'a,"b,c",d\n';
	const rows = parseCSV(csv);

	assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
});

test('parseCSV: handles escaped double quotes inside quoted fields', () => {
	const csv = 'a,"say ""hello""",b\n';
	const rows = parseCSV(csv);

	assert.deepEqual(rows[0], ['a', 'say "hello"', 'b']);
});

test('parseCSV: handles Goodreads ISBN format ="..."', () => {
	// The CSV parser sees ="9781234567890": the = is a literal char, then "..." is a quoted segment.
	// Result: =9781234567890 (quotes stripped by parser). cleanIsbn then strips the leading =.
	const csv = 'Title,ISBN\n"Test Book",="9781234567890"\n';
	const rows = parseCSV(csv);

	assert.equal(rows[1][1], '=9781234567890');
	assert.equal(cleanIsbn(rows[1][1]), '9781234567890');
});

test('parseCSV: handles CRLF line endings', () => {
	const csv = 'a,b\r\nc,d\r\n';
	const rows = parseCSV(csv);

	assert.deepEqual(rows[0], ['a', 'b']);
	assert.deepEqual(rows[1], ['c', 'd']);
});

test('parseCSV: no trailing newline still parses last row', () => {
	const csv = 'a,b\nc,d';
	const rows = parseCSV(csv);

	assert.equal(rows.length, 2);
	assert.deepEqual(rows[1], ['c', 'd']);
});

// ---------------------------------------------------------------------------
// parseExistingMarkdown
// ---------------------------------------------------------------------------

test('parseExistingMarkdown: parses list-style finished block', () => {
	const md = sampleMarkdown({ finished: ['2023-01-15', '2024-07-22'] });
	const { finished } = parseExistingMarkdown(md);

	assert.deepEqual(finished, ['2023-01-15', '2024-07-22']);
});

test('parseExistingMarkdown: parses scalar-style finished field', () => {
	const md = [
		'---',
		'title: "Test Book"',
		'rating: 4',
		'finished: "2023-01-15"',
		'---',
		'',
	].join('\n');
	const { finished } = parseExistingMarkdown(md);

	assert.deepEqual(finished, ['2023-01-15']);
});

test('parseExistingMarkdown: deduplicates dates from list', () => {
	const md = sampleMarkdown({ finished: ['2023-01-15', '2023-01-15'] });
	const { finished } = parseExistingMarkdown(md);

	assert.deepEqual(finished, ['2023-01-15']);
});

test('parseExistingMarkdown: returns empty array when no finished field', () => {
	const md = ['---', 'title: "Test"', 'rating: 3', '---', ''].join('\n');
	const { finished } = parseExistingMarkdown(md);

	assert.deepEqual(finished, []);
});

test('parseExistingMarkdown: returns empty array for invalid front matter', () => {
	const { finished } = parseExistingMarkdown('no front matter here');

	assert.deepEqual(finished, []);
});

test('parseExistingMarkdown: extracts rating', () => {
	const md = sampleMarkdown({ rating: 5 });
	const { rating } = parseExistingMarkdown(md);

	assert.equal(rating, 5);
});

test('parseExistingMarkdown: returns null rating when field is absent', () => {
	const md = ['---', 'title: "Test"', 'finished:', '  - "2023-01-15"', '---', ''].join('\n');
	const { rating } = parseExistingMarkdown(md);

	assert.equal(rating, null);
});

test('parseExistingMarkdown: returns null rating for invalid front matter', () => {
	const { rating } = parseExistingMarkdown('no front matter here');

	assert.equal(rating, null);
});

// ---------------------------------------------------------------------------
// replaceFinishedBlock
// ---------------------------------------------------------------------------

test('replaceFinishedBlock: replaces list-style block with new dates', () => {
	const md = sampleMarkdown({ finished: ['2023-01-15'] });
	const result = replaceFinishedBlock(md, ['2023-01-15', '2024-07-22']);

	assert.ok(result.includes('  - "2023-01-15"'));
	assert.ok(result.includes('  - "2024-07-22"'));
});

test('replaceFinishedBlock: replaces scalar-style finished with list', () => {
	const md = [
		'---',
		'title: "Test Book"',
		'rating: 4',
		'finished: "2023-01-15"',
		'links:',
		'  amazon: "https://www.amazon.com/s?k=test"',
		'---',
		'',
	].join('\n');
	const result = replaceFinishedBlock(md, ['2023-01-15', '2024-07-22']);

	assert.ok(result.includes('finished:'));
	assert.ok(result.includes('  - "2023-01-15"'));
	assert.ok(result.includes('  - "2024-07-22"'));
	assert.ok(!result.includes('finished: "2023-01-15"'));
});

test('replaceFinishedBlock: preserves other front matter fields', () => {
	const md = sampleMarkdown({ finished: ['2023-01-15'] });
	const result = replaceFinishedBlock(md, ['2023-01-15', '2024-07-22']);

	assert.ok(result.includes('title: "Test Book"'));
	assert.ok(result.includes('rating: 4'));
	assert.ok(result.includes('openlibrary:'));
});

test('replaceFinishedBlock: single new date produces single list item', () => {
	const md = sampleMarkdown({ finished: ['2023-01-15', '2024-07-22'] });
	const result = replaceFinishedBlock(md, ['2023-01-15']);

	assert.ok(result.includes('  - "2023-01-15"'));
	assert.ok(!result.includes('2024-07-22'));
});

// ---------------------------------------------------------------------------
// updateTitleInFrontMatter
// ---------------------------------------------------------------------------

test('updateTitleInFrontMatter: replaces title line', () => {
	const md = sampleMarkdown({ title: 'Old Title' });
	const result = updateTitleInFrontMatter(md, 'New Title');

	assert.ok(result.includes('title: "New Title"'));
	assert.ok(!result.includes('title: "Old Title"'));
});

test('updateTitleInFrontMatter: escapes special chars in new title', () => {
	const md = sampleMarkdown({ title: 'Old Title' });
	const result = updateTitleInFrontMatter(md, 'Title with "quotes"');

	assert.ok(result.includes('title: "Title with \\"quotes\\""'));
});

test('updateTitleInFrontMatter: preserves all other front matter', () => {
	const md = sampleMarkdown({ title: 'Old', rating: 3 });
	const result = updateTitleInFrontMatter(md, 'New');

	assert.ok(result.includes('rating: 3'));
	assert.ok(result.includes('goodreads:'));
});

// ---------------------------------------------------------------------------
// updateRatingInFrontMatter
// ---------------------------------------------------------------------------

test('updateRatingInFrontMatter: replaces rating line', () => {
	const md = sampleMarkdown({ rating: 3 });
	const result = updateRatingInFrontMatter(md, 5);

	assert.ok(result.includes('rating: 5'));
	assert.ok(!result.includes('rating: 3'));
});

test('updateRatingInFrontMatter: preserves all other front matter', () => {
	const md = sampleMarkdown({ title: 'Keep Me', rating: 2 });
	const result = updateRatingInFrontMatter(md, 4);

	assert.ok(result.includes('title: "Keep Me"'));
	assert.ok(result.includes('goodreads:'));
});

// ---------------------------------------------------------------------------
// parseExistingReference
// ---------------------------------------------------------------------------

test('parseExistingReference: extracts isbn and asin from reference block', () => {
	const md = sampleMarkdown({ reference: { isbn: '9781234567890', asin: 'B00ABCDEFG' } });
	const result = parseExistingReference(md);

	assert.deepEqual(result, { isbn: '9781234567890', asin: 'B00ABCDEFG' });
});

test('parseExistingReference: returns blanks when reference block is absent', () => {
	const md = sampleMarkdown();
	const result = parseExistingReference(md);

	assert.deepEqual(result, { isbn: '', asin: '' });
});

test('parseExistingReference: returns blanks for fields present but empty', () => {
	const md = sampleMarkdown({ reference: { isbn: '', asin: '' } });
	const result = parseExistingReference(md);

	assert.deepEqual(result, { isbn: '', asin: '' });
});

test('parseExistingReference: returns blanks for invalid front matter', () => {
	assert.deepEqual(parseExistingReference('no front matter here'), { isbn: '', asin: '' });
});

// ---------------------------------------------------------------------------
// upsertReferenceInFrontMatter
// ---------------------------------------------------------------------------

test('upsertReferenceInFrontMatter: inserts a new block when none exists', () => {
	const md = sampleMarkdown();
	const result = upsertReferenceInFrontMatter(md, { isbn: '9781234567890', asin: 'B00ABCDEFG' });

	assert.ok(result.includes('reference:'));
	assert.ok(result.includes('  isbn: "9781234567890"'));
	assert.ok(result.includes('  asin: "B00ABCDEFG"'));
	assert.ok(result.includes('title: "Test Book"'));
});

test('upsertReferenceInFrontMatter: replaces an existing block', () => {
	const md = sampleMarkdown({ reference: { isbn: '9781234567890', asin: '' } });
	const result = upsertReferenceInFrontMatter(md, { isbn: '9781234567890', asin: 'B00ABCDEFG' });

	assert.equal((result.match(/reference:/g) || []).length, 1);
	assert.ok(result.includes('  asin: "B00ABCDEFG"'));
});

test('upsertReferenceInFrontMatter: preserves all other front matter', () => {
	const md = sampleMarkdown({ title: 'Keep Me', rating: 5 });
	const result = upsertReferenceInFrontMatter(md, { isbn: '123', asin: '456' });

	assert.ok(result.includes('title: "Keep Me"'));
	assert.ok(result.includes('rating: 5'));
	assert.ok(result.includes('goodreads:'));
});

// ---------------------------------------------------------------------------
// ASIN lookup
// ---------------------------------------------------------------------------

test('lookupAsinFromOpenLibrary: extracts amazon identifier', async () => {
	const fetchImpl = fakeFetch([
		['openlibrary.org', jsonResponse({
			'ISBN:9781234567890': { identifiers: { amazon: ['b00abcdefg'] } },
		})],
	]);

	assert.equal(await lookupAsinFromOpenLibrary('9781234567890', fetchImpl), 'B00ABCDEFG');
});

test('lookupAsinFromOpenLibrary: returns empty string when no amazon identifier', async () => {
	const fetchImpl = fakeFetch([
		['openlibrary.org', jsonResponse({ 'ISBN:9781234567890': { identifiers: {} } })],
	]);

	assert.equal(await lookupAsinFromOpenLibrary('9781234567890', fetchImpl), '');
});

test('lookupAsinFromOpenLibrary: returns empty string on non-OK response', async () => {
	const fetchImpl = fakeFetch([['openlibrary.org', jsonResponse({}, false)]]);

	assert.equal(await lookupAsinFromOpenLibrary('9781234567890', fetchImpl), '');
});

test('lookupAsinFromOpenLibrary: returns empty string when fetch throws', async () => {
	const fetchImpl = async () => {
		throw new Error('network down');
	};

	assert.equal(await lookupAsinFromOpenLibrary('9781234567890', fetchImpl), '');
});

test('lookupAsinFromOpenLibrary: empty isbn returns empty string without fetching', async () => {
	assert.equal(await lookupAsinFromOpenLibrary('', async () => {
		throw new Error('should not be called');
	}), '');
});

test('lookupAsinFromGoogleBooks: extracts ASIN-shaped OTHER identifier', async () => {
	const fetchImpl = fakeFetch([
		['googleapis.com', jsonResponse({
			items: [{ volumeInfo: { industryIdentifiers: [
				{ type: 'ISBN_13', identifier: '9781234567890' },
				{ type: 'OTHER', identifier: 'B00ABCDEFG' },
			] } }],
		})],
	]);

	assert.equal(await lookupAsinFromGoogleBooks('9781234567890', fetchImpl), 'B00ABCDEFG');
});

test('lookupAsinFromGoogleBooks: returns empty string when no OTHER identifier matches', async () => {
	const fetchImpl = fakeFetch([
		['googleapis.com', jsonResponse({
			items: [{ volumeInfo: { industryIdentifiers: [{ type: 'ISBN_10', identifier: '1234567890' }] } }],
		})],
	]);

	assert.equal(await lookupAsinFromGoogleBooks('9781234567890', fetchImpl), '');
});

test('lookupAsinFromAmazonPa: returns empty string without config', async () => {
	const fetchImpl = async () => {
		throw new Error('should not be called');
	};

	assert.equal(await lookupAsinFromAmazonPa('9781234567890', null, fetchImpl), '');
});

test('lookupAsinFromAmazonPa: signs the request and returns the ASIN', async () => {
	let seenAuth = '';
	const fetchImpl = async (url, opts) => {
		seenAuth = opts.headers.authorization;
		return jsonResponse({ ItemsResult: { Items: [{ ASIN: 'b00abcdefg' }] } });
	};
	const config = { accessKey: 'AKIA...', secretKey: 'secret', partnerTag: 'tag-20' };

	const result = await lookupAsinFromAmazonPa('9781234567890', config, fetchImpl);

	assert.equal(result, 'B00ABCDEFG');
	assert.ok(seenAuth.startsWith('AWS4-HMAC-SHA256 Credential=AKIA...'));
});

test('lookupAsin: falls back from Open Library to Google Books', async () => {
	const fetchImpl = fakeFetch([
		['openlibrary.org', jsonResponse({ 'ISBN:9781234567890': { identifiers: {} } })],
		['googleapis.com', jsonResponse({
			items: [{ volumeInfo: { industryIdentifiers: [{ type: 'OTHER', identifier: 'B00ABCDEFG' }] } }],
		})],
	]);

	assert.equal(await lookupAsin('9781234567890', null, new Map(), fetchImpl), 'B00ABCDEFG');
});

test('lookupAsin: caches results per ISBN', async () => {
	let calls = 0;
	const fetchImpl = async () => {
		calls++;
		return jsonResponse({ 'ISBN:9781234567890': { identifiers: { amazon: ['B00ABCDEFG'] } } });
	};
	const cache = new Map();

	await lookupAsin('9781234567890', null, cache, fetchImpl);
	await lookupAsin('9781234567890', null, cache, fetchImpl);

	assert.equal(calls, 1);
});

test('lookupAsin: empty isbn returns empty string without fetching', async () => {
	const fetchImpl = async () => {
		throw new Error('should not be called');
	};

	assert.equal(await lookupAsin('', null, new Map(), fetchImpl), '');
});

// ---------------------------------------------------------------------------
// Cover art (opt-in)
// ---------------------------------------------------------------------------

test('extFromContentType: maps known image types to extensions', () => {
	assert.equal(extFromContentType('image/jpeg'), '.jpg');
	assert.equal(extFromContentType('image/png'), '.png');
	assert.equal(extFromContentType('image/webp'), '.webp');
	assert.equal(extFromContentType('image/gif'), '.gif');
});

test('extFromContentType: strips charset/parameter suffix', () => {
	assert.equal(extFromContentType('image/jpeg; charset=binary'), '.jpg');
});

test('extFromContentType: defaults to .jpg for unknown or missing types', () => {
	assert.equal(extFromContentType('application/octet-stream'), '.jpg');
	assert.equal(extFromContentType(''), '.jpg');
	assert.equal(extFromContentType(undefined), '.jpg');
});

test('coverUrlFromAssetPath: strips the assets/ prefix and normalizes separators', () => {
	assert.equal(
		coverUrlFromAssetPath(path.join('assets', 'images', 'books', 'king-stephen', 'it.jpg')),
		'/images/books/king-stephen/it.jpg',
	);
});

test('fetchOpenLibraryCover: returns buffer and content type on success', async () => {
	const fetchImpl = fakeFetch([
		['covers.openlibrary.org', imageResponse([1, 2, 3], 'image/jpeg')],
	]);

	const result = await fetchOpenLibraryCover('9781234567890', fetchImpl);

	assert.ok(result);
	assert.equal(result.contentType, 'image/jpeg');
	assert.deepEqual([...result.buffer], [1, 2, 3]);
});

test('fetchOpenLibraryCover: returns null on non-OK response (no cover)', async () => {
	const fetchImpl = fakeFetch([
		['covers.openlibrary.org', imageResponse([], 'image/jpeg', false)],
	]);

	assert.equal(await fetchOpenLibraryCover('9781234567890', fetchImpl), null);
});

test('fetchOpenLibraryCover: returns null when fetch throws', async () => {
	const fetchImpl = async () => {
		throw new Error('network down');
	};

	assert.equal(await fetchOpenLibraryCover('9781234567890', fetchImpl), null);
});

test('fetchOpenLibraryCover: empty isbn returns null without fetching', async () => {
	assert.equal(await fetchOpenLibraryCover('', async () => {
		throw new Error('should not be called');
	}), null);
});

test('fetchGoogleBooksCover: fetches the volume thumbnail and returns image bytes', async () => {
	const fetchImpl = fakeFetch([
		['googleapis.com', jsonResponse({
			items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://books.google.com/thumb.jpg' } } }],
		})],
		['books.google.com', imageResponse([4, 5, 6], 'image/png')],
	]);

	const result = await fetchGoogleBooksCover('9781234567890', fetchImpl);

	assert.ok(result);
	assert.equal(result.contentType, 'image/png');
	assert.deepEqual([...result.buffer], [4, 5, 6]);
});

test('fetchGoogleBooksCover: returns null when volume has no imageLinks', async () => {
	const fetchImpl = fakeFetch([
		['googleapis.com', jsonResponse({ items: [{ volumeInfo: {} }] })],
	]);

	assert.equal(await fetchGoogleBooksCover('9781234567890', fetchImpl), null);
});

test('fetchGoogleBooksCover: empty isbn returns null without fetching', async () => {
	assert.equal(await fetchGoogleBooksCover('', async () => {
		throw new Error('should not be called');
	}), null);
});

test('fetchBookCover: prefers Open Library over Google Books', async () => {
	const fetchImpl = fakeFetch([
		['covers.openlibrary.org', imageResponse([1], 'image/jpeg')],
		['googleapis.com', () => {
			throw new Error('should not be called');
		}],
	]);

	const result = await fetchBookCover('9781234567890', fetchImpl);

	assert.ok(result);
	assert.deepEqual([...result.buffer], [1]);
});

test('fetchBookCover: falls back to Google Books when Open Library has no cover', async () => {
	const fetchImpl = fakeFetch([
		['covers.openlibrary.org', imageResponse([], 'image/jpeg', false)],
		['googleapis.com', jsonResponse({
			items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://books.google.com/thumb.jpg' } } }],
		})],
		['books.google.com', imageResponse([9], 'image/jpeg')],
	]);

	const result = await fetchBookCover('9781234567890', fetchImpl);

	assert.ok(result);
	assert.deepEqual([...result.buffer], [9]);
});

test('fetchBookCover: returns null when neither source has a cover', async () => {
	const fetchImpl = fakeFetch([
		['covers.openlibrary.org', imageResponse([], 'image/jpeg', false)],
		['googleapis.com', jsonResponse({ items: [] })],
	]);

	assert.equal(await fetchBookCover('9781234567890', fetchImpl), null);
});

test('fetchBookCover: empty isbn returns null without fetching', async () => {
	assert.equal(await fetchBookCover('', async () => {
		throw new Error('should not be called');
	}), null);
});

test('saveCover: writes image bytes under coversDir and returns the Hugo URL path', async () => {
	await withTempDir(async (tmpDir) => {
		const cover = { buffer: Buffer.from([1, 2, 3]), contentType: 'image/png' };
		const url = await saveCover('assets/images/books', 'king-stephen', 'it', cover, tmpDir);

		assert.equal(url, '/images/books/king-stephen/it.png');

		const written = await fs.readFile(path.join(tmpDir, 'assets', 'images', 'books', 'king-stephen', 'it.png'));

		assert.deepEqual([...written], [1, 2, 3]);
	});
});

test('saveCover: creates intermediate directories as needed', async () => {
	await withTempDir(async (tmpDir) => {
		const cover = { buffer: Buffer.from([7]), contentType: 'image/jpeg' };

		await saveCover('assets/images/books', 'doe-jane', 'a-title', cover, tmpDir);

		const exists = await fs.access(path.join(tmpDir, 'assets', 'images', 'books', 'doe-jane', 'a-title.jpg'))
			.then(() => true)
			.catch(() => false);

		assert.ok(exists);
	});
});

// ---------------------------------------------------------------------------
// parseExistingCover / upsertCoverInFrontMatter
// ---------------------------------------------------------------------------

test('parseExistingCover: extracts the cover value when present', () => {
	const md = ['---', 'title: "Test"', 'cover: "/images/books/king-stephen/it.jpg"', '---', ''].join('\n');

	assert.equal(parseExistingCover(md), '/images/books/king-stephen/it.jpg');
});

test('parseExistingCover: returns empty string when the field is absent', () => {
	assert.equal(parseExistingCover(sampleMarkdown()), '');
});

test('parseExistingCover: returns empty string for invalid front matter', () => {
	assert.equal(parseExistingCover('no front matter here'), '');
});

test('upsertCoverInFrontMatter: inserts the field when absent', () => {
	const md = sampleMarkdown();
	const result = upsertCoverInFrontMatter(md, '/images/books/king-stephen/it.jpg');

	assert.ok(result.includes('cover: "/images/books/king-stephen/it.jpg"'));
	assert.ok(result.includes('title: "Test Book"'));
});

test('upsertCoverInFrontMatter: replaces an existing cover field without duplicating it', () => {
	const md = ['---', 'title: "Test"', 'cover: "/old.jpg"', '---', ''].join('\n');
	const result = upsertCoverInFrontMatter(md, '/new.jpg');

	assert.equal((result.match(/^cover:/gm) || []).length, 1);
	assert.ok(result.includes('cover: "/new.jpg"'));
	assert.ok(!result.includes('/old.jpg'));
});

test('upsertCoverInFrontMatter: preserves all other front matter', () => {
	const md = sampleMarkdown({ title: 'Keep Me', rating: 5 });
	const result = upsertCoverInFrontMatter(md, '/cover.jpg');

	assert.ok(result.includes('title: "Keep Me"'));
	assert.ok(result.includes('rating: 5'));
	assert.ok(result.includes('goodreads:'));
});

// ---------------------------------------------------------------------------
// extractGoodreadsId
// ---------------------------------------------------------------------------

test('extractGoodreadsId: extracts numeric ID from goodreads URL', () => {
	const md = sampleMarkdown({ goodreadsId: '61150728' });

	assert.equal(extractGoodreadsId(md), '61150728');
});

test('extractGoodreadsId: returns null when not present', () => {
	const md = ['---', 'title: "Test"', '---', ''].join('\n');

	assert.equal(extractGoodreadsId(md), null);
});

// ---------------------------------------------------------------------------
// extractFileIsbns
// ---------------------------------------------------------------------------

test('extractFileIsbns: extracts ISBN from openlibrary URL', () => {
	const md = sampleMarkdown({ isbn13: '9781234567890' });
	const isbns = extractFileIsbns(md);

	assert.ok(isbns.includes('9781234567890'), `expected ISBN in result: ${isbns}`);
});

test('extractFileIsbns: extracts bare ISBN from amazon search URL', () => {
	const md = sampleMarkdown({ isbn13: '9781234567890' });
	const isbns = extractFileIsbns(md);

	assert.ok(isbns.includes('9781234567890'));
});

test('extractFileIsbns: returns empty array when no ISBNs in URLs', () => {
	const md = [
		'---',
		'title: "Test"',
		'links:',
		'  amazon: "https://www.amazon.com/s?k=Some+Book+Title"',
		'  openlibrary: ""',
		'---',
		'',
	].join('\n');
	const isbns = extractFileIsbns(md);

	assert.deepEqual(isbns, []);
});

// ---------------------------------------------------------------------------
// toFrontMatter
// ---------------------------------------------------------------------------

test('toFrontMatter: produces correct YAML structure', () => {
	const fm = toFrontMatter({
		title: 'Test Book',
		author: 'John Doe',
		rating: 4,
		finished: ['2023-01-15'],
		links: {
			amazon: 'https://www.amazon.com/s?k=9781234567890',
			openlibrary: 'https://openlibrary.org/search?isbn=9781234567890',
			goodreads: 'https://www.goodreads.com/book/show/12345',
		},
	});

	assert.ok(fm.startsWith('---\n'));
	assert.ok(fm.endsWith('\n---'));
	assert.ok(fm.includes('title: "Test Book"'));
	assert.ok(fm.includes('author: "John Doe"'));
	assert.ok(fm.includes('rating: 4'));
	assert.ok(fm.includes('finished:'));
	assert.ok(fm.includes('  - "2023-01-15"'));
	assert.ok(fm.includes('links:'));
	assert.ok(fm.includes('amazon:'));
	assert.ok(fm.includes('openlibrary:'));
	assert.ok(fm.includes('goodreads:'));
});

test('toFrontMatter: escapes special chars in title and author', () => {
	const fm = toFrontMatter({
		title: 'Book "One"',
		author: 'Author "A"',
		rating: 0,
		finished: [],
		links: { amazon: '', openlibrary: '', goodreads: '' },
	});

	assert.ok(fm.includes('title: "Book \\"One\\""'));
	assert.ok(fm.includes('author: "Author \\"A\\""'));
});

test('toFrontMatter: includes reference isbn/asin when provided', () => {
	const fm = toFrontMatter({
		title: 'Test Book',
		author: 'John Doe',
		rating: 4,
		finished: [],
		links: { amazon: '', openlibrary: '', goodreads: '' },
		reference: { isbn: '9781234567890', asin: 'B00ABCDEFG' },
	});

	assert.ok(fm.includes('reference:'));
	assert.ok(fm.includes('  isbn: "9781234567890"'));
	assert.ok(fm.includes('  asin: "B00ABCDEFG"'));
});

test('toFrontMatter: reference fields default to blank when omitted', () => {
	const fm = toFrontMatter({
		title: 'Test Book',
		author: 'John Doe',
		rating: 4,
		finished: [],
		links: { amazon: '', openlibrary: '', goodreads: '' },
	});

	assert.ok(fm.includes('  isbn: ""'));
	assert.ok(fm.includes('  asin: ""'));
});

test('toFrontMatter: includes cover field when provided', () => {
	const fm = toFrontMatter({
		title: 'Test Book',
		author: 'John Doe',
		rating: 4,
		finished: [],
		links: { amazon: '', openlibrary: '', goodreads: '' },
		cover: '/images/books/doe-john/test-book.jpg',
	});

	assert.ok(fm.includes('cover: "/images/books/doe-john/test-book.jpg"'));
});

test('toFrontMatter: cover defaults to blank when omitted', () => {
	const fm = toFrontMatter({
		title: 'Test Book',
		author: 'John Doe',
		rating: 4,
		finished: [],
		links: { amazon: '', openlibrary: '', goodreads: '' },
	});

	assert.ok(fm.includes('cover: ""'));
});

// ---------------------------------------------------------------------------
// buildExistingIndex (async)
// ---------------------------------------------------------------------------

test('buildExistingIndex: indexes files by Goodreads ID and ISBN', async () => {
	await withTempDir(async (tmpDir) => {
		const authorDir = path.join(tmpDir, 'doe-john');

		await fs.mkdir(authorDir);
		const mdPath = path.join(authorDir, 'test-book.md');

		await fs.writeFile(mdPath, sampleMarkdown({ goodreadsId: '12345', isbn13: '9781234567890' }));

		const index = await buildExistingIndex(tmpDir);

		assert.equal(index.byGoodreadsId.get('12345'), mdPath);
		assert.equal(index.byIsbn.get('9781234567890'), mdPath);
	});
});

test('buildExistingIndex: returns empty index for missing directory', async () => {
	const index = await buildExistingIndex('/nonexistent/path/xyz');

	assert.equal(index.byGoodreadsId.size, 0);
	assert.equal(index.byIsbn.size, 0);
});

test('buildExistingIndex: indexes multiple books across author dirs', async () => {
	await withTempDir(async (tmpDir) => {
		const dir1 = path.join(tmpDir, 'doe-john');
		const dir2 = path.join(tmpDir, 'smith-jane');

		await fs.mkdir(dir1);
		await fs.mkdir(dir2);

		await fs.writeFile(
			path.join(dir1, 'book-a.md'),
			sampleMarkdown({ goodreadsId: '111', isbn13: '9780000000001' }),
		);
		await fs.writeFile(
			path.join(dir2, 'book-b.md'),
			sampleMarkdown({ goodreadsId: '222', isbn13: '9780000000002' }),
		);

		const index = await buildExistingIndex(tmpDir);

		assert.equal(index.byGoodreadsId.size, 2);
		assert.equal(index.byIsbn.size, 2);
		assert.ok(index.byGoodreadsId.has('111'));
		assert.ok(index.byGoodreadsId.has('222'));
	});
});

test('buildExistingIndex: ignores non-.md files', async () => {
	await withTempDir(async (tmpDir) => {
		const dir = path.join(tmpDir, 'doe-john');

		await fs.mkdir(dir);
		await fs.writeFile(path.join(dir, 'notes.txt'), 'not a book');
		await fs.writeFile(
			path.join(dir, 'book.md'),
			sampleMarkdown({ goodreadsId: '999' }),
		);

		const index = await buildExistingIndex(tmpDir);

		assert.equal(index.byGoodreadsId.size, 1);
	});
});

// ---------------------------------------------------------------------------
// findExistingFile (async)
// ---------------------------------------------------------------------------

test('findExistingFile: finds by Goodreads ID in index', async () => {
	await withTempDir(async (tmpDir) => {
		const filePath = path.join(tmpDir, 'some-dir', 'old-title.md');
		const index = {
			byGoodreadsId: new Map([['99999', filePath]]),
			byIsbn: new Map(),
		};
		const b = { bookId: '99999', isbn13: '', isbn10: '' };
		const outPath = path.join(tmpDir, 'some-dir', 'new-title.md');

		const result = await findExistingFile(b, outPath, index);

		assert.equal(result, filePath);
	});
});

test('findExistingFile: finds by ISBN13 when no Goodreads ID match', async () => {
	await withTempDir(async (tmpDir) => {
		const filePath = path.join(tmpDir, 'author', 'old-title.md');
		const index = {
			byGoodreadsId: new Map(),
			byIsbn: new Map([['9781234567890', filePath]]),
		};
		const b = { bookId: 'unknown', isbn13: '9781234567890', isbn10: '' };
		const outPath = path.join(tmpDir, 'author', 'new-title.md');

		const result = await findExistingFile(b, outPath, index);

		assert.equal(result, filePath);
	});
});

test('findExistingFile: finds by ISBN10 when no ISBN13 match', async () => {
	await withTempDir(async (tmpDir) => {
		const filePath = path.join(tmpDir, 'author', 'old-title.md');
		const index = {
			byGoodreadsId: new Map(),
			byIsbn: new Map([['1234567890', filePath]]),
		};
		const b = { bookId: '', isbn13: '', isbn10: '1234567890' };
		const outPath = path.join(tmpDir, 'author', 'new-title.md');

		const result = await findExistingFile(b, outPath, index);

		assert.equal(result, filePath);
	});
});

test('findExistingFile: falls back to outPath when file exists there', async () => {
	await withTempDir(async (tmpDir) => {
		const outPath = path.join(tmpDir, 'test.md');

		await fs.writeFile(outPath, 'content');
		const index = { byGoodreadsId: new Map(), byIsbn: new Map() };
		const b = { bookId: '', isbn13: '', isbn10: '' };

		const result = await findExistingFile(b, outPath, index);

		assert.equal(result, outPath);
	});
});

test('findExistingFile: returns null when no match found anywhere', async () => {
	await withTempDir(async (tmpDir) => {
		const outPath = path.join(tmpDir, 'nonexistent.md');
		const index = { byGoodreadsId: new Map(), byIsbn: new Map() };
		const b = { bookId: 'xyz', isbn13: '0000000000000', isbn10: '0000000000' };

		const result = await findExistingFile(b, outPath, index);

		assert.equal(result, null);
	});
});

// ---------------------------------------------------------------------------
// Integration: CSV parsing pipeline
// ---------------------------------------------------------------------------

const SAMPLE_CSV = [
	'Book Id,Title,Author,Author l-f,ISBN,ISBN13,My Rating,Date Read,Date Added,Exclusive Shelf,My Review,Read Count',
	'12345,"Test Book","John Doe","Doe, John",="1234567890",="9781234567890",4,2023/1/15,2023/1/1,read,"Great read",1',
	'67890,"Another Book","Jane Smith","Smith, Jane",="",="9780987654321",3,2024/3/20,2024/3/1,read,"",1',
	'11111,"Unread Book","Bob Brown","Brown, Bob",="",="",0,,2024/1/1,to-read,"",0',
	'99999,"Second Read","John Doe","Doe, John",="",="9781111111111",5,2023/6/1,2023/5/1,read,"",2',
	'12345,"Test Book","John Doe","Doe, John",="1234567890",="9781234567890",4,2024/2/10,2023/1/1,read,"Great read",2',
].join('\n');

test('integration: CSV parses read-shelf books and skips to-read', () => {
	const rows = parseCSV(SAMPLE_CSV);
	const header = rows[0];
	const shelfIdx = header.indexOf('Exclusive Shelf');
	const readRows = rows.slice(1).filter((r) => r[shelfIdx] === 'read');

	assert.equal(readRows.length, 4); // 11111 (to-read) skipped
});

test('integration: ISBN cleanup pipeline from Goodreads format', () => {
	const rows = parseCSV(SAMPLE_CSV);
	const header = rows[0];
	const isbnIdx = header.indexOf('ISBN');
	const isbn13Idx = header.indexOf('ISBN13');

	const firstBook = rows[1];

	assert.equal(cleanIsbn(firstBook[isbnIdx]), '1234567890');
	assert.equal(cleanIsbn(firstBook[isbn13Idx]), '9781234567890');

	const secondBook = rows[2];

	assert.equal(cleanIsbn(secondBook[isbnIdx]), '');
	assert.equal(cleanIsbn(secondBook[isbn13Idx]), '9780987654321');
});

test('integration: date parsing from YYYY/MM/DD CSV format', () => {
	const rows = parseCSV(SAMPLE_CSV);
	const header = rows[0];
	const dateReadIdx = header.indexOf('Date Read');

	assert.equal(toISODate(rows[1][dateReadIdx]), '2023-01-15');
	assert.equal(toISODate(rows[2][dateReadIdx]), '2024-03-20');
});

test('integration: author directory derived from Author l-f', () => {
	const rows = parseCSV(SAMPLE_CSV);
	const header = rows[0];
	const authorLFIdx = header.indexOf('Author l-f');

	assert.equal(authorDirFromAuthorLF(rows[1][authorLFIdx]), 'doe-john');
	assert.equal(authorDirFromAuthorLF(rows[2][authorLFIdx]), 'smith-jane');
});

test('integration: full round-trip — write and re-read a book file', async () => {
	await withTempDir(async (tmpDir) => {
		const authorDir = path.join(tmpDir, 'doe-john');

		await fs.mkdir(authorDir);

		const fm = toFrontMatter({
			title: 'Test Book',
			author: 'John Doe',
			rating: 4,
			finished: ['2023-01-15'],
			links: {
				amazon: 'https://www.amazon.com/s?k=9781234567890',
				openlibrary: 'https://openlibrary.org/search?isbn=9781234567890',
				goodreads: 'https://www.goodreads.com/book/show/12345',
			},
		});
		const filePath = path.join(authorDir, 'test-book.md');

		await fs.writeFile(filePath, fm + '\n');

		// Simulate a re-import: merge a new finished date
		const content = await fs.readFile(filePath, 'utf8');
		const { finished } = parseExistingMarkdown(content);

		assert.deepEqual(finished, ['2023-01-15']);

		const merged = uniqSortedDates([...finished, '2024-02-10']);
		const patched = replaceFinishedBlock(content, merged);

		await fs.writeFile(filePath, patched, 'utf8');

		const updated = await fs.readFile(filePath, 'utf8');
		const { finished: updatedDates } = parseExistingMarkdown(updated);

		assert.deepEqual(updatedDates, ['2023-01-15', '2024-02-10']);
	});
});

test('integration: title-change rename via buildExistingIndex', async () => {
	await withTempDir(async (tmpDir) => {
		// Write a file under the old title slug
		const authorDir = path.join(tmpDir, 'doe-john');

		await fs.mkdir(authorDir);
		const oldPath = path.join(authorDir, 'old-title.md');

		await fs.writeFile(
			oldPath,
			sampleMarkdown({ title: 'Old Title', goodreadsId: '12345', isbn13: '9781234567890' }),
		);

		// Build index — should find the file by Goodreads ID
		const index = await buildExistingIndex(tmpDir);

		assert.equal(index.byGoodreadsId.get('12345'), oldPath);

		// Simulate incoming CSV entry with new title
		const b = { bookId: '12345', isbn13: '9781234567890', isbn10: '' };
		const newPath = path.join(authorDir, 'new-title.md');
		const found = await findExistingFile(b, newPath, index);

		// Should find the old path, revealing a title change is needed
		assert.equal(found, oldPath);
		assert.notEqual(found, newPath);

		// Apply the rename
		const existingContent = await fs.readFile(oldPath, 'utf8');
		const patched = updateTitleInFrontMatter(existingContent, 'New Title');

		await fs.writeFile(newPath, patched, 'utf8');
		await fs.unlink(oldPath);

		// Verify
		assert.ok(!(await fs.access(oldPath).then(() => true).catch(() => false)));
		const newContent = await fs.readFile(newPath, 'utf8');

		assert.ok(newContent.includes('title: "New Title"'));
	});
});
