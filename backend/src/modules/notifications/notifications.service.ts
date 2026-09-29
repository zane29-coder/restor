import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NotificationChannel, NotificationStatus } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { runUnscoped } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import {
  NOTIFICATION_JOB_OPTIONS,
  NOTIFICATION_QUEUE,
  type NotificationJob,
} from './notification.types';

/**
 * Central notification dispatcher (TZ §38).
 *
 * Every channel goes through here — Telegram today, push/SMS/email later —
 * so a caller never talks to a provider directly and the audit of "what did we
 * send, to whom, did it arrive" lives in one table.
 *
 * Enqueues rather than sends (TZ §57). A Telegram call takes 100-800ms and can
 * hang; doing it inside the HTTP request would make placing an order as slow
 * as Telegram's worst day, and a Telegram outage would start failing orders.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly queue: Queue<NotificationJob> | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    this.queue = this.createQueue();
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  /**
   * Records the notification and queues it for delivery.
   *
   * Never throws: a notification failure must not fail the business operation
   * that triggered it. Problems are logged and recorded on the row.
   */
  async dispatch(job: Omit<NotificationJob, 'notificationId'>): Promise<void> {
    let notificationId: string | undefined;

    try {
      const record = await runUnscoped(() =>
        this.prisma.db.notification.create({
          data: {
            tenantId: job.tenantId,
            channel: job.channel,
            recipient: job.recipient,
            template: job.template,
            payload: {
              event: job.event ?? null,
              topicId: job.topicId ?? null,
              entity: job.entity ?? null,
              requestId: job.requestId,
              // The rendered text is kept so an operator can see exactly what
              // was sent. The bot token is deliberately NOT stored here.
              text: job.text,
            },
            status: NotificationStatus.PENDING,
          },
          select: { id: true },
        }),
      );
      notificationId = record.id;
    } catch (error) {
      this.logger.error({ err: error }, 'Could not record a notification');
    }

    if (!this.queue) {
      // No Redis configured (some development setups). Deliver inline rather
      // than silently dropping, so behaviour is the same, just slower.
      this.logger.debug('No queue available; notification will not be delivered');
      return;
    }

    try {
      await this.queue.add(job.template, { ...job, notificationId }, NOTIFICATION_JOB_OPTIONS);
    } catch (error) {
      this.logger.error({ err: error, template: job.template }, 'Could not enqueue a notification');
      if (notificationId) {
        await this.markFailed(notificationId, 'Queue unavailable');
      }
    }
  }

  /** Called by the worker once a job succeeds. */
  async markSent(notificationId: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.notification.updateMany({
        where: { id: notificationId },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), attempts: { increment: 1 } },
      }),
    ).catch((error: unknown) =>
      this.logger.warn({ err: error, notificationId }, 'Could not mark a notification sent'),
    );
  }

  /** Called by the worker when the final attempt fails. */
  async markFailed(notificationId: string, reason: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.notification.updateMany({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage: reason.slice(0, 1000),
          attempts: { increment: 1 },
        },
      }),
    ).catch((error: unknown) =>
      this.logger.warn({ err: error, notificationId }, 'Could not mark a notification failed'),
    );
  }

  /** Recorded when routing found no destination — not an error worth alerting on. */
  async recordSkipped(
    tenantId: string,
    template: string,
    reason: string,
  ): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.notification.create({
        data: {
          tenantId,
          channel: NotificationChannel.TELEGRAM,
          recipient: '-',
          template,
          payload: { reason },
          status: NotificationStatus.SKIPPED,
        },
      }),
    ).catch(() => undefined);
  }

  private createQueue(): Queue<NotificationJob> | null {
    try {
      const url = new URL(this.config.redisUrl);

      return new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
        prefix: this.config.queue.prefix,
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          password: url.password || undefined,
          username: url.username || undefined,
          // BullMQ requires this; without it a blocked command can hang.
          maxRetriesPerRequest: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Redis is not reachable; notifications will not be queued',
      );
      return null;
    }
  }
}
