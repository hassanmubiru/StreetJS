/**
 * @streetjs/storage — the Directory API over a flat key space (task 17.1).
 *
 * Object stores have a flat key space with no real directories. This module
 * implements a directory-style API entirely over that flat key space using
 * `/`-delimited prefixes, so the same code runs unchanged on every
 * {@link StorageDriver} — including prefix-only cloud providers (Requirement
 * 15.5). The facade exposes the constructed instance as `storage.directory`.
 *
 * The four operations map onto driver primitives (`list`/`put`/`delete`) as
 * follows:
 *
 * - `mkdir(path)` records an empty marker key `path/`, making the path
 *   available as a directory prefix (Requirement 15.1). A root/empty path needs
 *   no marker and is a no-op.
 * - `listDirectory(path)` calls `driver.list(path/)` and collapses the results
 *   to the **immediate** children by splitting each key on the next `/` after
 *   the prefix: keys with no further `/` are file entries, keys with a further
 *   `/` contribute a single synthesized sub-directory entry (Requirement 15.2).
 * - `removeDirectory(path)` deletes every key under the prefix; when the prefix
 *   contains no objects it is a success no-op that removes nothing
 *   (Requirements 15.3, 15.6).
 * - `walk(path)` returns every object key strictly beneath the prefix
 *   (Requirement 15.4).
 *
 * The public {@link DirectoryApi} type is owned by `facade.ts` (and re-exported
 * from `index.ts`); it is imported here type-only so there is no runtime import
 * cycle between the two modules.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
 */

import type { StorageDriver } from "./driver.js";
import type { DirectoryApi } from "./facade.js";
import type { StorageListItem } from "./types.js";

/** The directory delimiter used to derive prefixes from paths. */
const DELIMITER = "/";

/**
 * A {@link DirectoryApi} implementation over any {@link StorageDriver}'s flat
 * key space. It holds only the driver and derives every directory operation
 * from `/`-delimited prefixes, so it behaves identically across providers.
 */
export class StorageDirectoryApi implements DirectoryApi {
  private readonly driver: StorageDriver;

  constructor(driver: StorageDriver) {
    this.driver = driver;
  }

  /**
   * Normalize a directory `path` to a prefix ending in the delimiter. The root
   * (`""` or `"/"`) normalizes to the empty prefix (which matches every key),
   * and any leading delimiter is dropped so `"/photos"` and `"photos"` refer to
   * the same directory. A path that already ends with the delimiter is left
   * unchanged.
   */
  private toPrefix(path: string): string {
    let p = path;
    while (p.startsWith(DELIMITER)) {
      p = p.slice(DELIMITER.length);
    }
    if (p === "") {
      return "";
    }
    return p.endsWith(DELIMITER) ? p : p + DELIMITER;
  }

  /**
   * List the keys stored under `prefix`, defensively re-filtering by the prefix
   * so drivers that interpret `list` loosely never leak keys from outside the
   * directory into a directory operation.
   */
  private async keysUnder(prefix: string): Promise<StorageListItem[]> {
    const items = await this.driver.list(prefix);
    if (prefix === "") {
      return items;
    }
    return items.filter((item) => item.key.startsWith(prefix));
  }

  /**
   * Make `path` available as a directory prefix by recording an empty marker
   * key `path/` (Requirement 15.1). The root/empty path requires no marker and
   * is a no-op.
   */
  async mkdir(path: string): Promise<void> {
    const prefix = this.toPrefix(path);
    if (prefix === "") {
      return;
    }
    await this.driver.put(prefix, new Uint8Array(0), {});
  }

  /**
   * Return the immediate child entries under `path` (Requirement 15.2). Each
   * key under the prefix is split on the next delimiter: a key with no further
   * delimiter is returned as its file entry; keys sharing a further path
   * segment collapse into a single synthesized sub-directory entry (key
   * `path/child/`, `size` 0). The directory's own marker (a key equal to the
   * prefix) is not reported as a child.
   */
  async listDirectory(path: string): Promise<StorageListItem[]> {
    const prefix = this.toPrefix(path);
    const items = await this.keysUnder(prefix);

    const files: StorageListItem[] = [];
    const directories = new Map<string, StorageListItem>();

    for (const item of items) {
      const remainder = item.key.slice(prefix.length);
      if (remainder === "") {
        // The directory's own marker key — not one of its children.
        continue;
      }
      const slash = remainder.indexOf(DELIMITER);
      if (slash === -1) {
        // Immediate file child.
        files.push(item);
        continue;
      }
      // Immediate sub-directory child: collapse everything sharing this segment
      // into a single directory entry, tracking the most recent update time.
      const dirKey = prefix + remainder.slice(0, slash) + DELIMITER;
      const existing = directories.get(dirKey);
      if (existing === undefined || item.updatedAt > existing.updatedAt) {
        directories.set(dirKey, { key: dirKey, size: 0, updatedAt: item.updatedAt });
      }
    }

    return [...directories.values(), ...files];
  }

  /**
   * Remove every object stored under `path` (Requirement 15.3). When the prefix
   * contains no objects — because the directory does not exist or is already
   * empty — nothing is removed and a success result of `{ removed: false }` is
   * returned without throwing (Requirement 15.6). When at least one object is
   * removed the result is `{ removed: true }`.
   */
  async removeDirectory(path: string): Promise<{ readonly removed: boolean }> {
    const prefix = this.toPrefix(path);
    const items = await this.keysUnder(prefix);
    if (items.length === 0) {
      return { removed: false };
    }
    for (const item of items) {
      await this.driver.delete(item.key);
    }
    return { removed: true };
  }

  /**
   * Return every object key strictly beneath `path` (Requirement 15.4),
   * excluding the directory's own marker key (a key equal to the prefix).
   */
  async walk(path: string): Promise<string[]> {
    const prefix = this.toPrefix(path);
    const items = await this.keysUnder(prefix);
    return items.map((item) => item.key).filter((key) => key !== prefix);
  }
}
