# hugo-tools

A collection of CLI tools for Hugo bloggers. Run them directly from the root of your Hugo site via `npx` or install globally.

## Requirements

- Node.js 18 or later

## Installation

**Run without installing (recommended):**

```sh
npx -p @chriswiegman/hugo-tools <command> [args]
```

For example:

```sh
npx -p @chriswiegman/hugo-tools draft
npx -p @chriswiegman/hugo-tools publish content/drafts/my-post.md now
```

**Install locally in your Hugo project:**

```sh
npm install --save-dev @chriswiegman/hugo-tools
```

Then run commands via `npx` (no `-p` flag needed once installed) or add them as scripts in your `package.json`:

```json
{
  "scripts": {
    "publish": "publish",
    "extract-tags": "extract-tags"
  }
}
```

**Or install globally and run from any Hugo site root:**

```sh
npm install -g @chriswiegman/hugo-tools
publish content/drafts/my-post.md now
```

All commands must be run from the **root of your Hugo site**.

---

## Configuration

Run `config` from your Hugo site root to generate the file with all defaults:

```sh
config
```

Or create `.hugo-tools.json` manually:

```json
{
  "timezone": "America/Chicago",
  "postsDir": "content/posts",
  "draftsDir": "content/drafts",
  "notesDir": "content/notes",
  "booksDir": "content/books",
  "imagesDir": "assets/images",
  "vscodeDir": ".vscode"
}
```

All fields are optional. Shown values are the defaults.

---

## Commands

### `config`

Generates a `.hugo-tools.json` config file in the current directory with all default values.

```sh
config
```

Run this once after installing to get a config file you can edit. Exits with an error if `.hugo-tools.json` already exists.

---

### `vscode`

Scaffolds VS Code configuration for your Hugo site in your `vscodeDir` (default `.vscode/`).

```sh
vscode
```

Creates three files if they don't already exist — existing files are left untouched:

| File | Purpose |
|---|---|
| `tasks.json` | Tasks for `draft`, `add-tags`, `publish` (now & later), and `pick-image` |
| `extensions.json` | Recommends the markdown word-count and spell-checker extensions |
| `settings.json` | Markdown editor settings (snippet suggestions, word-based suggestions off) |

---

### `draft`

Creates a new draft file in your `draftsDir` and opens it in VS Code.

```sh
draft
```

Generates a timestamp-based filename (`YYYYMMDD-HHMMSS.md`) using your configured timezone, writes the standard draft front matter with a blank title and placeholder lists, and prints the path. No `date:` line is written — fill in the title before publishing.

**Generated front matter:**

```yaml
---
title: ""
description: ""
draft: true
images:
  -
categories:
  -
tags:
  -
---
```

---

### `publish`

Publishes a Hugo draft post by moving it from your drafts directory to the appropriate content directory and updating its front matter.

```sh
publish <draft-path> [now|later] [YYYY-MM-DD]
```

**Examples:**

```sh
# Publish immediately
publish content/drafts/my-post.md now

# Schedule for a future date (prompts if date omitted)
publish content/drafts/my-post.md later 2026-06-01
```

**What it does:**

- Sets `draft: false` and `date:` to now or 08:00 on the scheduled date (in your configured timezone)
- Moves the file to `content/posts/YYYY/MM-DD-slug.md`
- Short posts (under 200 words) without categories are treated as notes and moved to `content/notes/` instead
- Warns if the draft already had a different `date:` value

**Requirements for posts** (not notes):

- A `title:` in front matter
- At least one tag

---

### `extract-tags`

Scans all posts in your `postsDir` and writes two files to your `vscodeDir`:

- `tags-categories.json` — sorted list of all tags and categories with usage counts
- `markdown.code-snippets` — VSCode snippet definitions for autocomplete

```sh
extract-tags
```

Run this periodically to keep your tag/category list fresh. The snippet abbreviation map in [src/extract-tags.js](src/extract-tags.js) is pre-populated with some common shorthands — edit it to match your own taxonomy.

---

### `add-tags`

Interactive prompt to select categories and tags from your existing taxonomy, then prints the formatted front matter block to paste into a draft.

```sh
add-tags
```

Requires `extract-tags` to have been run at least once.

---

### `pick-image`

Lists images in your `imagesDir` for the current year/month, lets you pick one, and copies the Hugo-relative path to the clipboard.

```sh
pick-image
```

Clipboard support: macOS (`pbcopy`), Windows (`clip`), Linux (`xclip`, `xsel`, or `wl-copy` — whichever is available).

---

### `import-books`

Imports books from a [Goodreads CSV export](https://www.goodreads.com/review/import) into Hugo content files under `booksDir`.

```sh
import-books path/to/goodreads_library_export.csv
```

**What it does:**

- Creates `content/books/<author-slug>/<title-slug>.md` for each book on your "read" shelf
- Front matter includes title, author, star rating, finish date(s), and links to Amazon, Open Library, and Goodreads
- Any Goodreads review text becomes the file body
- Safe to re-run: existing files are matched by Goodreads ID or ISBN, finish dates are merged, and unchanged files are skipped
- If a book's title changed in Goodreads, the file is renamed automatically

**To export from Goodreads:** Account → My Books → Import and Export → Export Library.

---

## Contributing

Issues and PRs welcome at <https://github.com/ChrisWiegman/hugo-tools>.
