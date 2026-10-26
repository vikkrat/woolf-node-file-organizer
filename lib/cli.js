import path from 'node:path';
import { DAY } from './files.js';

export const help = `FILE ORGANIZER | A clearer view of your files

Usage: node file-organizer.js <command> <directory> [options]

  scan        Recursive statistics, file types, ages and largest files
  duplicates  SHA-256 content comparison and wasted-space report
  organize    Copy into categories; requires --output <directory>
  cleanup     Preview old files; requires --older-than <days>

Options:
  --output <directory>  Destination outside the source directory
  --older-than <days>   Non-negative number of days since modification
  --confirm             Delete cleanup candidates (default: preview only)
  --help, -h            Show this help

Paths containing spaces must be quoted. No default directory is assumed.`;

/** Parse process.argv tokens strictly: typos must never silently alter cleanup behavior. */
export function parseArgs(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return { help: true };
  const [command, directory, ...flags] = args;
  if (!['scan', 'duplicates', 'organize', 'cleanup'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (directory === '--help' && !flags.length) return { help: true };
  if (!directory || directory.startsWith('--')) throw new Error('A directory is required. Use --help for examples.');
  const result = { command, directory: path.resolve(directory), confirm: false };
  const seen = new Set();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--confirm' && command === 'cleanup') result.confirm = true;
    else if ((flag === '--output' && command === 'organize') || (flag === '--older-than' && command === 'cleanup')) {
      const value = flags[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--output') result.output = path.resolve(value);
      else {
        if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error('--older-than must be a finite, non-negative number.');
        result.days = Number(value);
      }
    } else throw new Error(`Unsupported option for ${command}: ${flag}`);
  }
  if (command === 'organize' && !result.output) throw new Error('organize requires --output <directory>.');
  if (command === 'cleanup' && result.days === undefined) throw new Error('cleanup requires --older-than <days>.');
  return result;
}

/** Format bytes with binary units, including zero-byte files without logarithm edge cases. */
export function formatSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
  return `${unit ? bytes.toFixed(2) : bytes} ${units[unit]}`;
}

/** Update one terminal line; redirected logs receive a clean final progress line only. */
export function progress(label) {
  let count = 0;
  return {
    tick() { count++; if (process.stdout.isTTY) process.stdout.write(`\r${label}... ${count} files`); },
    finish() { console.log(`${process.stdout.isTTY ? '\r' : ''}${label} [####################] ${count} files`); },
  };
}

/** Print scan statistics while keeping presentation outside the Scanner class. */
export function printScan(result) {
  console.log(`\nSCAN RESULTS\n${'-'.repeat(56)}\nTotal files: ${result.totalFiles}\nTotal size: ${formatSize(result.totalSize)}\n\nBy file type:`);
  for (const [type, stats] of [...result.types].sort()) console.log(`  ${type.padEnd(16)} ${String(stats.count).padStart(3)} files  ${formatSize(stats.totalSize)}`);
  console.log(`\nFile age (cumulative):\n  Last 7 days: ${result.ages.last7}\n  Last 30 days: ${result.ages.last30}\n  Older than 90 days: ${result.ages.older90}\n\nLargest files:`);
  result.largest.forEach((file, index) => console.log(`  ${index + 1}. ${path.basename(file.path)} (${formatSize(file.size)})`));
  console.log(result.oldest ? `\nOldest file: ${path.basename(result.oldest.path)} (${Math.floor((Date.now() - result.oldest.mtime) / DAY)} days ago)` : '  No files found.');
}
