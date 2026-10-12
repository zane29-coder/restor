import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type BranchReportRow,
  type DashboardStats,
  type FinanceReport,
  type SalesReport,
  type TopProductRow,
} from '@restor/shared-types';
import { reportQuerySchema, type ReportQueryInput } from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

/**
 * Reporting (TZ §7, §37).
 *
 * Everything is computed from live operational data — there is no reporting
 * store to fall out of step with it.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Headline figures, with change vs the previous period' })
  dashboard(
    @Query(zodBody(reportQuerySchema)) query: ReportQueryInput,
  ): Promise<DashboardStats> {
    return this.reports.dashboard(query);
  }

  @Get('sales')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Revenue by type, source, tender and time' })
  sales(@Query(zodBody(reportQuerySchema)) query: ReportQueryInput): Promise<SalesReport> {
    return this.reports.sales(query, query.granularity);
  }

  /** Ranked by revenue, with an ABC split for kitchen planning. */
  @Get('products')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Top products with ABC classification' })
  products(
    @Query(zodBody(reportQuerySchema)) query: ReportQueryInput,
  ): Promise<TopProductRow[]> {
    return this.reports.products(query, query.limit);
  }

  @Get('branches')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Every branch side by side, with its daily target' })
  branches(
    @Query(zodBody(reportQuerySchema)) query: ReportQueryInput,
  ): Promise<BranchReportRow[]> {
    return this.reports.branches(query);
  }

  /**
   * Cash accountability.
   *
   * Behind its own permission: a shift manager who may read sales has no
   * reason to see every cashier's shortages.
   */
  @Get('finance')
  @RequirePermissions(Permission.FINANCE_VIEW)
  @ApiOperation({ summary: 'Shift totals and every closing discrepancy' })
  finance(@Query(zodBody(reportQuerySchema)) query: ReportQueryInput): Promise<FinanceReport> {
    return this.reports.finance(query);
  }
}
