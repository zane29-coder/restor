import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Reporting (TZ §7, §37).
 *
 * Read-only and stateless. It owns no tables — every figure is aggregated
 * from orders, payments and shifts on request, so a report cannot disagree
 * with the operations it describes.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
