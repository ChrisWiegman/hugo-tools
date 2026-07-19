# hugo-tools

A collection of CLI tools for Hugo bloggers. Run them directly from the root of your Hugo site via `npx` or install globally.

> **Never invoke these with `node path/to/script.js`.** Every command below is registered as a proper CLI via the `bin` field in `package.json`, so once installed you run it by name (`draft`, `publish`, ...) — see [Installation](#installation) for the three ways to do that.

## Requirements

- Node.js 18 or later

## Installation

Whichever route you pick, you're done as soon as you can run a bare command name (`draft`, `publish`, ...) — you should never need to reference a file path under `node_modules/` directly.

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

Then run commands via `npx` (no `-p` flag needed once installed):

```sh
npx draft
npx publish content/drafts/my-post.md now
```

...or add them as scripts in your `package.json` so `npm run publish` works too:

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
  "coversDir": "assets/images/books",
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

Moves an image into your `imagesDir` under the current year/month and inserts a reference into a Hugo content file.

```sh
pick-image <image-file> [content-file]
```

**What it does:**

- Moves `<image-file>` to `assets/images/YYYY/MM/<filename>` (creates the directory if needed)
- Derives the Hugo URL path by stripping the `assets/` prefix (e.g. `/images/YYYY/MM/filename`)
- If a `[content-file]` is given:
  - Appends the path to the `images:` array in front matter when that field is present (replacing any placeholder `  -` entry)
  - Otherwise appends a `![](path)` markdown tag to the end of the body
- If no `[content-file]` is given, copies the URL path to the clipboard instead

**Examples:**

```sh
# Move photo.jpg and insert into the currently open draft
pick-image ~/Downloads/photo.jpg content/drafts/my-post.md

# Move photo.jpg and copy the path to the clipboard
pick-image ~/Downloads/photo.jpg
```

The VS Code "Pick Image" task prompts for the image path and automatically passes the currently open file as the content target — drag the image file into the terminal prompt to fill the path.

Clipboard support (no-content-file mode): macOS (`pbcopy`), Windows (`clip`), Linux (`xclip`, `xsel`, or `wl-copy` — whichever is available).

---

### `import-books`

Imports books from a [Goodreads CSV export](https://www.goodreads.com/review/import) into Hugo content files under `booksDir`.

```sh
import-books path/to/goodreads_library_export.csv [--covers]
```

**What it does:**

- Creates `content/books/<author-slug>/<title-slug>.md` for each book on your "read" shelf
- Front matter includes title, author, star rating, finish date(s), links to Amazon, Open Library, and Goodreads, a `reference: { isbn, asin }` block, and a `cover` field
- Any Goodreads review text becomes the file body
- Safe to re-run: existing files are matched by Goodreads ID or ISBN, finish dates are merged, and unchanged files are skipped
- If a book's title changed in Goodreads, the file is renamed automatically
- `reference.isbn`/`reference.asin` are backfilled onto existing files that are missing them — a value already in the file (e.g. entered by hand) is never overwritten

**Re-reads:** Goodreads' CSV export only ever contains the *most recent* "Date Read" for a book, even when its "Read Count" shows it was finished more than once. So if you re-read a book, the next export will carry the new completion date and it's automatically added to `finished` — nothing is ever overwritten or removed, dates only accumulate. What the export can't give you is *earlier* read dates for a book you'd already read more than once before you started tracking it here. When "Read Count" is higher than the number of dates already on file, the import prints a line like:

```
NOTE: king-stephen/the-gunslinger.md shows 3x read on Goodreads but only 1 date(s) on file — Goodreads only exports the latest read date, so add earlier ones to 'finished' by hand.
```

This is informational only — the file isn't touched, and nothing else about the import is blocked. Add the missing date(s) to the file's `finished:` list yourself; the note stops appearing once the counts match. A run's summary also reports how many books were flagged this way (`Rereads needing dates`).

**ASIN lookup:** Goodreads exports don't include an ASIN, so it's looked up per ISBN from Open Library, then Google Books, and left blank (`""`) if neither has one. To use the official Amazon Product Advertising API as a final fallback, add credentials to `.hugo-tools.json`:

```json
{
  "amazonPaApi": {
    "accessKey": "",
    "secretKey": "",
    "partnerTag": ""
  }
}
```

This requires an approved Amazon Associates account with Product Advertising API access.

**Cover art:** off by default — pass `--covers` to fetch it. When enabled, each book's ISBN is looked up against Open Library's cover API, then Google Books, and left blank if neither has one. Downloaded images are saved to `coversDir` (default `assets/images/books/<author-slug>/<title-slug>.<ext>`) and the `cover` field is set to the corresponding Hugo URL path (e.g. `/images/books/king-stephen/it.jpg`). On existing files, only a blank `cover` field is backfilled — a cover already set (e.g. entered by hand) is never overwritten, and no network requests are made at all unless `--covers` is passed.

**To export from Goodreads:** Account → My Books → Import and Export → Export Library.

---

## Contributing

Issues and PRs welcome at <https://github.com/ChrisWiegman/hugo-tools>.
