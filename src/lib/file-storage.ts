import path from "path";
import { mkdir, rename, unlink } from "fs/promises";
import { existsSync } from "fs";
import { UPLOAD_DIR, IMPORT_DIR } from "./constants";

/**
 * Central path resolution for files.
 *
 * Layout:
 *   - User uploads:  /data/uploads/<userId>/<fileName>
 *   - Admin imports: /data/import/<fileName>
 *
 * Fallback: Existing files that still lie flat in /data/uploads
 * (before the restructure) are still found.
 */

export interface StorageFileLike {
  name: string;
  userId?: string | null;
}

function resolveInside(baseDir: string, ...parts: string[]): string | null {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(base, ...parts);
  return candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
}

/**
 * Returns the target folder for a user (uploads) and creates it.
 * Folder permissions: 0755 (no write access for others, no execute bits for files).
 */
export async function ensureUserUploadDir(userId: string): Promise<string> {
  const dir = resolveInside(UPLOAD_DIR, userId);
  if (!dir) throw new Error("Invalid user upload path");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o755 });
  }
  return dir;
}

/**
 * Full path to a file in the user uploads folder.
 * Falls back to the flat path (legacy) if the user folder does not exist.
 */
export function getUploadPath(file: StorageFileLike): string {
  if (file.userId) {
    const userPath = resolveInside(UPLOAD_DIR, file.userId, file.name);
    if (userPath && existsSync(userPath)) return userPath;
  }
  return resolveInside(UPLOAD_DIR, file.name) || path.join(path.resolve(UPLOAD_DIR), "__invalid_file_path__");
}

/**
 * Full path to a file in the import folder.
 */
export function getImportPath(file: StorageFileLike): string {
  return resolveInside(IMPORT_DIR, file.name) || path.join(path.resolve(IMPORT_DIR), "__invalid_file_path__");
}

/**
 * Finds the actual path of a file (uploads OR import).
 * Backward-compatible: existing flat files in /data/uploads are found.
 */
export function getFilePath(file: StorageFileLike): string {
  const uploadPath = getUploadPath(file);
  if (existsSync(uploadPath)) return uploadPath;

  const importPath = getImportPath(file);
  if (existsSync(importPath)) return importPath;

  // Last fallback: the upload path, even if it does not exist yet (error case)
  return uploadPath;
}

/**
 * Finds a file and returns null if it exists nowhere.
 */
export function findFileOnDisk(file: StorageFileLike): string | null {
  const uploadPath = getUploadPath(file);
  if (existsSync(uploadPath)) return uploadPath;

  const importPath = getImportPath(file);
  if (existsSync(importPath)) return importPath;

  return null;
}

/**
 * Moves a file from the import folder into the user uploads folder.
 */
export async function moveImportToUploads(file: StorageFileLike, userId: string): Promise<string> {
  const importPath = getImportPath(file);
  if (!existsSync(importPath)) {
    throw new Error("Import file not found on disk");
  }

  const userDir = await ensureUserUploadDir(userId);
  const finalPath = resolveInside(userDir, file.name);
  if (!finalPath) throw new Error("Invalid upload file path");

  await rename(importPath, finalPath);
  return finalPath;
}

/**
 * Deletes a file from disk (whether upload or import).
 * Ignores errors if the file does not exist.
 */
export async function removeFileFromDisk(file: StorageFileLike): Promise<void> {
  const uploadPath = getFilePath(file);
  try {
    if (existsSync(uploadPath)) await unlink(uploadPath);
  } catch { /* ignore */ }
}

/**
 * Checks whether a file exists (uploads or import).
 */
export function fileExistsOnDisk(file: StorageFileLike): boolean {
  return existsSync(getUploadPath(file)) || existsSync(getImportPath(file));
}
