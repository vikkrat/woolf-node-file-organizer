import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { directoryPath, fileError, walk } from './files.js';

/** Hash chunks incrementally: file size does not determine the memory needed to read it. */
export async function calculateHash(filePath) {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) { throw fileError(error, 'Hash file', filePath); }
}

export class DuplicateFinder extends EventEmitter {
  /** Group every regular file by SHA-256; count only redundant copies as wasted space. */
  async find(directory) {
    const root = await directoryPath(directory);
    const hashes = new Map();
    for await (const file of walk(root)) {
      const hash = await calculateHash(file.path);
      const group = hashes.get(hash) ?? { hash, size: file.size, files: [] };
      group.files.push(file.path);
      hashes.set(hash, group);
      this.emit('file-processed', file);
    }
    const groups = [...hashes.values()].filter(group => group.files.length > 1)
      .map(group => ({ ...group, wasted: group.size * (group.files.length - 1) }));
    const result = { groups, wasted: groups.reduce((sum, group) => sum + group.wasted, 0) };
    this.emit('duplicates-found', result);
    return result;
  }
}
