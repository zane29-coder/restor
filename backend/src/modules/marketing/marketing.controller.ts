import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type CampaignAudience,
  type MarketingCampaign,
  type Paginated,
  type PromoCode,
  type PromoCodeUsage,
  type Promotion,
} from '@restor/shared-types';
import {
  createCampaignSchema,
  createPromoCodeSchema,
  createPromotionSchema,
  paginationSchema,
  type CreateCampaignInput,
  type PaginationOutput,
  promoCodeListQuerySchema,
  promotionListQuerySchema,
  updatePromoCodeSchema,
  updatePromotionSchema,
  type CreatePromoCodeInput,
  type CreatePromotionInput,
  type PromoCodeListQueryInput,
  type PromotionListQueryInput,
  type UpdatePromoCodeInput,
  type UpdatePromotionInput,
} from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CampaignsService } from './campaigns.service';
import { MarketingService } from './marketing.service';

/** Promotions, promo codes and marketing messages (TZ §10, TZ 48 §16.2). */
@ApiTags('marketing')
@Controller()
export class MarketingController {
  constructor(
    private readonly marketing: MarketingService,
    private readonly campaigns: CampaignsService,
  ) {}

  /* ------------------------------ Campaigns ------------------------- */

  @Get('marketing/campaigns')
  @RequirePermissions(Permission.PROMOTIONS_VIEW)
  listCampaigns(
    @Query(zodBody(paginationSchema)) query: PaginationOutput,
  ): Promise<Paginated<MarketingCampaign>> {
    return this.campaigns.list(query);
  }

  /** How many would receive it, and when the next send is allowed. */
  @Get('marketing/campaigns/audience')
  @RequirePermissions(Permission.MARKETING_BROADCAST)
  campaignAudience(): Promise<CampaignAudience> {
    return this.campaigns.audience();
  }

  /** Sends to opted-in customers only, at most once per cooldown window. */
  @Post('marketing/campaigns')
  @RequirePermissions(Permission.MARKETING_BROADCAST)
  @ApiOperation({ summary: 'Send a marketing message to opted-in customers' })
  sendCampaign(
    @Body(zodBody(createCampaignSchema)) body: CreateCampaignInput,
  ): Promise<MarketingCampaign> {
    return this.campaigns.send(body);
  }

  /* ----------------------------- Promotions ------------------------- */

  @Get('promotions')
  @RequirePermissions(Permission.PROMOTIONS_VIEW)
  listPromotions(
    @Query(zodBody(promotionListQuerySchema)) query: PromotionListQueryInput,
  ): Promise<Paginated<Promotion>> {
    return this.marketing.listPromotions(query);
  }

  @Get('promotions/:id')
  @RequirePermissions(Permission.PROMOTIONS_VIEW)
  getPromotion(@Param('id') id: string): Promise<Promotion> {
    return this.marketing.getPromotion(id);
  }

  @Post('promotions')
  @RequirePermissions(Permission.PROMOTIONS_MANAGE)
  @ApiOperation({ summary: 'Create a promotion the pricing engine will apply' })
  createPromotion(
    @Body(zodBody(createPromotionSchema)) body: CreatePromotionInput,
  ): Promise<Promotion> {
    return this.marketing.createPromotion(body);
  }

  @Patch('promotions/:id')
  @RequirePermissions(Permission.PROMOTIONS_MANAGE)
  updatePromotion(
    @Param('id') id: string,
    @Body(zodBody(updatePromotionSchema)) body: UpdatePromotionInput,
  ): Promise<Promotion> {
    return this.marketing.updatePromotion(id, body);
  }

  /** Soft delete: orders priced with it still reference it by name. */
  @Delete('promotions/:id')
  @RequirePermissions(Permission.PROMOTIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePromotion(@Param('id') id: string): Promise<void> {
    return this.marketing.deletePromotion(id);
  }

  /* ----------------------------- Promo codes ------------------------ */

  // Promo codes carry their own permissions, so a marketing assistant can be
  // trusted with campaign codes without being given the promotion engine.
  @Get('promo-codes')
  @RequirePermissions(Permission.PROMO_CODES_VIEW)
  listPromoCodes(
    @Query(zodBody(promoCodeListQuerySchema)) query: PromoCodeListQueryInput,
  ): Promise<Paginated<PromoCode>> {
    return this.marketing.listPromoCodes(query);
  }

  @Get('promo-codes/:id')
  @RequirePermissions(Permission.PROMO_CODES_VIEW)
  getPromoCode(@Param('id') id: string): Promise<PromoCode> {
    return this.marketing.getPromoCode(id);
  }

  /** Who redeemed it and for how much — the campaign's actual result. */
  @Get('promo-codes/:id/usages')
  @RequirePermissions(Permission.PROMO_CODES_VIEW)
  listUsages(
    @Param('id') id: string,
    @Query() query: { page?: number; limit?: number },
  ): Promise<Paginated<PromoCodeUsage>> {
    return this.marketing.listUsages(id, query);
  }

  @Post('promo-codes')
  @RequirePermissions(Permission.PROMO_CODES_MANAGE)
  createPromoCode(
    @Body(zodBody(createPromoCodeSchema)) body: CreatePromoCodeInput,
  ): Promise<PromoCode> {
    return this.marketing.createPromoCode(body);
  }

  /**
   * Note what cannot be patched: the code itself.
   *
   * Customers already have it on a poster or in a message, and renaming a live
   * code silently breaks every one of them.
   */
  @Patch('promo-codes/:id')
  @RequirePermissions(Permission.PROMO_CODES_MANAGE)
  updatePromoCode(
    @Param('id') id: string,
    @Body(zodBody(updatePromoCodeSchema)) body: UpdatePromoCodeInput,
  ): Promise<PromoCode> {
    return this.marketing.updatePromoCode(id, body);
  }

  @Delete('promo-codes/:id')
  @RequirePermissions(Permission.PROMO_CODES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePromoCode(@Param('id') id: string): Promise<void> {
    return this.marketing.deletePromoCode(id);
  }
}
