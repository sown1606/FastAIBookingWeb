import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "../..");

const readApi = (relativePath: string) =>
  readFileSync(path.join(apiRoot, "src", relativePath), "utf8");

const readRepo = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

test("staff appointment routes are scoped to assigned appointments only", () => {
  const routes = readApi("modules/appointments/appointments.routes.ts");
  const service = readApi("modules/appointments/appointments.service.ts");

  assert.match(routes, /restrictedStaffId\s*=\s*req\.auth!\.role\s*===\s*Role\.STAFF/);
  assert.match(routes, /assertStaffOwnsAppointment\(req\.auth!\.salonId!, id, req\.auth!\.staffId\)/);
  assert.match(routes, /Staff can only update status or notes on assigned appointments\./);
  assert.match(routes, /appointmentsRouter\.post\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(service, /assertStaffCanOperateAppointment\(existing, actorStaffId\)/);
});

test("staff cannot access owner-only app pages or owner-only API actions", () => {
  const ownerApp = readRepo("apps/app/src/App.tsx");
  const salonRoutes = readApi("modules/salon/salon.routes.ts");
  const servicesRoutes = readApi("modules/services/services.routes.ts");
  const staffRoutes = readApi("modules/staff/staff.routes.ts");
  const callsRoutes = readApi("modules/calls/calls.routes.ts");
  const aiRoutes = readApi("modules/ai/ai.routes.ts");

  for (const route of [
    "salon-profile",
    "staff",
    "services",
    "business-hours",
    "customers",
    "billing",
    "calls",
    "ai-logs"
  ]) {
    assert.match(ownerApp, new RegExp(`path="${route}"[\\s\\S]*?RequireRole roles=\\{\\["SALON_OWNER"\\]\\}`));
  }

  assert.match(salonRoutes, /salonRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
  assert.match(servicesRoutes, /servicesRouter\.post\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(servicesRoutes, /servicesRouter\.patch\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.get\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.post\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.patch\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(callsRoutes, /callsRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
  assert.match(aiRoutes, /aiRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
});

test("owner workspace routes keep salon data scoped to the authenticated salon", () => {
  const app = readApi("app.ts");
  const ownerRoutes = readApi("modules/owner/owner.routes.ts");
  const salonRoutes = readApi("modules/salon/salon.routes.ts");
  const appointmentsRoutes = readApi("modules/appointments/appointments.routes.ts");
  const callsRoutes = readApi("modules/calls/calls.routes.ts");

  assert.match(app, /app\.use\(authenticate, requireRoles\(Role\.SALON_OWNER, Role\.STAFF\), requireSalonAccess\)/);
  assert.match(ownerRoutes, /assertOwnerSalonAccess\(req\.auth\?\.salonId, salonId\)/);
  assert.match(salonRoutes, /getSalonProfile\(req\.auth!\.salonId!\)/);
  assert.match(appointmentsRoutes, /listAppointments\(req\.auth!\.salonId!,/);
  assert.match(callsRoutes, /listCalls\(req\.auth!\.salonId!, query\)/);
});

test("operator call-center access is limited to assigned salon workflows", () => {
  const app = readApi("app.ts");
  const routes = readApi("modules/call-center/call-center.routes.ts");
  const service = readApi("modules/call-center/call-center.service.ts");
  const ownerApp = readRepo("apps/app/src/App.tsx");

  assert.match(app, /requireRoles\(Role\.CALL_CENTER_AGENT, Role\.SALON_OWNER\)/);
  assert.match(ownerApp, /path="call-center"[\s\S]*?RequireRole roles=\{\["SALON_OWNER", "CALL_CENTER_AGENT"\]\}/);
  assert.match(routes, /listEscalationQueue\(\s*\{\s*userId: req\.auth!\.userId,\s*role: req\.auth!\.role,\s*salonId: req\.auth!\.salonId\s*\}/s);
  assert.match(service, /export const assertCallCenterSalonAccess/);
  assert.match(service, /salonId_agentUserId/);
  assert.match(service, /Salon is not assigned to this call center agent\./);
});

test("platform admin routes require PLATFORM_ADMIN and admin dashboard guard enforces it", () => {
  const adminRoutes = readApi("modules/admin/admin.routes.ts");
  const adminGuard = readRepo("apps/admin/src/components/guards.tsx");

  assert.match(adminRoutes, /adminRouter\.use\(authenticate, requireRoles\(Role\.PLATFORM_ADMIN\)\)/);
  assert.match(adminGuard, /session\.user\.role !== "PLATFORM_ADMIN"/);
});

test("cross-salon data leak prevention is wired through route and service contracts", () => {
  const auth = readApi("middleware/auth.ts");
  const callCenterService = readApi("modules/call-center/call-center.service.ts");
  const callsService = readApi("modules/calls/calls.service.ts");
  const aiService = readApi("modules/ai/ai.service.ts");

  assert.match(auth, /if \(!req\.auth\?\.salonId\)/);
  assert.match(callCenterService, /actor\.salonId !== salonId/);
  assert.match(callCenterService, /prisma\.callCenterSalonAssignment\.findUnique/);
  assert.match(callsService, /where:\s*\{\s*id: callSessionId,\s*salonId/s);
  assert.match(aiService, /salonId: input\.salonId/);
});
