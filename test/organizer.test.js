import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Scanner } from '../lib/scanner.js';
import { DuplicateFinder, calculateHash } from '../lib/duplicates.js';
import { Organizer } from '../lib/organizer.js';
import { Cleanup } from '../lib/cleanup.js';
import { DAY, STREAM_THRESHOLD } from '../lib/files.js';
import { parseArgs } from '../lib/cli.js';

const project = fileURLToPath(new URL('../', import.meta.url));

/** Allocate fixtures exclusively under this project; cleanup can never target user folders. */
async function fixture(t) {
  const base = path.join(project, 'test-data');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'test-'));
  const input = path.join(root, 'input');
  await fs.mkdir(input);
  t.after(async () => {
    assert.ok(root.startsWith(`${base}${path.sep}`));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, input, output: path.join(root, 'output') };
}

test('recursive scan: types, cumulative ages, top three, oldest and events', async t => {
  const { input } = await fixture(t);
  await fs.mkdir(path.join(input, 'nested'));
  for (const [name, days, size] of [['a.TXT', 1, 1], ['nested/b.txt', 20, 2], ['c.pdf', 120, 3], ['d.js', 50, 4]]) {
    const file = path.join(input, name);
    await fs.writeFile(file, Buffer.alloc(size));
    const date = new Date(Date.now() - days * DAY);
    await fs.utimes(file, date, date);
  }
  const scanner = new Scanner();
  let events = 0;
  scanner.on('file-found', () => events++);
  const result = await scanner.scan(input);
  assert.equal(events, 4);
  assert.equal(result.totalSize, 10);
  assert.equal(result.types.get('.txt').count, 2);
  assert.deepEqual(result.ages, { last7: 1, last30: 2, older90: 1 });
  assert.deepEqual(result.largest.map(file => file.size), [4, 3, 2]);
  assert.equal(path.basename(result.oldest.path), 'c.pdf');
});

test('SHA-256 groups equal content and counts only redundant bytes', async t => {
  const { input } = await fixture(t);
  for (const name of ['one.txt', 'two.pdf', 'three']) await fs.writeFile(path.join(input, name), 'abc');
  await fs.writeFile(path.join(input, 'different.txt'), 'xyz');
  const result = await new DuplicateFinder().find(input);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(result.wasted, 6);
});

test('organize: all categories, threshold stream, repeated collisions and unchanged sources', async t => {
  const { input, output } = await fixture(t);
  for (const name of ['a.txt', 'b.JPG', 'c.zip', 'd.js', 'e.mp4', 'unknown']) await fs.writeFile(path.join(input, name), name);
  const large = path.join(input, 'large.mp4');
  const handle = await fs.open(large, 'w');
  await handle.truncate(STREAM_THRESHOLD);
  await handle.close();
  const organizer = new Organizer();
  const result = await organizer.organize(input, output);
  assert.deepEqual(result.counts, { Documents: 1, Images: 1, Archives: 1, Code: 1, Videos: 2, Other: 1 });
  assert.equal(await calculateHash(large), await calculateHash(path.join(output, 'Videos', 'large.mp4')));
  await organizer.organize(input, output);
  await organizer.organize(input, output);
  assert.equal(await fs.readFile(path.join(output, 'Documents', 'a(2).txt'), 'utf8'), 'a.txt');
  assert.equal((await fs.readdir(input)).length, 7);
  assert.equal((await fs.stat(large)).size, STREAM_THRESHOLD);
});

test('organize rejects same, nested and ancestor output directories', async t => {
  const { root, input } = await fixture(t);
  for (const output of [root, input, path.join(input, 'sorted')]) {
    await assert.rejects(new Organizer().organize(input, output), /must not overlap/);
  }
});

test('cleanup preview preserves files; confirmed cleanup deletes only old candidates', async t => {
  const { input } = await fixture(t);
  const old = path.join(input, 'old.txt');
  await fs.writeFile(old, 'old');
  await fs.writeFile(path.join(input, 'fresh.txt'), 'fresh');
  const date = new Date(Date.now() - 120 * DAY);
  await fs.utimes(old, date, date);
  const cleanup = new Cleanup();
  const preview = await cleanup.cleanup(input, 90);
  assert.equal(preview.files.length, 1);
  assert.equal(preview.deleted, 0);
  assert.equal((await fs.readdir(input)).length, 2);
  const result = await cleanup.cleanup(input, 90, true);
  assert.equal(result.deleted, 1);
  assert.equal(result.freed, 3);
  assert.deepEqual(await fs.readdir(input), ['fresh.txt']);
});

test('empty directories and zero-byte duplicate files are supported', async t => {
  const { input } = await fixture(t);
  assert.equal((await new Scanner().scan(input)).oldest, null);
  assert.deepEqual((await new DuplicateFinder().find(input)).groups, []);
  for (const name of ['a', 'b']) await fs.writeFile(path.join(input, name), '');
  const result = await new DuplicateFinder().find(input);
  assert.equal(result.groups.length, 1);
  assert.equal(result.wasted, 0);
});

test('invalid CLI options and missing paths fail with non-zero exit status', async t => {
  const { input } = await fixture(t);
  for (const args of [['cleanup', input, '--confirm'], ['cleanup', input, '--older-than', 'NaN'], ['scan', input, '--confirm'], ['organize', input], ['cleanup', input, '--older-than', '-1'], ['scan', input, '--typo']]) {
    assert.throws(() => parseArgs(args));
  }
  const processResult = spawnSync(process.execPath, ['file-organizer.js', 'scan', path.join(input, 'missing')], { cwd: project, encoding: 'utf8' });
  assert.equal(processResult.status, 1);
  assert.match(processResult.stderr, /Path not found/);
});

test('directory junctions are skipped and cannot redirect the output into source', async t => {
  const { root, input } = await fixture(t);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
  try { await fs.symlink(outside, path.join(input, 'linked'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not permit links'); return; } throw error; }
  assert.equal((await new Scanner().scan(input)).totalFiles, 0);
  await fs.symlink(input, path.join(root, 'alias'), 'junction');
  await assert.rejects(new Organizer().organize(input, path.join(root, 'alias', 'output')), /must not overlap/);
});
