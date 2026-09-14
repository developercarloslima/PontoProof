import { Role } from '@prisma/client';

export const MANAGEMENT_ROLES: Role[] = [Role.ADMIN, Role.HR, Role.SUPERVISOR];
export const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.HR];

export function hasRole(role: string, allowed: Role[]) {
  return allowed.includes(role as Role);
}
