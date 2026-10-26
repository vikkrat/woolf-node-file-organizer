import { EventEmitter } from 'node:events';
import path from 'node:path';
import { DAY, directoryPath, walk } from './files.js';

export class Scanner extends EventEmitter {
  /** Aggregate metadata in one pass. Age counters are cumulative (7 days is part of 30 days). */
  async scan(directory) {
    const root = await directoryPath(directory);
    const now = Date.now();
    const result = { totalFiles: 0, totalSize: 0, types: new Map(), ages: { last7: 0, last30: 0, older90: 0 }, largest: [], oldest: null };
    this.emit('scan-start', { directory: root });
    for await (const file of walk(root)) {
      result.totalFiles++;
      result.totalSize += file.size;
      const extension = path.extname(file.path).toLowerCase() || '(no extension)';
      const type = result.types.get(extension) ?? { count: 0, totalSize: 0 };
      type.count++;
      type.totalSize += file.size;
      result.types.set(extension, type);
      const age = (now - file.mtime.getTime()) / DAY;
      if (age <= 7) result.ages.last7++;
      if (age <= 30) result.ages.last30++;
      if (age > 90) result.ages.older90++;
      result.largest = [...result.largest, file].sort((a, b) => b.size - a.size).slice(0, 3);
      if (!result.oldest || file.mtime < result.oldest.mtime) result.oldest = file;
      this.emit('file-found', file);
    }
    this.emit('scan-complete', result);
    return result;
  }
}
