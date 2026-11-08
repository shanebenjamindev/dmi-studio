// Quản trị (the admin module): /api/admin/* endpoints, one file per module. Who may use each is in shared/permissions.ts.
import type { Router } from '../http';
import { registerStaff } from './staff';
import { registerRoles } from './roles';
import { registerLogs } from './logs';
import { registerWork } from './work';
import { registerCustomers } from './customers';
import { registerServices } from './services';
import { registerNotify } from './notify';
import { registerStats } from './stats';
import { registerSystem } from './system';

export function registerAdmin(api: Router) {
  for (const register of [registerStaff, registerRoles, registerLogs, registerWork, registerCustomers, registerServices, registerNotify, registerStats, registerSystem]) register(api);
}
