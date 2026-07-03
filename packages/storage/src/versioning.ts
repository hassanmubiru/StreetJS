/**
 * @streetjs/storage — the versioning manager.
 *
 * Versioning retains the prior content of an object whenever a versioned key is
 * overwritten, so historical Versions can be listed, restored, and deleted
 * (Requirement 12). {@link VersioningManager} provides this capability in a
 * **provider-agnostic** way:
 *
 * - When the backing {@link StorageDriver} implements the optional native
 *   `versioning` capability, the manager delegates each operation to the driver
 *   so a provider with first-class versioning (e.g. S3 bucket versioning) is
 *   used directly.
 * - Otherwise the manager **simulates** versioning over the mandatory driver
 *   primitives (`put`/`get`/`stat`/`list`/`delete`). Each snapshot copies the
 *   current object's bytes and write-time metadata to a reserved key
 *   `${VERSION_KEY_PREFIX}<key>/<versionId>` (mirroring the design's
 *   `.versions/<key>/<versionId>` layout). Versions are enumerated by listing
 *   that reserved prefix and restored/deleted by reading/removing the reserved
 *   copy. No cap is imposed on the number of retained Versions (Requirement
 *   12.1).
 *
 * Semantics (Requirement 12):
 * - {@link VersioningManager.snapshot} captures the current content of `key` as
 *   a new Version and returns its id, or `null` when there is nothing to
 *   snapshot (the key does not yet exist). Crucially, when the snapshot itself
 *   fails for any reason — a storage constraint or system error — it returns
 *   `null` **without throwing** so the caller's overwrite still proceeds without
 *   a Version being created (Requirement 12.5).
 * - {@link VersioningManager.listVersions} returns the {@link VersionInfo}
 *   descriptors of the retained Versions for `key` (Requirement 12.2).
 * - {@link VersioningManager.restoreVersion} makes the content of the identified
 *   Version the current object content and returns the resulting metadata
 *   (Requirement 12.3).
 * - {@link VersioningManager.deleteVersion} removes exactly the identified
 *   Version while retaining the rest (Requirement 12.4).
 *
 * The module depends only on the driver contract, the shared type surface, the
 * error hierarchy, the metadata layer, and `node:crypto`, keeping the
 * dependency direction acyclic.
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
 */

import { randomUUID } from "node:crypto";

import type { StorageDriver, VersioningCapability } from "./driver.js";
import { NotFoundError } from "./errors.js";
import { normalizeMetadata, toWriteMetadata } from "./metadata.js";
import type { StorageObjectMetadata, VersionInfo } from "./types.js";

/**
 * Reserved key prefix under which simulated Versions are persisted via the
 * driver primitives. A Version of `<key>` lives at
 * `${VERSION_KEY_PREFIX}<key>/<versionId>`. These reserved keys hold historical
 * copies and are never surfaced through the object-operation API.
 */
const VERSION_KEY_PREFIX = ".versions/";

/**
 * Provider-agnostic versioning manager built on the driver contract.
 *
 * A single instance is held by the facade and bound to one {@link StorageDriver}
 * for its lifetime, so the native-vs-simulated decision (based on whether the
 * driver exposes a `versioning` capability) is stable across every call.
 */
export class VersioningManager {
  /** The driver every operation is delegated to or simulated over. */
  private readonly driver: StorageDriver;

  constructor(driver: StorageDriver) {
    this.driver = driver;
  }

  /** The driver's native versioning capability, when present. */
  private get native(): VersioningCapability | undefined {
    return this.driver.versioning;
  }

