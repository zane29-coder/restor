import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  TelegramEvent,
  type TelegramBotStatus,
  type TelegramConfig,
  type TelegramRoute,
} from '@restor/shared-types';
import {
  telegramConfigSchema,
  telegramRouteSchema,
  type TelegramConfigInput,
  type TelegramRouteInput,
} from '@restor/validation';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TelegramService } from './telegram.service';

const testRouteSchema = z.object({
  chatId: z.string().trim().regex(/^-?\d{5,20}$/, 'Chat ID raqamli boʻlishi kerak'),
  topicId: z.number().int().positive().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
});

@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('config')
  @RequirePermissions(Permission.TELEGRAM_VIEW)
  @ApiOperation({ summary: 'Bot configuration; the token is never returned' })
  getConfig(@Query('branchId') branchId?: string): Promise<TelegramConfig | null> {
    return this.telegram.getConfig(branchId);
  }

  /**
   * Platform-only (TZ §6): the bot is registered for the restaurant, not by
   * it, so a tenant admin cannot repoint it at a bot they control. The super
   * admin reaches this through `PUT platform/tenants/:id/telegram`; routing
   * each event to the restaurant's own groups stays with the restaurant.
   */
  @Put('config')
  @RequirePermissions(Permission.TELEGRAM_MANAGE)
  @ApiOperation({ summary: 'Save the bot token and default chat (token is verified)' })
  saveConfig(
    @Body(zodBody(telegramConfigSchema)) body: TelegramConfigInput,
  ): Promise<TelegramConfig> {
    return this.telegram.saveConfig(body);
  }

  /**
   * Whether the bot is actually reachable, not just configured.
   *
   * Read-only, so `telegram.view` is enough: a restaurant admin who cannot
   * change the bot still has to be able to see that it is down, and say so to
   * whoever can.
   */
  @Get('bot/status')
  @RequirePermissions(Permission.TELEGRAM_VIEW)
  @ApiOperation({ summary: 'Is the bot connected, and if not, why' })
  getBotStatus(@Query('branchId') branchId?: string): Promise<TelegramBotStatus> {
    return this.telegram.getBotStatus(branchId);
  }

  /**
   * Re-points the bot at this deployment.
   *
   * Needed when the same token has been used elsewhere — Telegram allows one
   * webhook per bot, so the most recent registration wins and the other side
   * goes quiet without any error anywhere.
   */
  @Post('bot/connect')
  @RequirePermissions(Permission.TELEGRAM_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register this deployment as the bot webhook' })
  connectBot(@Query('branchId') branchId?: string): Promise<TelegramBotStatus> {
    return this.telegram.connectBot(branchId);
  }

  /** The events an admin can route, for the settings screen's dropdown. */
  @Get('events')
  @RequirePermissions(Permission.TELEGRAM_VIEW)
  events(): Array<{ value: string; label: string }> {
    const labels: Record<string, string> = {
      [TelegramEvent.NEW_ORDER]: 'Yangi buyurtma',
      [TelegramEvent.ORDER_ACCEPTED]: 'Buyurtma qabul qilindi',
      [TelegramEvent.ORDER_CANCELLED]: 'Buyurtma bekor qilindi',
      [TelegramEvent.PAYMENT_RECEIVED]: 'Toʻlov qabul qilindi',
      [TelegramEvent.PAYMENT_FAILED]: 'Toʻlov amalga oshmadi',
      [TelegramEvent.KITCHEN_READY]: 'Oshxona: tayyor',
      [TelegramEvent.COURIER_ASSIGNED]: 'Kuryer biriktirildi',
      [TelegramEvent.ORDER_DELIVERED]: 'Yetkazildi',
      [TelegramEvent.DELIVERY_PROBLEM]: 'Yetkazishda muammo',
      [TelegramEvent.WAITER_CALL]: 'Ofitsiant chaqirildi',
      [TelegramEvent.SHIFT_CLOSED]: 'Smena yopildi',
    };

    return Object.values(TelegramEvent).map((value) => ({
      value,
      label: labels[value] ?? value,
    }));
  }

  @Get('routes')
  @RequirePermissions(Permission.TELEGRAM_VIEW)
  @ApiOperation({ summary: 'Event → chat/topic routes' })
  listRoutes(@Query('branchId') branchId?: string): Promise<TelegramRoute[]> {
    return this.telegram.listRoutes(branchId);
  }

  @Put('routes')
  @RequirePermissions(Permission.TELEGRAM_ROUTES_MANAGE)
  upsertRoute(
    @Body(zodBody(telegramRouteSchema)) body: TelegramRouteInput,
  ): Promise<TelegramRoute> {
    return this.telegram.upsertRoute(body);
  }

  @Delete('routes/:id')
  @RequirePermissions(Permission.TELEGRAM_ROUTES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoute(@Param('id') id: string): Promise<void> {
    return this.telegram.deleteRoute(id);
  }

  /**
   * Sends a probe message.
   *
   * Synchronous, unlike real notifications: the admin is watching the button
   * and needs Telegram's actual error, not a queue id.
   */
  @Post('routes/test')
  @RequirePermissions(Permission.TELEGRAM_ROUTES_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test message to verify a chat/topic' })
  testRoute(
    @Body(zodBody(testRouteSchema))
    body: { chatId: string; topicId?: number | null; branchId?: string | null },
  ): Promise<{ ok: boolean; message: string }> {
    return this.telegram.testRoute(body);
  }
}
