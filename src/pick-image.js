#!/usr/bin/env node
'use strict';

// Lists images in the configured images directory for the current year/month
// and copies the selected path to the clipboard.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');
const config = require('./config');

config.requireHugoSite();

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const now = new Date();
const year = now.getFullYear().toString();
const month = String(now.getMonth() + 1).padStart(2, '0');
const imageDir = path.join(process.cwd(), config.imagesDir, year, month);
const imagePath = `/${config.imagesDir}/${year}/${month}`;

if (!fs.existsSync(imageDir)) {
  console.error(`No image directory found at ${imageDir}`);
  process.exit(1);
}

const files = fs.readdirSync(imageDir)
  .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
  .sort();

if (files.length === 0) {
  console.error(`No images found in ${imageDir}`);
  process.exit(1);
}

console.log(`\nImages in ${imagePath}/:\n`);
files.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
console.log('');

function copyToClipboard(text) {
  const platform = process.platform;
  if (platform === 'darwin') {
    execSync(`echo ${JSON.stringify(text)} | pbcopy`);
    return;
  }
  if (platform === 'win32') {
    execFileSync('clip', { input: text });
    return;
  }
  // Linux: try common clipboard tools in order
  const tools = [
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
    ['wl-copy', []],
  ];
  for (const [cmd, args] of tools) {
    try {
      execFileSync(cmd, args, { input: text });
      return;
    } catch {
      // try next
    }
  }
  console.log('(clipboard unavailable — copy the path above manually)');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`Select image (1-${files.length}): `, answer => {
  rl.close();
  const choice = parseInt(answer, 10);
  if (choice >= 1 && choice <= files.length) {
    const result = `${imagePath}/${files[choice - 1]}`;
    copyToClipboard(result);
    console.log(`\nCopied to clipboard: ${result}`);
  } else {
    console.error('Invalid selection');
    process.exit(1);
  }
});
