import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@restor/shared-types';
import { RequirePermissions } from '../../common/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Tenant-scoped automatically: an admin sees only their own company's log. */
  @Get()
  @RequirePermissions(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: 'Browse the audit trail' })
  list(
    @Query()
    query: {
      page?: number;
      limit?: number;
      userId?: string;
      action?: string;
      entity?: string;
      entityId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.audit.list(query);
  }
}
