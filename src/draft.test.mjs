import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildArchetype, timestampFilename } = require('./draft.js');

// ---------------------------------------------------------------------------
// buildArchetype
// ---------------------------------------------------------------------------

test('buildArchetype: starts with front matter delimiter', () => {
  assert.ok(buildArchetype().startsWith('---\n'));
});

test('buildArchetype: contains blank title', () => {
  assert.ok(buildArchetype().includes('title: ""'));
});

test('buildArchetype: contains blank description', () => {
  assert.ok(buildArchetype().includes('description: ""'));
});

test('buildArchetype: sets draft true', () => {
  assert.ok(buildArchetype().includes('draft: true'));
});

test('buildArchetype: contains images placeholder', () => {
  const out = buildArchetype();
  assert.ok(out.includes('images:\n  -'));
});

test('buildArchetype: contains categories placeholder', () => {
  const out = buildArchetype();
  assert.ok(out.includes('categories:\n  -'));
});

test('buildArchetype: contains tags placeholder', () => {
  const out = buildArchetype();
  assert.ok(out.includes('tags:\n  -'));
});

test('buildArchetype: does not contain a date key', () => {
  assert.ok(!buildArchetype().includes('date:'));
});

test('buildArchetype: ends with closing delimiter and trailing newline', () => {
  assert.ok(buildArchetype().endsWith('---\n'));
});

// ---------------------------------------------------------------------------
// timestampFilename
// ---------------------------------------------------------------------------

test('timestampFilename: matches YYYYMMDD-HHMMSS format', () => {
  assert.match(timestampFilename(), /^\d{8}-\d{6}$/);
});

test('timestampFilename: date portion is a plausible date', () => {
  const stamp = timestampFilename();
  const year = parseInt(stamp.slice(0, 4), 10);
  const month = parseInt(stamp.slice(4, 6), 10);
  const day = parseInt(stamp.slice(6, 8), 10);
  assert.ok(year >= 2024);
  assert.ok(month >= 1 && month <= 12);
  assert.ok(day >= 1 && day <= 31);
});

test('timestampFilename: time portion is a plausible time', () => {
  const stamp = timestampFilename();
  const hour = parseInt(stamp.slice(9, 11), 10);
  const minute = parseInt(stamp.slice(11, 13), 10);
  const second = parseInt(stamp.slice(13, 15), 10);
  assert.ok(hour >= 0 && hour <= 23);
  assert.ok(minute >= 0 && minute <= 59);
  assert.ok(second >= 0 && second <= 59);
});
