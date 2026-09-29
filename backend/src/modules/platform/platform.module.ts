import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformController } from './platform.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [PlatformController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class PlatformModule {}
