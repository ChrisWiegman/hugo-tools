#!/usr/bin/env node

/**
 * Extracts all unique categories and tags from published Hugo posts.
 * Outputs a JSON file that can be used for autocomplete/reference.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const CONTENT_DIR = path.join(process.cwd(), config.postsDir);
const OUTPUT_FILE = path.join(process.cwd(), config.vscodeDir, 'tags-categories.json');
const SNIPPETS_FILE = path.join(process.cwd(), config.vscodeDir, 'markdown.code-snippets');

/**
 * Extracts frontmatter from a markdown file
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Parses YAML-style list items from frontmatter
 */
function parseListItems(frontmatter, key) {
  const items = [];
  const blockRegex = new RegExp(`^${key}:\\s*\\n((\\s*-\\s*.+\\n)+)`, 'm');
  const match = frontmatter.match(blockRegex);

  if (match) {
    const lines = match[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/^\s*-\s*(.+)\s*$/);
      if (itemMatch) {
        const value = itemMatch[1].trim().replace(/^["']|["']$/g, '');
        if (value) {
          items.push(value);
        }
      }
    }
  }

  return items;
}

/**
 * Recursively finds all markdown files
 */
function findMarkdownFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main extraction logic
 */
function extractTagsAndCategories() {
  const categories = new Set();
  const tags = new Set();
  const categoryCount = {};
  const tagCount = {};

  const files = findMarkdownFiles(CONTENT_DIR);
  console.log(`Found ${files.length} markdown files`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) continue;

    // Extract categories
    const fileCategories = parseListItems(frontmatter, 'categories');
    for (const cat of fileCategories) {
      categories.add(cat);
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }

    // Extract tags
    const fileTags = parseListItems(frontmatter, 'tags');
    for (const tag of fileTags) {
      tags.add(tag);
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }

  // Sort by usage count (most used first)
  const sortedCategories = Array.from(categories).sort((a, b) => {
    return (categoryCount[b] || 0) - (categoryCount[a] || 0);
  });

  const sortedTags = Array.from(tags).sort((a, b) => {
    return (tagCount[b] || 0) - (tagCount[a] || 0);
  });

  return {
    categories: sortedCategories,
    tags: sortedTags,
    stats: {
      categoryCount,
      tagCount,
      totalCategories: categories.size,
      totalTags: tags.size,
      totalFiles: files.length,
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Generate snippet prefixes for a tag/category
 */
function generatePrefixes(name) {
  const lower = name.toLowerCase();
  const prefixes = [lower];

  // Add concatenated version for multi-word items (e.g., "Digital Life" -> "digitallife")
  if (name.includes(' ')) {
    const concat = lower.replace(/\s+/g, '');
    if (concat !== lower) {
      prefixes.push(concat);
    }
  }

  // Add common abbreviations
  const abbrevMap = {
    'Technology': ['tech'],
    'Personal': ['pers'],
    'WordPress': ['wp'],
    'Infrastructure': ['infra'],
    'Open Source': ['oss'],
    'Reflection': ['reflect'],
    'Web Development': ['webdev', 'web'],
    'Development': ['dev'],
    'Digital Life': ['digital'],
    'Social Media': ['social'],
    'Education': ['edu'],
    'Self-hosting': ['selfhost'],
    'Content Management Systems': ['cms', 'contentmanagement']
  };

  if (abbrevMap[name]) {
    prefixes.push(...abbrevMap[name]);
  }

  // Return single string if only one prefix, otherwise return array
  return prefixes.length === 1 ? prefixes[0] : prefixes;
}

/**
 * Generate VSCode snippets from tags and categories
 */
function generateSnippets(data) {
  const snippets = {};

  // Generate category snippets
  for (const category of data.categories) {
    snippets[`Category: ${category}`] = {
      prefix: generatePrefixes(category),
      body: category,
      description: `Category: ${category}`
    };
  }

  // Generate tag snippets
  for (const tag of data.tags) {
    snippets[`Tag: ${tag}`] = {
      prefix: generatePrefixes(tag),
      body: tag,
      description: `Tag: ${tag}`
    };
  }

  return snippets;
}

/**
 * Main execution
 */
function main() {
  config.requireHugoSite();

  console.log('Extracting tags and categories from published posts...');

  const data = extractTagsAndCategories();

  // Ensure .vscode directory exists
  const vscodePath = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(vscodePath)) {
    fs.mkdirSync(vscodePath, { recursive: true });
  }

  // Write JSON data file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));

  // Generate and write snippets file
  const snippets = generateSnippets(data);
  fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2));

  console.log('\nResults:');
  console.log(`  Categories: ${data.stats.totalCategories}`);
  console.log(`  Tags: ${data.stats.totalTags}`);
  console.log(`  Files processed: ${data.stats.totalFiles}`);
  console.log(`\nOutput written to:`);
  console.log(`  - ${OUTPUT_FILE}`);
  console.log(`  - ${SNIPPETS_FILE}`);
  console.log('\nMost used categories:');
  data.categories.slice(0, 5).forEach(cat => {
    console.log(`  - ${cat} (${data.stats.categoryCount[cat]} posts)`);
  });
  console.log('\nMost used tags:');
  data.tags.slice(0, 10).forEach(tag => {
    console.log(`  - ${tag} (${data.stats.tagCount[tag]} posts)`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { extractFrontmatter, parseListItems, generatePrefixes, main };
