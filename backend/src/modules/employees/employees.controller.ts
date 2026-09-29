import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type Employee, type Paginated, type User } from '@restor/shared-types';
import {
  assignRolesSchema,
  createUserSchema,
  passwordSchema,
  updateUserSchema,
  type AssignRolesInput,
  type CreateUserInput,
  type UpdateUserInput,
} from '@restor/validation';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { EmployeesService } from './employees.service';

const resetPasswordSchema = z.object({ newPassword: passwordSchema });

@ApiTags('employees')
@Controller()
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('employees')
  @RequirePermissions(Permission.EMPLOYEES_VIEW)
  @ApiOperation({ summary: 'List staff' })
  list(
    @Query()
    query: {
      page?: number;
      limit?: number;
      branchId?: string;
      roleId?: string;
      isActive?: boolean;
      search?: string;
    },
  ): Promise<Paginated<Employee>> {
    return this.employees.list(query);
  }

  @Get('employees/:id')
  @RequirePermissions(Permission.EMPLOYEES_VIEW)
  get(@Param('id') id: string): Promise<Employee> {
    return this.employees.get(id);
  }

  @Post('employees')
  @RequirePermissions(Permission.EMPLOYEES_CREATE)
  @ApiOperation({ summary: 'Create a staff account with roles and branch scope' })
  create(@Body(zodBody(createUserSchema)) body: CreateUserInput): Promise<Employee> {
    return this.employees.create(body);
  }

  @Patch('employees/:id')
  @RequirePermissions(Permission.EMPLOYEES_UPDATE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateUserSchema)) body: UpdateUserInput,
  ): Promise<Employee> {
    return this.employees.update(id, body);
  }

  @Post('employees/:id/deactivate')
  @RequirePermissions(Permission.EMPLOYEES_DELETE)
  @ApiOperation({ summary: 'Deactivate a staff account (history is preserved)' })
  deactivate(@Param('id') id: string): Promise<Employee> {
    return this.employees.deactivate(id);
  }

  @Post('employees/:id/reset-password')
  @RequirePermissions(Permission.EMPLOYEES_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('id') id: string,
    @Body(zodBody(resetPasswordSchema)) body: { newPassword: string },
  ): Promise<void> {
    await this.employees.resetPassword(id, body.newPassword);
  }

  @Post('users/:id/roles')
  @RequirePermissions(Permission.PERMISSIONS_ASSIGN)
  @ApiOperation({ summary: 'Replace a user’s roles and branch scope' })
  assignRoles(
    @Param('id') userId: string,
    @Body(zodBody(assignRolesSchema)) body: AssignRolesInput,
  ): Promise<User> {
    return this.employees.assignRoles(userId, body);
  }
}
