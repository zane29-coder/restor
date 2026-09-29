import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { StorageProvider as StorageProviderKind } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';
import type { PutObjectParams, StoredObject } from './storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Disk-backed storage for development and single-server deployments.
 *
 * Files are served by the API itself from `/uploads`. Fine for one instance;
 * anything horizontally scaled needs S3/MinIO, because a file written on one
 * node is invisible to the others.
 */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  readonly kind = StorageProviderKind.LOCAL;

  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;

  constructor(private readonly config: AppConfig) {
    super();
    this.root = resolve(process.cwd(), config.storage.localPath);
  }

  async put(params: PutObjectParams): Promise<StoredObject> {
    const target = this.resolveKey(params.key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, params.body);

    return {
      key: params.key,
      url: this.urlFor(params.key),
      sizeBytes: params.body.byteLength,
      mimeType: params.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      // Already gone is the desired end state, not a failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ err: error, key }, 'Failed to delete a stored file');
      }
    }
  }

  urlFor(key: string): string {
    return `${this.config.apiBaseUrl}/uploads/${key.split(sep).join('/')}`;
  }

  /** Absolute path for the static file handler to serve from. */
  get rootPath(): string {
    return this.root;
  }

  /**
   * Resolves a key to a path INSIDE the storage root.
   *
   * Keys are generated server-side today, but this is the check that stops a
   * future caller-supplied key like `../../.env` from escaping the directory.
   */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, normalize(key)));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw AppException.badRequest('Invalid storage key');
    }

    return target;
  }
}
