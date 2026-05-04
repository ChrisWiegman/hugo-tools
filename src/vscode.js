#!/usr/bin/env node
'use strict';

/**
 * Scaffolds VS Code config for a Hugo site using hugo-tools.
 * Usage:
 *   vscode
 *
 * Writes to <vscodeDir>/ (default .vscode/):
 *   tasks.json      — tasks for draft, extract-tags, add-tags, publish, pick-image
 *   extensions.json — recommended extensions
 *   settings.json   — markdown editor settings
 *
 * Existing files are left untouched.
 */

const fs = require('fs');
const path = require('path');
const { requireHugoSite, vscodeDir } = require('./config');
const { main: extractTags } = require('./extract-tags');

const TASKS = {
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Create Draft",
      "type": "shell",
      "command": "npx draft",
      "problemMatcher": []
    },
    {
      "label": "Add Tags",
      "type": "shell",
      "command": "npx add-tags",
      "problemMatcher": []
    },
    {
      "label": "Publish Draft (now)",
      "type": "shell",
      "command": "output=$(npx publish \"${relativeFile}\" now); echo \"$output\"; newFile=$(echo \"$output\" | grep -oE 'content/[^ ]+\\.md'); [ -n \"$newFile\" ] && code -r \"${workspaceFolder}/$newFile\"",
      "problemMatcher": []
    },
    {
      "label": "Publish Draft (later)",
      "type": "shell",
      "command": "read -p \"Publish date (YYYY-MM-DD): \" d; output=$(npx publish \"${relativeFile}\" later \"$d\"); echo \"$output\"; newFile=$(echo \"$output\" | grep -oE 'content/[^ ]+\\.md'); [ -n \"$newFile\" ] && code -r \"${workspaceFolder}/$newFile\"",
      "problemMatcher": []
    },
    {
      "label": "Pick Image",
      "type": "shell",
      "command": "npx pick-image",
      "problemMatcher": [],
      "presentation": {
        "focus": true
      }
    }
  ],
};

const EXTENSIONS = {
  recommendations: [
    'chriswiegman.cw-markdown-word-count',
    'streetsidesoftware.code-spell-checker',
  ],
};

const SETTINGS = {
  '[markdown]': {
    'editor.quickSuggestions': {
      comments: false,
      other: false,
      strings: true,
    },
    'editor.snippetSuggestions': 'top',
    'editor.suggest.showSnippets': true,
    'editor.wordBasedSuggestions': 'off',
  },
  'workbench.editor.closeOnFileDelete': true,
};

function writeIfAbsent(filePath, content) {
  const rel = path.relative(process.cwd(), filePath);
  if (fs.existsSync(filePath)) {
    console.log(`  skipped  ${rel} (already exists)`);
    return;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  created  ${rel}`);
}

function main() {
  requireHugoSite();

  const dir = path.join(process.cwd(), vscodeDir);
  fs.mkdirSync(dir, { recursive: true });

  writeIfAbsent(path.join(dir, 'tasks.json'), JSON.stringify(TASKS, null, 2) + '\n');
  writeIfAbsent(path.join(dir, 'extensions.json'), JSON.stringify(EXTENSIONS, null, 2) + '\n');
  writeIfAbsent(path.join(dir, 'settings.json'), JSON.stringify(SETTINGS, null, 2) + '\n');

  extractTags();
}

main();
