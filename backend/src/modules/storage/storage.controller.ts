import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type UploadResult } from '@restor/shared-types';
import type { Request } from 'express';
import { RequireAnyPermission } from '../../common/decorators';
import { AppException } from '../../common/errors/app-exception';
import { StorageService } from './storage.service';

/**
 * Image uploads for the menu (TZ §9, §39).
 *
 * Multipart is parsed by hand rather than via multer: this endpoint accepts
 * exactly one small image, and hand-parsing avoids a dependency whose default
 * configuration writes attacker-controlled filenames to disk.
 */
@ApiTags('files')
@Controller('files')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('images')
  @RequireAnyPermission(Permission.PRODUCTS_CREATE, Permission.PRODUCTS_UPDATE, Permission.BRANDING_UPDATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a product or branding image' })
  async uploadImage(@Req() req: RawBodyRequest<Request>): Promise<UploadResult> {
    const file = await readSingleFile(req);
    return this.storage.uploadImage(file);
  }

  @Delete('images/:id')
  @RequireAnyPermission(Permission.PRODUCTS_UPDATE, Permission.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.storage.remove(id);
  }
}

/** Reads one `file` part out of a multipart body. */
async function readSingleFile(req: RawBodyRequest<Request>): Promise<{
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}> {
  const contentType = req.headers['content-type'] ?? '';
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);

  if (!contentType.startsWith('multipart/form-data') || !boundaryMatch) {
    throw AppException.badRequest('Expected a multipart/form-data upload');
  }

  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const body = await collectBody(req);
  const parts = splitBuffer(body, Buffer.from(boundary));

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = part.subarray(0, headerEnd).toString('utf8');
    if (!/name="file"/i.test(headers)) continue;

    const filename = /filename="([^"]*)"/i.exec(headers)?.[1] ?? 'upload';
    const mimeType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? '';

    // Trim the trailing CRLF that precedes the next boundary.
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2);

    return { buffer: content, originalName: filename, mimeType };
  }

  throw AppException.badRequest('No "file" field was present in the upload');
}

function collectBody(req: RawBodyRequest<Request>): Promise<Buffer> {
  // `rawBody: true` in main.ts keeps the untouched bytes for webhook signing;
  // it serves here too.
  if (req.rawBody) return Promise.resolve(Buffer.from(req.rawBody));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function splitBuffer(source: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;

  for (;;) {
    const index = source.indexOf(delimiter, start);
    if (index === -1) break;
    if (index > start) parts.push(source.subarray(start, index));
    start = index + delimiter.length;
  }

  return parts;
}
