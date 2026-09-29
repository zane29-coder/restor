import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { StorageProvider as StorageProviderKind } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';
import type { PutObjectParams, StoredObject } from './storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * S3-compatible storage (AWS S3, MinIO, Wasabi, …) for production (TZ §39).
 *
 * Signs requests with SigV4 over the platform `fetch` rather than pulling in
 * the AWS SDK: this service only ever does PUT and DELETE of a single object,
 * and the SDK would add tens of megabytes to the deployment for two calls.
 */
@Injectable()
export class S3StorageProvider extends StorageProvider {
  readonly kind: StorageProviderKind;

  private readonly logger = new Logger(S3StorageProvider.name);

  constructor(private readonly config: AppConfig) {
    super();
    this.kind =
      config.storage.provider === 'MINIO'
        ? StorageProviderKind.MINIO
        : StorageProviderKind.S3;
  }

  async put(params: PutObjectParams): Promise<StoredObject> {
    const response = await this.signedRequest('PUT', params.key, params.body, {
      'content-type': params.mimeType,
      'cache-control': `public, max-age=${params.cacheSeconds ?? 31_536_000}, immutable`,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        { status: response.status, key: params.key, body: body.slice(0, 500) },
        'S3 upload failed',
      );
      throw AppException.internal('Could not store the file');
    }

    return {
      key: params.key,
      url: this.urlFor(params.key),
      sizeBytes: params.body.byteLength,
      mimeType: params.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.signedRequest('DELETE', key, Buffer.alloc(0), {});

    // S3 answers 204 for a delete, and 404 means it is already gone.
    if (!response.ok && response.status !== 404) {
      this.logger.warn({ status: response.status, key }, 'S3 delete failed');
    }
  }

  urlFor(key: string): string {
    const { endpoint, bucket, forcePathStyle } = this.config.storage.s3;
    const base = endpoint.replace(/\/+$/, '');

    // MinIO needs path-style (`host/bucket/key`); real S3 prefers virtual-host.
    if (forcePathStyle) return `${base}/${bucket}/${encodeKey(key)}`;

    const url = new URL(base);
    return `${url.protocol}//${bucket}.${url.host}/${encodeKey(key)}`;
  }

  /** Minimal AWS SigV4 over fetch. */
  private async signedRequest(
    method: 'PUT' | 'DELETE',
    key: string,
    body: Buffer,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const { endpoint, region, bucket, accessKey, secretKey, forcePathStyle } =
      this.config.storage.s3;

    const url = new URL(
      forcePathStyle
        ? `${endpoint.replace(/\/+$/, '')}/${bucket}/${encodeKey(key)}`
        : this.urlFor(key),
    );

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]!.trim()}\n`)
      .join('');
    const signedHeaders = signedHeaderNames.join(';');

    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = deriveSigningKey(secretKey, dateStamp, region);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
    });
  }
}

function deriveSigningKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

/** Percent-encodes each path segment, leaving the separators intact. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
