import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { STREAM_THRESHOLD, contains, directoryPath, futurePath, fileError, walk } from './files.js';

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx', '.csv'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.mjs', '.ts', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'], Other: [],
};

/** Normalize extension case so PHOTO.JPG and photo.jpg share the same category. */
export function categoryFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return Object.keys(categories).find(name => categories[name].includes(extension)) ?? 'Other';
}

/** Copy exclusively, retrying name collisions without overwriting existing files.
 * Large files reserve the destination with 'wx' and use pipeline for backpressure.
 * On a stream failure, close the handle and remove only the partial file we created.
 */
async function copyUnique(file, folder) {
  const { name, ext } = path.parse(file.path);
  for (let suffix = 0; ; suffix++) {
    const target = path.join(folder, `${name}${suffix ? `(${suffix})` : ''}${ext}`);
    let handle;
    try {
      if (file.size < STREAM_THRESHOLD) await fs.copyFile(file.path, target, constants.COPYFILE_EXCL);
      else {
        handle = await fs.open(target, 'wx');
        await pipeline(createReadStream(file.path), handle.createWriteStream());
      }
      return target;
    } catch (error) {
      if (handle) {
        try { await handle.close(); await fs.unlink(target); }
        catch (cleanupError) { throw fileError(cleanupError, 'Remove incomplete copy', target); }
      }
      if (error.code === 'EEXIST' && !handle) continue;
      throw fileError(error, 'Copy file', file.path);
    }
  }
}

export class Organizer extends EventEmitter {
  /** Copy a directory into six flat categories, rejecting any source/output overlap. */
  async organize(directory, output) {
    const root = await directoryPath(directory);
    const target = await futurePath(path.resolve(output));
    if (contains(root, target) || contains(target, root)) throw new Error('Source and output directories must not overlap.');
    const counts = Object.fromEntries(Object.keys(categories).map(name => [name, 0]));
    for (const name of Object.keys(categories)) {
      const folder = path.join(target, name);
      try {
        await fs.mkdir(folder, { recursive: true });
        if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('Category directories must not be symbolic links');
      } catch (error) { throw fileError(error, 'Create category', folder); }
    }
    const result = { counts, totalFiles: 0, totalSize: 0, output: target };
    for await (const file of walk(root)) {
      const category = categoryFor(file.path);
      this.emit('copy-start', file);
      try {
        const destination = await copyUnique(file, path.join(target, category));
        result.counts[category]++;
        result.totalFiles++;
        result.totalSize += file.size;
        this.emit('copy-complete', { ...file, destination });
      } catch (error) { this.emit('copy-error', { file, error }); throw error; }
    }
    this.emit('organize-complete', result);
    return result;
  }
}
