#!/usr/bin/env node

/**
 * Interactive script to help add categories and tags to Hugo draft frontmatter.
 * Reads from the extracted tags-categories.json file.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');

const DATA_FILE = path.join(process.cwd(), config.vscodeDir, 'tags-categories.json');

/**
 * Display menu and get user selection
 */
async function getSelection(prompt, options) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log(`\n${prompt}`);
    options.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt}`);
    });
    console.log(`  0. Done/Skip`);

    rl.question('\nEnter number: ', (answer) => {
      rl.close();
      const num = parseInt(answer, 10);
      if (num === 0) {
        resolve(null);
      } else if (num > 0 && num <= options.length) {
        resolve(options[num - 1]);
      } else {
        console.log('Invalid selection');
        resolve(null);
      }
    });
  });
}

/**
 * Get multiple selections
 */
async function getMultipleSelections(prompt, options) {
  const selections = [];
  let done = false;

  while (!done) {
    const remaining = options.filter(opt => !selections.includes(opt));
    if (remaining.length === 0) {
      break;
    }

    const selection = await getSelection(
      selections.length === 0 ? prompt : `${prompt} (Selected: ${selections.join(', ')})`,
      remaining
    );

    if (selection === null) {
      done = true;
    } else {
      selections.push(selection);
    }
  }

  return selections;
}

/**
 * Format frontmatter list
 */
function formatList(items) {
  if (items.length === 0) {
    return '  -';
  }
  return items.map(item => `  - ${item}`).join('\n');
}

/**
 * Main execution
 */
async function main() {
  config.requireHugoSite();

  console.log('=== Hugo Draft Tags & Categories Helper ===\n');

  // Check if data file exists
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`Error: Data file not found at ${DATA_FILE}`);
    console.error('Run "extract-tags" first to generate the data file.');
    process.exit(1);
  }

  // Load data
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  console.log(`Loaded ${data.categories.length} categories and ${data.tags.length} tags`);
  console.log(`(Generated from ${data.stats.totalFiles} posts on ${new Date(data.stats.generatedAt).toLocaleDateString()})\n`);

  // Get category selection
  const category = await getSelection(
    'Select a category:',
    data.categories
  );

  // Get tag selections
  const tags = await getMultipleSelections(
    'Select tags (you can select multiple):',
    data.tags
  );

  // Generate output
  console.log('\n=== Generated Frontmatter ===\n');

  if (category) {
    console.log('categories:');
    console.log(`  - ${category}`);
  } else {
    console.log('categories:');
    console.log('  -');
  }

  console.log('tags:');
  console.log(formatList(tags));

  console.log('\n=== Copy the above into your draft frontmatter ===\n');
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nCancelled.');
  process.exit(0);
});

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
