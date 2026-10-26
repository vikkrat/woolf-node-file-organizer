import fs from 'node:fs/promises';
import path from 'node:path';

export const DAY = 86_400_000;
export const STREAM_THRESHOLD = 10 * 1024 * 1024;

/** Translate filesystem error codes without hiding the original operation or path. */
export function fileError(error, operation, target) {
  const reasons = {
    ENOENT: 'Path not found', EACCES: 'Permission denied', EPERM: 'Operation not permitted',
    ENOTDIR: 'Expected a directory', EISDIR: 'Expected a file', ENOSPC: 'Disk is full',
    EEXIST: 'Destination already exists', EBUSY: 'File is busy', ELOOP: 'Symbolic link loop',
  };
  return new Error(`${operation}: ${reasons[error.code] ?? error.message}: ${target}`, { cause: error });
}

/** Resolve an existing directory, including aliases, before comparing source and output paths. */
export async function directoryPath(directory) {
  try {
    const resolved = await fs.realpath(directory);
    if (!(await fs.stat(resolved)).isDirectory()) {
      throw Object.assign(new Error('Expected a directory'), { code: 'ENOTDIR' });
    }
    return resolved;
  } catch (error) { throw fileError(error, 'Open directory', directory); }
}

/** Resolve existing ancestors of a new output path so junctions cannot bypass overlap checks. */
export async function futurePath(target) {
  try { return await fs.realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw fileError(error, 'Resolve output', target);
    const parent = path.dirname(target);
    if (parent === target) throw fileError(error, 'Resolve output', target);
    return path.join(await futurePath(parent), path.basename(target));
  }
}

/** Check directory containment using path segments rather than ambiguous string prefixes. */
export function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Walk deterministically, skipping symbolic links/junctions and non-regular files.
 * Each yielded record has the absolute path, byte size, and modification date.
 * A read failure stops the command instead of reporting an incomplete scan as success.
 */
export async function* walk(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { throw fileError(error, 'Read directory', directory); }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    let stats;
    try { stats = await fs.lstat(target); }
    catch (error) { throw fileError(error, 'Inspect entry', target); }
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) yield* walk(target);
    else if (stats.isFile()) yield { path: target, size: stats.size, mtime: stats.mtime };
  }
}
