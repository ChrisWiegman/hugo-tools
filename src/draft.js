#!/usr/bin/env node
'use strict';

/**
 * Creates a new Hugo draft using the standard drafts archetype.
 * Usage:
 *   new-draft
 *
 * Generates a timestamp-based filename (YYYYMMDD-HHMMSS.md) in the configured
 * drafts directory, writes the archetype front matter without a date: line,
 * then opens the file in VS Code.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');

function timestampFilename() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type).value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}${get('second')}`;
}

function buildArchetype() {
  return [
    '---',
    'title: ""',
    'description: ""',
    'draft: true',
    'images:',
    '  -',
    'categories:',
    '  -',
    'tags:',
    '  -',
    '---',
    '',
  ].join('\n');
}

function main() {
  config.requireHugoSite();

  const stamp = timestampFilename();
  const draftsDir = path.join(process.cwd(), config.draftsDir);
  const destPath = path.join(draftsDir, `${stamp}.md`);

  fs.mkdirSync(draftsDir, { recursive: true });
  fs.writeFileSync(destPath, buildArchetype(), 'utf8');

  console.log(destPath);

  try {
    execFileSync('code', [destPath], { stdio: 'ignore' });
  } catch {
    // VS Code not available — silently continue
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildArchetype, timestampFilename };