  /**
   * Capture the current content of `key` as a new Version and return its id, or
   * `null` when there is nothing to snapshot (the key does not exist yet).
   *
   * This is invoked by the facade immediately before an overwriting `put` when
   * versioning is enabled. Per Requirement 12.5, a failure of the versioning
   * mechanism must never block the overwrite: any error raised while reading the
   * current object or persisting the snapshot is swallowed and `null` is
   * returned, so the caller proceeds to overwrite without a Version. The prior
   * content retained on success is unlimited in count (Requirement 12.1).
   */
  async snapshot(key: string): Promise<string | null> {
    try {
      if (this.native !== undefined) {
        return await this.native.snapshot(key);
      }
      const current = await this.driver.get(key);
      if (!current.found) {
        // Nothing to snapshot: first write to this key creates no Version.
        return null;
      }
      const versionId = randomUUID();
      await this.driver.put(
        this.versionKey(key, versionId),
        current.bytes,
        toWriteMetadata(current.metadata),
      );
      return versionId;
    } catch {
      // Requirement 12.5: a versioning failure allows the overwrite to proceed
      // WITHOUT creating a Version. Never propagate the error to the write path.
      return null;
    }
  }

  /**
   * Return the {@link VersionInfo} descriptors of the retained Versions for
   * `key` (Requirement 12.2). For the simulated path the reserved version prefix
   * is listed and each version's `size`/`checksum`/`createdAt` is read from its
   * stored metadata; entries are returned oldest-first by creation time. Only
   * direct Versions of `key` are included — copies belonging to a deeper key
   * that merely shares this key's prefix are excluded.
   */
  async listVersions(key: string): Promise<VersionInfo[]> {
    if (this.native !== undefined) {
      return this.native.list(key);
    }
    const prefix = this.versionPrefix(key);
    const items = await this.driver.list(prefix);
    const versions: VersionInfo[] = [];
    for (const item of items) {
      const versionId = item.key.slice(prefix.length);
      // Skip copies belonging to a deeper key (e.g. Versions of "a/b" when
      // listing Versions of "a"); a direct Version id contains no delimiter.
      if (versionId === "" || versionId.includes("/")) {
        continue;
      }
      const metadata = await this.driver.stat(item.key);
      if (metadata === null) {
        continue;
      }
      versions.push({
        versionId,
        size: metadata.size,
        createdAt: metadata.createdAt,
        checksum: metadata.checksum,
      });
    }
    versions.sort((a, b) => a.createdAt - b.createdAt);
    return versions;
  }

  /**
   * Make the content of the Version identified by `versionId` the current
   * object content for `key` and return the resulting metadata (Requirement
   * 12.3). For the simulated path the reserved copy is read and written back to
   * `key` with its preserved write-time metadata. The overwrite is performed
   * directly against the driver, so restoring does not itself trigger a new
   * snapshot. Throws {@link NotFoundError} when the Version does not exist.
   */
  async restoreVersion(key: string, versionId: string): Promise<StorageObjectMetadata> {
    if (this.native !== undefined) {
      return normalizeMetadata(await this.native.restore(key, versionId));
    }
    const versionKey = this.versionKey(key, versionId);
    const result = await this.driver.get(versionKey);
    if (!result.found) {
      throw new NotFoundError(
        versionKey,
        `Version "${versionId}" for key "${key}" was not found.`,
      );
    }
    const metadata = await this.driver.put(key, result.bytes, toWriteMetadata(result.metadata));
    return normalizeMetadata(metadata);
  }

  /**
   * Remove exactly the Version identified by `versionId` for `key` while
   * retaining the remaining Versions (Requirement 12.4). For the simulated path
   * the reserved copy is deleted; deleting a missing Version is an idempotent
   * no-op at the driver level.
   */
  async deleteVersion(key: string, versionId: string): Promise<void> {
    if (this.native !== undefined) {
      await this.native.deleteVersion(key, versionId);
      return;
    }
    await this.driver.delete(this.versionKey(key, versionId));
  }

  /** The reserved driver key a simulated Version is persisted under. */
  private versionKey(key: string, versionId: string): string {
    return `${this.versionPrefix(key)}${versionId}`;
  }

  /** The reserved driver key prefix that all simulated Versions of `key` share. */
  private versionPrefix(key: string): string {
    return `${VERSION_KEY_PREFIX}${key}/`;
  }
}
