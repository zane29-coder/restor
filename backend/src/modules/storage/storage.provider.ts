import type { StorageProvider as StorageProviderKind } from '@restor/shared-types';

export interface StoredObject {
  /** Key relative to the bucket or storage root. */
  key: string;
  /** Publicly reachable URL. */
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PutObjectParams {
  key: string;
  body: Buffer;
  mimeType: string;
  /** Hints the CDN how long it may cache; images are content-addressed. */
  cacheSeconds?: number;
}

/**
 * Storage abstraction (TZ §39).
 *
 * Product images must not be welded to a local folder: development uses disk,
 * production uses S3 or MinIO, and swapping between them must not touch a
 * single line of the catalog service.
 */
export abstract class StorageProvider {
  abstract readonly kind: StorageProviderKind;

  abstract put(params: PutObjectParams): Promise<StoredObject>;

  abstract delete(key: string): Promise<void>;

  /** Absolute URL for a stored key. */
  abstract urlFor(key: string): string;
}
