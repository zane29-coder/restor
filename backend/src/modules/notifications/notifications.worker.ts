import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { NotificationChannel } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import {
  TelegramApiClient,
  TelegramSendError,
} from '../../integrations/telegram/telegram-api.client';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_QUEUE, type NotificationJob } from './notification.types';

/**
 * Delivers queued notifications (TZ §57).
 *
 * Runs in the same process as the API by default, which is right at this
 * scale: the work is IO-bound and low volume. `QUEUE_WORKERS_ENABLED=false`
 * turns it off so the same image can run as a web-only replica once there is
 * more than one.
 *
 * Retry policy is the interesting part. BullMQ retries on any throw, so the
 * worker has to distinguish:
 *
 *   - "rate limited" / "Telegram is down"  → throw, let it retry with backoff
 *   - "chat not found" / "bot was kicked"  → UnrecoverableError, stop now
 *
 * Without that distinction a deleted group would burn five attempts per
 * message, forever, for every order.
 */
@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsWorker.name);
  private worker: Worker<NotificationJob> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramApiClient,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.queue.workersEnabled) {
      this.logger.log('Notification worker disabled by QUEUE_WORKERS_ENABLED');
      return;
    }

    try {
      const url = new URL(this.config.redisUrl);

      this.worker = new Worker<NotificationJob>(
        NOTIFICATION_QUEUE,
        (job) => this.process(job),
        {
          prefix: this.config.queue.prefix,
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            username: url.username || undefined,
            maxRetriesPerRequest: null,
          },
          // Telegram allows ~30 messages/second to different chats; 5 workers
          // with a per-second limiter stays comfortably under it.
          concurrency: 5,
          limiter: { max: 20, duration: 1_000 },
        },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.warn(
          { jobId: job?.id, attempts: job?.attemptsMade, err: error.message },
          'Notification attempt failed',
        );
      });

      this.worker.on('error', (error) => {
        this.logger.error({ err: error }, 'Notification worker error');
      });

      this.logger.log('Notification worker started');
    } catch (error) {
      this.logger.warn({ err: error }, 'Notification worker could not start');
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Lets in-flight jobs finish rather than re-delivering them on restart.
    await this.worker?.close();
  }

  private async process(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;

    if (data.channel !== NotificationChannel.TELEGRAM) {
      // Push, SMS and email are contract-only for now. Failing loudly beats
      // silently dropping a message someone believes was sent.
      throw new UnrecoverableError(`Channel ${data.channel} is not implemented yet`);
    }

    if (!data.botToken) {
      if (data.notificationId) {
        await this.notifications.markFailed(data.notificationId, 'No bot token configured');
      }
      throw new UnrecoverableError('No bot token configured for this tenant');
    }

    try {
      await this.telegram.sendMessage({
        botToken: data.botToken,
        chatId: data.recipient,
        topicId: data.topicId ?? null,
        text: data.text,
        parseMode: 'HTML',
        disableNotification: data.silent ?? false,
      });

      if (data.notificationId) await this.notifications.markSent(data.notificationId);
    } catch (error) {
      const isLastAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1);

      if (error instanceof TelegramSendError) {
        if (!error.retryable) {
          // The destination is gone or the bot lost access. Record it and stop.
          if (data.notificationId) {
            await this.notifications.markFailed(data.notificationId, error.message);
          }
          throw new UnrecoverableError(error.message);
        }

        // Telegram told us exactly how long to wait; honour it rather than
        // using our own backoff and getting rate limited again.
        if (error.retryAfterSeconds) {
          await job.moveToDelayed(Date.now() + error.retryAfterSeconds * 1_000, job.token);
          return;
        }
      }

      if (isLastAttempt && data.notificationId) {
        await this.notifications.markFailed(
          data.notificationId,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }

      throw error;
    }
  }
}
