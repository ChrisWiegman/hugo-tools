#!/usr/bin/env node
'use strict';

/**
 * Generates a default .hugo-tools.json config file in the current Hugo site root.
 * Usage:
 *   config
 */

const fs = require('fs');
const path = require('path');
const { requireHugoSite, DEFAULTS } = require('./config');

function main() {
	requireHugoSite();

	const dest = path.join(process.cwd(), '.hugo-tools.json');

	if (fs.existsSync(dest)) {
		process.stderr.write('Error: .hugo-tools.json already exists.\n');
		process.exit(1);
	}

	fs.writeFileSync(dest, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
	console.log(`Created ${dest}`);
	console.log('Edit the values to match your Hugo site layout.');
}

main();
