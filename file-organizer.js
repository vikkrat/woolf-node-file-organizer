#!/usr/bin/env node
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { help, parseArgs, formatSize, progress, printScan } from './lib/cli.js';

/** Connect domain events to console output; errors reach one boundary with exit code 1. */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(help); return; }
  console.log(`\nFILE ORGANIZER / ${options.command.toUpperCase()}\nDirectory: ${options.directory}\n`);
  if (options.command === 'scan') {
    const scanner = new Scanner();
    const bar = progress('Scanning');
    scanner.on('file-found', () => bar.tick());
    scanner.on('scan-complete', result => { bar.finish(); printScan(result); });
    await scanner.scan(options.directory);
  } else if (options.command === 'duplicates') {
    const finder = new DuplicateFinder();
    const bar = progress('Hashing');
    finder.on('file-processed', () => bar.tick());
    finder.on('duplicates-found', result => {
      bar.finish();
      console.log(`\nFound ${result.groups.length} duplicate groups (${formatSize(result.wasted)} wasted)`);
      result.groups.forEach((group, index) => {
        console.log(`\nGroup ${index + 1}: ${group.files.length} copies, ${formatSize(group.size)} each\nSHA-256: ${group.hash}`);
        group.files.forEach(file => console.log(`  ${file}`));
        console.log(`Wasted space: ${formatSize(group.wasted)}`);
      });
    });
    await finder.find(options.directory);
  } else if (options.command === 'organize') {
    const organizer = new Organizer();
    const bar = progress('Copying');
    console.log(`Output: ${options.output}`);
    organizer.on('copy-complete', () => bar.tick());
    organizer.on('organize-complete', result => {
      bar.finish();
      console.log('\nORGANIZATION COMPLETE\n');
      for (const [name, count] of Object.entries(result.counts)) console.log(`  ${name.padEnd(12)} ${count} files`);
      console.log(`\nTotal copied: ${result.totalFiles} files (${formatSize(result.totalSize)})\nOriginal files preserved. Name collisions receive numbered suffixes.`);
    });
    await organizer.organize(options.directory, options.output);
  } else {
    const cleanup = new Cleanup();
    const bar = progress('Deleting');
    console.log(`Looking for files modified more than ${options.days} days ago.`);
    cleanup.on('cleanup-plan', result => {
      console.log(`\nFound ${result.files.length} candidates:\n`);
      for (const file of result.files) console.log(`  ${file.path}\n    ${formatSize(file.size)} | modified ${file.mtime.toISOString().slice(0, 10)}`);
      console.log(`\nTotal: ${result.files.length} files (${formatSize(result.totalSize)})`);
      if (!result.dryRun) console.log('\nDELETING listed files. This action cannot be undone.');
    });
    cleanup.on('file-deleted', () => bar.tick());
    cleanup.on('cleanup-complete', result => {
      if (result.dryRun) console.log('\nDRY RUN: No files were deleted. Add --confirm to delete.');
      else { bar.finish(); console.log(`\nCleanup complete: ${result.deleted} deleted (${formatSize(result.freed)} freed).`); }
    });
    await cleanup.cleanup(options.directory, options.days, options.confirm);
  }
}

try { await main(); }
catch (error) { console.error(`\nError: ${error.message}`); process.exitCode = 1; }
