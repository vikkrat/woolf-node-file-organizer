import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DAY, fileError } from '../lib/files.js';

/** Create a new isolated fixture directory; refuse to overwrite an existing demo. */
async function createDemo() {
  const root = fileURLToPath(new URL('../test-data/', import.meta.url));
  await fs.mkdir(root, { recursive: true });
  const input = path.join(root, 'input');
  await fs.mkdir(input);
  await fs.mkdir(path.join(input, 'nested'));
  const files = {
    'notes.txt': 'A small collection of useful notes.\n',
    'nested/notes.txt': 'A different document with the same filename.\n',
    'notes-copy.txt': 'A small collection of useful notes.\n',
    'photo.JPG': 'Demo image placeholder\n',
    'backup.zip': 'Demo archive placeholder\n',
    'app.js': 'console.log("Hello, organized world!");\n',
    'data.json': '{"demo":true}\n',
    'README': 'An extensionless fixture.\n',
    'unknown.xyz': 'An unknown file type.\n',
    'old-report.pdf': 'Old document placeholder\n',
    'nested/old-image.png': 'Old image placeholder\n',
  };
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(input, name), content, { flag: 'wx' });
  // A sparse 12 MiB file exercises the streaming copy branch without a large allocation.
  const handle = await fs.open(path.join(input, 'demo-video.mp4'), 'wx');
  try { await handle.truncate(12 * 1024 * 1024); } finally { await handle.close(); }
  for (const name of ['old-report.pdf', 'nested/old-image.png']) {
    const old = new Date(Date.now() - 120 * DAY);
    await fs.utimes(path.join(input, name), old, old);
  }
  console.log(`Created 12 demo files in ${input}\nIncludes nested files, duplicates, two old files and a 12 MiB stream fixture.\nMedia files are placeholders, not playable documents or videos.`);
}

try { await createDemo(); }
catch (error) { console.error(fileError(error, 'Create demo (existing data is never reset)', 'test-data/input').message); process.exitCode = 1; }
