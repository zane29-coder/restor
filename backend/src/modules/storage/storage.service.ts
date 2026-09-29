import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type UploadResult } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { StorageProvider } from './storage.provider';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

/**
 * Image types the catalog accepts.
 *
 * An allowlist, not a denylist: anything not on this list is refused, so a
 * future format cannot sneak an executable past a "not .exe" check. SVG is
 * deliberately absent — it can carry script and would execute in the browser
 * when served from our origin.
 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Magic bytes, checked against the declared MIME type. */
const MAGIC_BYTES: Array<{ mime: string; test: (buffer: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/avif',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
];

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly provider: StorageProvider,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Stores an image and records it in `files`.
   *
   * The declared content type is never trusted on its own: a renamed `.php`
   * arriving as `image/png` is caught by the magic-byte check below.
   */
  async uploadImage(input: UploadInput): Promise<UploadResult> {
    this.assertSize(input.buffer);

    const mimeType = this.detectImageType(input.buffer, input.mimeType);
    const extension = ALLOWED_IMAGE_TYPES[mimeType]!;

    const ctx = getContext();
    const tenantSegment = ctx?.tenantId ?? 'platform';
    // Random name, never the user's: the original could collide or contain a
    // path traversal attempt.
    const key = `images/${tenantSegment}/${randomUUID()}.${extension}`;

    const stored = await this.provider.put({ key, body: input.buffer, mimeType });

    const record = await this.prisma.db.fileAsset.create({
      data: {
        provider: this.provider.kind,
        key: stored.key,
        url: stored.url,
        originalName: input.originalName.slice(0, 255),
        mimeType,
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: ctx?.userId ?? null,
      },
    });

    return {
      id: record.id,
      url: record.url,
      key: record.key,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
    };
  }

  /** Removes a file and its record. Safe to call for an id that is already gone. */
  async remove(id: string): Promise<void> {
    const record = await this.prisma.db.fileAsset.findFirst({ where: { id } });
    if (!record) return;

    await this.provider.delete(record.key);
    await this.prisma.db.fileAsset.delete({ where: { id } });
  }

  private assertSize(buffer: Buffer): void {
    const max = this.config.storage.maxFileSizeBytes;
    if (buffer.byteLength > max) {
      throw new AppException(
        ErrorCode.FILE_TOO_LARGE,
        `The file exceeds the ${Math.round(max / (1024 * 1024))} MB limit`,
        413,
      );
    }
    if (buffer.byteLength === 0) {
      throw AppException.badRequest('The uploaded file is empty');
    }
  }

  /** Returns the real MIME type, or throws when it is not an allowed image. */
  private detectImageType(buffer: Buffer, declared: string): string {
    const detected = MAGIC_BYTES.find((entry) => entry.test(buffer))?.mime;

    if (!detected || !ALLOWED_IMAGE_TYPES[detected]) {
      throw new AppException(
        ErrorCode.UNSUPPORTED_FILE_TYPE,
        'Only JPEG, PNG, WebP and AVIF images are accepted',
        415,
      );
    }

    if (declared && declared !== detected) {
      this.logger.warn(
        { declared, detected },
        'Upload content type did not match its magic bytes; trusting the bytes',
      );
    }

    return detected;
  }
}
