import { z } from 'zod';
import { ALL_PERMISSIONS } from '@restor/shared-types';
import { uuidSchema } from './primitives';

/**
 * A permission code must exist in the shared catalog.
 *
 * Validating against `ALL_PERMISSIONS` rather than a loose string means a typo
 * in an admin's custom role is rejected at the edge instead of silently
 * creating a permission nobody ever grants.
 */
export const permissionSchema = z
  .string()
  .refine((code) => (ALL_PERMISSIONS as readonly string[]).includes(code), {
    message: 'Unknown permission code',
  });

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name is too short').max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Code must be UPPER_SNAKE_CASE')
    .optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(permissionSchema).min(1, 'Grant at least one permission'),
});

export const updateRoleSchema = createRoleSchema.partial().omit({ code: true });

export const assignRolesSchema = z.object({
  roleIds: z.array(uuidSchema).min(1, 'Assign at least one role'),
  /** Empty means "every branch of the tenant". */
  branchIds: z.array(uuidSchema).default([]),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
