#!/usr/bin/env node
'use strict';

// Moves an image into assets/images/<year>/<month>/ and inserts a reference
// into a Hugo content file — appending to the frontmatter images: array when
// present, or appending a markdown image tag to the body otherwise.

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const config = require('./config');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function urlFromImagesDir(imagesDir, year, month, filename) {
  const urlBase = imagesDir.replace(/^assets\//, '');
  return `/${urlBase}/${year}/${month}/${filename}`;
}

function appendMarkdown(content, urlPath) {
  return `${content.trimEnd()}\n\n![](${urlPath})\n`;
}

function insertImage(content, urlPath) {
  const fmEnd = content.indexOf('\n---', 4);
  if (!content.startsWith('---\n') || fmEnd === -1) {
    return appendMarkdown(content, urlPath);
  }
  const frontmatter = content.slice(4, fmEnd);
  if (!/^images:/m.test(frontmatter)) {
    return appendMarkdown(content, urlPath);
  }
  return content.replace(
    /^(images:)((?:\n {2}-[^\n]*)*)/m,
    (_, key, block) => {
      const existing = block.split('\n').filter(line => /^ {2}- \S/.test(line));
      return [key, ...existing, `  - ${urlPath}`].join('\n');
    }
  );
}

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
    copyToClipboard(urlPath);
    console.log(`Path copied to clipboard: ${urlPath}`);
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

module.exports = { urlFromImagesDir, appendMarkdown, insertImage };
