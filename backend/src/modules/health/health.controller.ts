import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

/**
 * Health probes (TZ §60).
 *
 * `/health` is a liveness probe: cheap, no dependencies, answers "is the
 * process up". `/health/ready` is a readiness probe: it touches the database,
 * so an orchestrator stops routing traffic to an instance whose database
 * connection has died rather than serving 500s from it.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptimeSeconds: number; environment: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      environment: this.config.nodeEnv,
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies the database connection' })
  async ready(): Promise<{ status: string; database: string }> {
    const database = await this.prisma.ping();

    if (!database) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Database is not reachable',
      });
    }

    return { status: 'ok', database: 'ok' };
  }
}
