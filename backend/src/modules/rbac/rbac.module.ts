import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RbacController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RbacModule {}
