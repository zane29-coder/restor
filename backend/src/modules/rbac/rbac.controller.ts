import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type PermissionDefinition, type Role } from '@restor/shared-types';
import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller()
export class RbacController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermissions(Permission.ROLES_VIEW)
  @ApiOperation({ summary: 'System roles plus this restaurant’s custom roles' })
  list(): Promise<Role[]> {
    return this.roles.list();
  }

  @Get('roles/:id')
  @RequirePermissions(Permission.ROLES_VIEW)
  get(@Param('id') id: string): Promise<Role> {
    return this.roles.get(id);
  }

  @Post('roles')
  @RequirePermissions(Permission.ROLES_CREATE)
  @ApiOperation({ summary: 'Create a custom role from the permission catalog' })
  create(@Body(zodBody(createRoleSchema)) body: CreateRoleInput): Promise<Role> {
    return this.roles.create(body);
  }

  @Patch('roles/:id')
  @RequirePermissions(Permission.ROLES_UPDATE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateRoleSchema)) body: UpdateRoleInput,
  ): Promise<Role> {
    return this.roles.update(id, body);
  }

  @Delete('roles/:id')
  @RequirePermissions(Permission.ROLES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.roles.remove(id);
  }

  @Get('permissions')
  @RequirePermissions(Permission.PERMISSIONS_VIEW)
  @ApiOperation({ summary: 'The full permission catalog, grouped for the role editor' })
  permissions(): Promise<PermissionDefinition[]> {
    return this.roles.listPermissions();
  }
}
