import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public, RawResponse } from '../../common/decorators';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Where Telegram delivers bot updates (TZ §14).
 *
 * Its own controller, like `SuboWebhookController`, because it is the one
 * Telegram route with no authentication: Telegram holds no token of ours. What
 * stands in for one is the secret it echoes in
 * `X-Telegram-Bot-Api-Secret-Token`, checked in
 * {@link TelegramBotService.handleUpdate} before anything in the body is read.
 *
 * Mounted under `webhooks/` so nginx's rate-limit exemption for that prefix
 * applies: Telegram retries a failed delivery and then starts backing off, and
 * a burst from a busy lunchtime group must not be answered 429.
 *
 * `@SkipThrottle` does the same for the application's own limiter, which counts
 * per IP — and every update in the world arrives from Telegram's small set of
 * addresses, so one busy restaurant would otherwise rate-limit all of them.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class TelegramWebhookController {
  constructor(private readonly bot: TelegramBotService) {}

  /**
   * The path carries the config id, which is what identifies the bot — see
   * {@link TelegramWebhookService.urlFor}.
   *
   * Always 200 with an empty acknowledgement, except on a bad secret.
   * Telegram retries a non-2xx and eventually drops the webhook, so an update
   * this deployment cannot handle is logged and accepted rather than bounced
   * back forever.
   */
  @Post('telegram/:configId')
  @Public()
  @SkipThrottle()
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Param('configId') configId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    await this.bot.handleUpdate(configId, secret, update);
    return { ok: true };
  }
}
