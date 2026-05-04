'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  timezone: 'America/Chicago',
  postsDir: 'content/posts',
  draftsDir: 'content/drafts',
  notesDir: 'content/notes',
  booksDir: 'content/books',
  imagesDir: 'assets/images',
  vscodeDir: '.vscode',
};

let override = {};
const configPath = path.join(process.cwd(), '.hugo-tools.json');
try {
  if (fs.existsSync(configPath)) {
    override = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  process.stderr.write(`Warning: could not read .hugo-tools.json: ${e.message}\n`);
}

const HUGO_CONFIGS = [
  'hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json',
  'config.toml', 'config.yaml', 'config.yml', 'config.json',
  'config',
];

function requireHugoSite() {
  const cwd = process.cwd();
  const found = HUGO_CONFIGS.some(name => fs.existsSync(path.join(cwd, name)));
  if (!found) {
    process.stderr.write('Error: no Hugo config file found. Run this command from the root of your Hugo site.\n');
    process.exit(1);
  }
}

module.exports = { ...DEFAULTS, ...override, requireHugoSite, DEFAULTS };
