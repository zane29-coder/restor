import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so every module gets `PrismaService` without re-importing it.
 *
 * There is exactly one client (and therefore one connection pool) for the
 * whole process; creating a second would double the pool and lose the tenant
 * scoping extension.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
