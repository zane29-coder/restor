import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type StorefrontInfo, type StorefrontSettings } from '@restor/shared-types';
import {
  updateStorefrontSettingsSchema,
  type UpdateStorefrontSettingsInput,
} from '@restor/validation';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { StorefrontSettingsService } from './storefront-settings.service';

/** The restaurant's storefront: what customers see, and how the restaurant sets it. */
@ApiTags('storefront')
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly settings: StorefrontSettingsService) {}

  /**
   * Public: name, colours, contact and the checkout's payment options.
   * Tenant-scoped by the slug, like the public menu.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Storefront info for the restaurant named by X-Tenant-Slug' })
  info(): Promise<StorefrontInfo> {
    return this.settings.publicInfo();
  }

  @Get('settings')
  @RequirePermissions(Permission.SETTINGS_VIEW)
  get(): Promise<StorefrontSettings> {
    return this.settings.get();
  }

  /**
   * Which payment options, cutlery and "leave at the door". Attaching the
   * Subo key itself stays platform-only (`payment_providers.manage`).
   */
  @Patch('settings')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  update(
    @Body(zodBody(updateStorefrontSettingsSchema)) body: UpdateStorefrontSettingsInput,
  ): Promise<StorefrontSettings> {
    return this.settings.update(body);
  }
}
