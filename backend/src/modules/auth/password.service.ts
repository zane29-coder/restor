import { Injectable, Logger } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { timingSafeEqual } from 'node:crypto';

/**
 * Password hashing (TZ §52).
 *
 * Argon2id, the current OWASP recommendation: memory-hard, so a stolen
 * database cannot be cracked with GPUs anywhere near as fast as with bcrypt.
 * Parameters follow the OWASP minimum (19 MiB, t=2, p=1), which costs roughly
 * 40 ms per login on typical server hardware — fast enough for a POS sign-in,
 * slow enough to make offline cracking expensive.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // KiB — 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * A precomputed hash used to burn the same CPU time when a login names a
   * user that does not exist. Without it, the response time tells an attacker
   * which phone numbers are registered.
   */
  private dummyHash: string | null = null;

  async hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, ARGON2_OPTIONS);
    } catch (error) {
      // A malformed hash in the database is a data problem, not a valid login.
      this.logger.warn({ err: error }, 'Password verification failed on a malformed hash');
      return false;
    }
  }

  /**
   * Spends the same time as a real verification.
   *
   * Call this on the "user not found" branch so login latency is constant
   * regardless of whether the account exists.
   */
  async verifyDummy(plain: string): Promise<false> {
    this.dummyHash ??= await this.hash('restor-timing-equalizer-placeholder');
    await this.verify(this.dummyHash, plain);
    return false;
  }

  /** Constant-time comparison for opaque tokens and webhook signatures. */
  static safeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}
