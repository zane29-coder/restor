import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../errors/app-exception';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the size GCM is specified for
const AUTH_TAG_LENGTH = 16;
const VERSION = 'v1';

/**
 * Symmetric encryption for secrets stored in the database (TZ §52, §54).
 *
 * Used for tenant Telegram bot tokens and payment-provider keys: those must be
 * readable by the application (to call the API) but must not sit in plaintext
 * in a database backup.
 *
 * AES-256-GCM is authenticated, so a tampered ciphertext fails to decrypt
 * rather than silently yielding garbage. The stored format is
 * `v1:<iv>:<authTag>:<ciphertext>`, all base64 — the version prefix leaves
 * room to rotate the algorithm later without guessing at old rows.
 */
@Injectable()
export class EncryptionService {
  constructor(private readonly config: AppConfig) {}

  get isConfigured(): boolean {
    return this.config.encryptionKey !== null;
  }

  encrypt(plain: string): string {
    const key = this.requireKey();
    return encryptSecret(plain, key);
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    return decryptSecret(payload, key);
  }

  /** Decrypts, returning `null` instead of throwing on a bad or absent value. */
  tryDecrypt(payload: string | null | undefined): string | null {
    if (!payload || !this.isConfigured) return null;
    try {
      return this.decrypt(payload);
    } catch {
      return null;
    }
  }

  private requireKey(): Buffer {
    const key = this.config.encryptionKey;
    if (!key) {
      throw AppException.internal(
        'ENCRYPTION_KEY is not configured; cannot store or read encrypted secrets',
      );
    }
    return key;
  }
}

/* Free functions so seeds and scripts can use them without the Nest container. */

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');

  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
