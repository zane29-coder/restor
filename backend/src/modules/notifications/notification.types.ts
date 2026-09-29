import type { NotificationChannel, TelegramEvent } from '@restor/shared-types';

/** Name of the BullMQ queue notifications are pushed onto. */
export const NOTIFICATION_QUEUE = 'notifications';

/**
 * One delivery attempt's worth of work.
 *
 * Deliberately carries the RENDERED text rather than the raw event: the
 * message is built while the request still has its tenant context, so the
 * worker needs no database access to send it and a schema change cannot break
 * a job that is already queued.
 */
export interface NotificationJob {
  /** Correlates the job with the request that created it. */
  requestId: string | null;
  tenantId: string;
  channel: NotificationChannel;

  /** Chat id, phone, device token or email, depending on the channel. */
  recipient: string;

  /** Forum topic for Telegram; ignored by other channels. */
  topicId?: number | null;

  /** Already escaped and formatted for the channel's parse mode. */
  text: string;

  /** Which template produced `text` — recorded for auditing. */
  template: string;

  /** The event this came from, for grouping in the notifications table. */
  event?: TelegramEvent | string;

  /** Decrypted bot token. Never logged; see the redaction list in AuditService. */
  botToken?: string;

  /** Row in `notifications` to update once the attempt resolves. */
  notificationId?: string;

  /** Links the notification back to what it is about. */
  entity?: { type: string; id: string };

  /**
   * Delivers without a sound or vibration.
   *
   * Used for follow-ups like a status change: a new order should buzz the
   * kitchen's phone, "order 1054 is now READY" should not — especially in a
   * group at 2am.
   */
  silent?: boolean;
}

/** Queue retry policy — see the comment in NotificationsModule. */
export const NOTIFICATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 3_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};
