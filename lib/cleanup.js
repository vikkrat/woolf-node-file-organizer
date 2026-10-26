import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { DAY, directoryPath, fileError, walk } from './files.js';

export class Cleanup extends EventEmitter {
  /** Preview by default. Only explicit confirmation enables deletion.
   * Emit the full plan before deleting, then recheck metadata to avoid deleting changed files.
   */
  async cleanup(directory, days, confirm = false) {
    if (!Number.isFinite(days) || days < 0) throw new Error('--older-than must be a finite, non-negative number.');
    const root = await directoryPath(directory);
    const cutoff = Date.now() - days * DAY;
    const files = [];
    for await (const file of walk(root)) {
      if (file.mtime.getTime() < cutoff) { files.push(file); this.emit('file-found', file); }
    }
    const result = { files, totalSize: files.reduce((sum, file) => sum + file.size, 0), deleted: 0, freed: 0, dryRun: !confirm };
    this.emit('cleanup-plan', result);
    if (confirm) {
      for (const file of files) {
        try {
          const current = await fs.lstat(file.path);
          if (!current.isFile() || current.size !== file.size || current.mtime.getTime() !== file.mtime.getTime()) {
            throw new Error('File changed after preview; deletion stopped');
          }
          await fs.unlink(file.path);
        } catch (error) { throw fileError(error, 'Delete file', file.path); }
        result.deleted++;
        result.freed += file.size;
        this.emit('file-deleted', file);
      }
    }
    this.emit('cleanup-complete', result);
    return result;
  }
}
