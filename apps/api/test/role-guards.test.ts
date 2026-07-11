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
  const customersRoutes = readApi("modules/customers/customers.routes.ts");
  const callsRoutes = readApi("modules/calls/calls.routes.ts");
  const aiRoutes = readApi("modules/ai/ai.routes.ts");

  for (const route of [
    "salon-profile",
    "staff",
    "services",
    "business-hours",
    "customers",
    "availability",
    "billing",
    "messages",
    "alerts"
  ]) {
    assert.match(ownerApp, new RegExp(`path="${route}"[\\s\\S]*?RequireRole roles=\\{\\["SALON_OWNER"\\]\\}`));
  }
  assert.match(ownerApp, /path="calls"[\s\S]*?element=\{<Navigate to="\/dashboard" replace \/>\}/);
  assert.match(ownerApp, /path="ai-logs"[\s\S]*?element=\{<Navigate to="\/dashboard" replace \/>\}/);
  assert.match(ownerApp, /path="appointments"[\s\S]*?RequireRole roles=\{\["SALON_OWNER", "STAFF"\]\}/);
  assert.match(ownerApp, /path="my-profile"[\s\S]*?RequireRole roles=\{\["STAFF"\]\}/);

  assert.match(salonRoutes, /salonRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
  assert.match(servicesRoutes, /servicesRouter\.post\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(servicesRoutes, /servicesRouter\.patch\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(servicesRoutes, /servicesRouter\.delete\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(customersRoutes, /customersRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
  assert.match(staffRoutes, /staffRouter\.get\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.post\(\s*"\/",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.patch\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.patch\(\s*"\/:id\/password",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.delete\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.put\(\s*"\/:id\/services",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffRoutes, /staffRouter\.get\(\s*"\/me\/profile",\s*requireRoles\(Role\.STAFF\)/s);
  assert.match(staffRoutes, /staffRouter\.put\(\s*"\/me\/profile",\s*requireRoles\(Role\.STAFF\)/s);
  assert.match(staffRoutes, /phone:\s*usPhoneSchema\.nullable\(\)\.optional\(\)/);
  assert.match(callsRoutes, /callsRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
  assert.match(aiRoutes, /aiRouter\.use\(requireRoles\(Role\.SALON_OWNER\)\)/);
});

test("staff service mapping APIs are owner writable and staff readable", () => {
  const routes = readApi("modules/staff/staff.routes.ts");
  const service = readApi("modules/staff/staff.service.ts");
  const servicesService = readApi("modules/services/services.service.ts");
  const availabilityService = readApi("modules/availability/availability.service.ts");

  assert.match(routes, /"\/me\/services",\s*requireRoles\(Role\.STAFF\)/s);
  assert.match(routes, /"\/:id\/services",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(routes, /serviceIds:\s*z\.array\(z\.string\(\)\.uuid\(\)\)\.default\(\[\]\)/);
  assert.match(routes, /serviceIds:\s*z\.array\(z\.string\(\)\.uuid\(\)\)\.optional\(\)/);
  assert.match(service, /export const getStaffServiceAssignments/);
  assert.match(service, /export const setStaffServiceAssignments/);
  assert.match(service, /export const listStaffSelfServices/);
  assert.match(service, /validateServiceIdsBelongToSalon\(salonId, serviceIds\)/);
  assert.match(service, /replaceStaffServiceMapping\(tx, salonId, staff\.id, serviceIds\)/);
  assert.match(service, /action: "STAFF_SERVICE_MAPPING_UPDATED"/);
  assert.match(service, /One or more service IDs are invalid for this salon\./);
  assert.match(service, /findFirst\(\{\s*where:\s*\{\s*id: staffId,\s*salonId/s);
  assert.match(service, /serviceIds !== undefined[\s\S]*replaceStaffServiceMapping/);
  assert.match(service, /serviceIds:\s*staff\.staffServices\?\.map/);
  assert.match(service, /assignedServices:\s*staff\.staffServices\?\.map/);
  assert.match(service, /staffProfile:\s*\{[\s\S]*salon:\s*\{[\s\S]*timezone: true/s);
  assert.match(servicesService, /export const setServiceStaffMapping/);
  assert.match(servicesService, /action: "SERVICE_STAFF_MAPPING_UPDATED"/);
  assert.match(availabilityService, /ensureStaffCanPerformService/);
  assert.match(availabilityService, /Selected staff is not assigned to this service\./);
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

test("staff can read the owner operator note without owner edit access", () => {
  const salonRoutes = readApi("modules/salon/salon.routes.ts");
  const salonService = readApi("modules/salon/salon.service.ts");
  const dashboard = readRepo("apps/app/src/pages/dashboard-page.tsx");

  const noteRouteIndex = salonRoutes.indexOf('"/staff-note"');
  const ownerGuardIndex = salonRoutes.indexOf("salonRouter.use(requireRoles(Role.SALON_OWNER))");

  assert.notEqual(noteRouteIndex, -1);
  assert.notEqual(ownerGuardIndex, -1);
  assert.ok(noteRouteIndex < ownerGuardIndex);
  assert.match(salonRoutes, /"\/staff-note",\s*requireRoles\(Role\.SALON_OWNER, Role\.STAFF\)/s);
  assert.match(salonRoutes, /"\/operator-note",\s*requireRoles\(Role\.SALON_OWNER, Role\.STAFF\)/s);
  assert.match(salonService, /export const getSalonOperatorNote/);
  assert.match(salonService, /timezone: true/);
  assert.match(salonService, /timezone: salon\.timezone/);
  assert.match(salonService, /callCenterRoutingNote: salon\.settings\?\.callCenterRoutingNote \?\? null/);
  assert.match(dashboard, /apiGet<SalonOperatorNote>\("\/api\/v1\/salon\/staff-note"\)/);
  assert.match(dashboard, /dashboard\.staffOwnerNoteTitle/);
  assert.match(salonService, /type: "salon_owner_note_updated"/);
  assert.match(salonService, /url: "\/dashboard"/);
});

test("notification APIs are authenticated, role-limited, and scoped to current user", () => {
  const app = readApi("app.ts");
  const routes = readApi("modules/notifications/notifications.routes.ts");
  const schemas = readApi("modules/notifications/notifications.schemas.ts");
  const service = readApi("modules/notifications/notifications.service.ts");
  const bell = readRepo("apps/app/src/components/notification-bell.tsx");
  const pushBridge = readRepo("apps/app/src/App.tsx");
  const authContext = readRepo("apps/app/src/auth/auth-context.tsx");

  assert.match(app, /app\.use\(`\$\{PUBLIC_API_PREFIX\}\/notifications`, authenticate, notificationsRouter\)/);
  assert.match(app, /app\.use\(`\$\{PUBLIC_API_PREFIX\}\/devices`, authenticate, devicesRouter\)/);
  for (const role of ["SALON_OWNER", "STAFF", "CALL_CENTER_AGENT"]) {
    assert.match(routes, new RegExp(`"${role}"`));
  }
  assert.doesNotMatch(routes, new RegExp(`"${"OPER"}${"ATOR"}"`));
  assert.doesNotMatch(routes, /"PLATFORM_ADMIN"/);
  for (const endpoint of [
    '"/inbox"',
    '"/unread-count"',
    '"/register-token"',
    '"/register"',
    '"/debug-me"',
    '"/debug-salon"',
    '"/test-user"',
    '"/test-appointment"',
    '"/:id/read"',
    '"/read-all"',
    '"/unregister-token"',
    '"/unregister"',
    '"/fcm-token"',
    '"/fcm-token/unregister"'
  ]) {
    assert.match(routes, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(schemas, /z\.enum\(\["web",\s*"ios",\s*"android"\]/);
  assert.match(schemas, /value\.trim\(\)\.toLowerCase\(\)/);
  assert.match(schemas, /token:\s*input\.fcmToken/);
  assert.match(schemas, /\.strip\(\)/);
  assert.match(routes, /registerPushToken\(\{\s*token: payload\.token,\s*platform: payload\.platform/s);
  assert.match(routes, /unregisterPushToken\(req\.auth!\.userId,\s*payload\.token\)/);
  assert.match(service, /listUserNotificationInbox[\s\S]*where:\s*\{\s*userId: input\.userId\s*\}/);
  assert.match(service, /markUserNotificationRead[\s\S]*id: notificationId,\s*userId/s);
  assert.match(service, /markAllUserNotificationsRead[\s\S]*userId,\s*readAt: null/s);
  assert.match(service, /type:\s*resolvePayloadType\(payload\)/);
  assert.match(service, /payload\.url \? \{ url: payload\.url \}/);
  assert.match(service, /salonId \? \{ salonId \}/);
  assert.match(service, /notificationId/);
  assert.doesNotMatch(routes, /pushToken\.token/);
  assert.match(bell, /resolveNotificationUrl\(notification\)/);
  assert.match(bell, /appointmentId/);
  assert.match(bell, /navigate\(targetUrl\)/);
  assert.match(pushBridge, /window\.dispatchEvent\(new Event\(NOTIFICATIONS_CHANGED_EVENT\)\)/);
  assert.match(pushBridge, /registerFirebaseMessagingToken\(\)/);
  assert.match(authContext, /cleanupPushToken/);
  assert.match(authContext, /unregisterFirebaseMessagingToken\(\{ allowAuthRefresh \}\)/);
});

test("appointment APIs accept salon-local time and prefer it over UTC input", () => {
  const routes = readApi("modules/appointments/appointments.routes.ts");
  const callCenterRoutes = readApi("modules/call-center/call-center.routes.ts");
  const service = readApi("modules/appointments/appointments.service.ts");
  const appointmentsPage = readRepo("apps/app/src/pages/appointments-page.tsx");
  const callCenterPage = readRepo("apps/app/src/pages/call-center-page.tsx");

  for (const source of [routes, callCenterRoutes]) {
    assert.match(source, /startTime:\s*z\.string\(\)\.datetime\(\{ offset: true \}\)\.optional\(\)/);
    assert.match(source, /startTimeLocal:\s*z\.string\(\)\.min\(1\)\.max\(16\)\.optional\(\)/);
    assert.match(source, /payload\.startTime !== undefined \|\| payload\.startTimeLocal !== undefined/);
  }
  assert.ok(
    service.indexOf("if (input.startTimeLocal !== undefined)") <
      service.indexOf("if (input.startTime !== undefined)")
  );
  assert.match(service, /zone:\s*salon\.timezone/);
  assert.match(service, /parsed\.toUTC\(\)\.toJSDate\(\)/);
  assert.match(appointmentsPage, /startTimeLocal:\s*form\.startTime/);
  assert.match(callCenterPage, /startTimeLocal:\s*startTime/);
});

test("API error handler localizes known user-facing errors for Vietnamese clients", () => {
  const handler = readApi("middleware/error-handler.ts");
  const messages = readApi("utils/api-error-messages.ts");

  assert.match(handler, /resolveRequestLanguage\(req\)/);
  assert.match(handler, /localizeApiErrorMessage\(message, code, language\)/);
  assert.match(messages, /STAFF_NOT_MAPPED:\s*"Nhân viên đã chọn chưa được gán dịch vụ này\."/);
  assert.match(messages, /"Requested slot is outside business hours\.":\s*"Khung giờ này nằm ngoài giờ làm việc của tiệm\."/);
  assert.match(messages, /if \(language === "en-US"\)[\s\S]*return message/);
});

test("staff create and reset-access support manual and generated password email flows", () => {
  const routes = readApi("modules/staff/staff.routes.ts");
  const service = readApi("modules/staff/staff.service.ts");
  const mailer = readApi("lib/mailer.ts");

  assert.match(routes, /fullName:\s*z\.string\(\)\.min\(2\)\.max\(120\)\.optional\(\)/);
  assert.match(routes, /firstName:\s*z\.string\(\)\.min\(1\)\.max\(80\)\.optional\(\)/);
  assert.match(routes, /lastName:\s*z\.string\(\)\.min\(1\)\.max\(80\)\.optional\(\)/);
  assert.match(routes, /isActive:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(routes, /createLogin:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(routes, /password:\s*z\.string\(\)\.min\(8\)\.max\(128\)\.optional\(\)/);
  assert.match(routes, /newPassword:\s*z\.string\(\)\.min\(8\)\.max\(128\)\.optional\(\)/);
  assert.match(routes, /sendEmail:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(routes, /staffRouter\.patch\(\s*"\/:id\/password"[\s\S]*resetStaffAccess\(req\.auth!\.salonId!,\s*id,\s*req\.auth!\.userId,\s*payload\)/s);
  assert.match(routes, /staffRouter\.post\(\s*"\/:id\/reset-access"[\s\S]*resetStaffAccess\(req\.auth!\.salonId!,\s*id,\s*req\.auth!\.userId,\s*payload\)/s);
  assert.match(service, /const shouldCreateLogin = input\.createLogin \?\? true/);
  assert.match(service, /const staffIsActive = input\.isActive \?\? true/);
  assert.match(service, /const temporaryPassword = input\.password \?\? generateSecureToken\(6\)/);
  assert.match(service, /const passwordMode: StaffPasswordMode = input\.password \? "MANUAL" : "GENERATED"/);
  assert.match(service, /role:\s*Role\.STAFF/);
  assert.match(service, /const emailSent = await sendStaffInvitationEmail/);
  assert.match(service, /passwordMode:\s*shouldCreateLogin \? passwordMode : undefined/);
  assert.match(service, /if \(existing\.user\)[\s\S]*await tx\.user\.update/);
  assert.match(service, /else[\s\S]*await tx\.user\.create\(\{[\s\S]*role:\s*Role\.STAFF/s);
  assert.match(service, /const \{ password, passwordMode, sendEmail \} = resolveStaffPasswordInput\(input\)/);
  assert.match(service, /passwordMode:\s*requestedPassword \? "MANUAL" : "GENERATED"/);
  assert.match(service, /sendEmail:\s*typeof input === "string" \? true : input\?\.sendEmail !== false/);
  assert.match(service, /const passwordHash = await hashPassword\(password\)/);
  assert.match(service, /sendEmail\s*\?\s*await \([\s\S]*sendStaffPasswordChangedEmail/s);
  assert.match(mailer, /export const sendStaffInvitationEmail[\s\S]*Login email: \$\{input\.toEmail\}/);
  assert.match(mailer, /export const sendStaffPasswordChangedEmail[\s\S]*Login email: \$\{input\.toEmail\}/);
});

test("salon staff title is canonical in owner UI and API", () => {
  const staffService = readApi("modules/staff/staff.service.ts");
  const staffDefaults = readApi("modules/staff/staff-defaults.ts");
  const staffPage = readRepo("apps/app/src/pages/staff-page.tsx");
  const formOptions = readRepo("apps/app/src/lib/form-options.ts");
  const i18n = readRepo("apps/app/src/lib/i18n.tsx");

  assert.match(staffDefaults, /DEFAULT_STAFF_TITLE\s*=\s*"Nail Technician"/);
  assert.match(staffDefaults, /normalizeStaffTitle[\s\S]*DEFAULT_STAFF_TITLE/);
  assert.match(staffService, /title:\s*staffTitle/);
  assert.match(staffService, /title:\s*DEFAULT_STAFF_TITLE/);
  assert.match(staffPage, /title:\s*DEFAULT_STAFF_TITLE/);
  assert.doesNotMatch(staffPage, /getStaffTitleOptions/);
  assert.doesNotMatch(staffPage, /name:\s*"title"[\s\S]*type:\s*"select"/);
  assert.match(formOptions, /getStaffTitleLabel[\s\S]*option\.staffTitle\.nailTechnician/);
  assert.match(i18n, /"option\.staffTitle\.nailTechnician":\s*"Thợ nail"/);
  assert.match(i18n, /"option\.staffTitle\.nailTechnician":\s*"Nail Technician"/);
});

test("admin AI logs include synthetic logs by default and create-salon nav is exclusive", () => {
  const aiLogsPage = readRepo("apps/admin/src/pages/ai-logs-page.tsx");
  const layout = readRepo("apps/admin/src/components/layout.tsx");

  assert.match(aiLogsPage, /const \[includeSynthetic,\s*setIncludeSynthetic\]\s*=\s*useState\(true\)/);
  assert.match(aiLogsPage, /params\.set\("includeSynthetic",\s*"true"\)/);
  assert.match(layout, /normalizedPathname\s*=\s*pathname\.replace\(/);
  assert.match(layout, /target === "\/salons\/new"[\s\S]*normalizedPathname === "\/salons\/new"/);
  assert.match(layout, /target === "\/salons"[\s\S]*normalizedPathname !== "\/salons\/new"/);
});

test("staff and service delete APIs are owner-only and soft-delete history safely", () => {
  const schema = readRepo("apps/api/prisma/schema.prisma");
  const staffRoutes = readApi("modules/staff/staff.routes.ts");
  const staffService = readApi("modules/staff/staff.service.ts");
  const servicesRoutes = readApi("modules/services/services.routes.ts");
  const servicesService = readApi("modules/services/services.service.ts");

  assert.match(schema, /model Staff \{[\s\S]*deletedAt\s+DateTime\?/);
  assert.match(schema, /model Service \{[\s\S]*deletedAt\s+DateTime\?/);
  assert.match(schema, /@@index\(\[salonId, deletedAt\]\)/);

  assert.match(staffRoutes, /staffRouter\.delete\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(staffService, /export const deleteStaff/);
  assert.match(staffService, /export const listStaff[\s\S]*deletedAt:\s*null[\s\S]*includeInactive \? \{\} : \{ status: StaffStatus\.ACTIVE \}/);
  assert.match(staffService, /export const updateStaff[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: staffId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(staffService, /const updateStaffStatus[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: staffId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(staffService, /export const deleteStaff[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: staffId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(staffService, /tx\.staffService\.deleteMany\(\{\s*where:\s*\{\s*salonId,\s*staffId: existing\.id/s);
  assert.match(staffService, /status:\s*StaffStatus\.INACTIVE/);
  assert.match(staffService, /isBookable:\s*false/);
  assert.match(staffService, /deletedAt:\s*new Date\(\)/);
  assert.match(staffService, /isActive:\s*false/);
  assert.match(staffService, /refreshBillingUsageForSalon\(salonId, tx\)/);
  assert.match(staffService, /action:\s*"STAFF_DELETED"/);
  assert.match(staffService, /deleteMode:\s*"SOFT"/);
  assert.match(staffService, /export const setStaffServiceAssignments[\s\S]*deletedAt:\s*null/);
  assert.doesNotMatch(staffService, /appointment\.delete|appointment\.deleteMany/);

  assert.match(servicesRoutes, /servicesRouter\.delete\(\s*"\/:id",\s*requireRoles\(Role\.SALON_OWNER\)/s);
  assert.match(servicesService, /export const deleteService/);
  assert.match(servicesService, /export const listServices[\s\S]*deletedAt:\s*null[\s\S]*includeInactive \? \{\} : \{ isActive: true \}/);
  assert.match(servicesService, /export const updateService[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: serviceId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(servicesService, /export const setServiceActiveState[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: serviceId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(servicesService, /export const deleteService[\s\S]*findFirst\(\{\s*where:\s*\{\s*id: serviceId,\s*salonId,\s*deletedAt:\s*null/s);
  assert.match(servicesService, /tx\.staffService\.deleteMany\(\{\s*where:\s*\{\s*salonId,\s*serviceId: existing\.id/s);
  assert.match(servicesService, /isActive:\s*false/);
  assert.match(servicesService, /deletedAt:\s*new Date\(\)/);
  assert.match(servicesService, /action:\s*"SERVICE_DELETED"/);
  assert.match(servicesService, /deleteMode:\s*"SOFT"/);
  assert.match(servicesService, /export const setServiceStaffMapping[\s\S]*deletedAt:\s*null/);
  assert.doesNotMatch(servicesService, /appointment\.delete|appointment\.deleteMany/);
});

test("Postman collection includes mobile staff password and delete requests", () => {
  const collection = readRepo("FastAIBooking_Postman_Collection.json");

  for (const requestName of [
    "Create Staff - Manual Password",
    "Create Staff - Auto Generated Password",
    "Reset Staff Password - Manual",
    "Reset Staff Password - Auto Generated",
    "Set Staff Password",
    "Delete Staff",
    "Delete Service"
  ]) {
    assert.match(collection, new RegExp(`"name": "${requestName}"`));
  }
});

test("staff invitation and password reset use the unified transactional mailer", () => {
  const envConfig = readApi("config/env.ts");
  const mailer = readApi("lib/mailer.ts");
  const server = readApi("server.ts");

  assert.match(envConfig, /dotenv\.config\(\{\s*path:\s*loadedDotenvPath \?\? dotenvPath,\s*override:\s*process\.env\.NODE_ENV !== "test"\s*\}\)/s);
  assert.match(server, /logger\.info\(`Email provider: \$\{emailConfig\.provider\}`\)/);
  assert.match(server, /logger\.info\(`SMTP host: \$\{emailConfig\.smtpHost \?\? "not configured"\}`\)/);
  assert.match(server, /logger\.info\(`SMTP from: \$\{emailConfig\.smtpFrom \?\? "not configured"\}`\)/);
  assert.match(mailer, /export const sendTransactionalEmail/);
  assert.match(mailer, /provider === "aws" \|\| provider === "aws_ses" \|\| provider === "ses"/);
  assert.match(mailer, /env\.AWS_SES_FROM_EMAIL/);
  assert.match(mailer, /provider:\s*"smtp"/);
  assert.match(mailer, /provider:\s*"demo"/);
  assert.match(mailer, /"SMTP email send failed\."/);
  assert.match(mailer, /missingSmtpKeys:\s*getMissingSmtpKeys\(\)/);
  assert.match(mailer, /export const sendPasswordResetEmail[\s\S]*sendTransactionalEmail\(\{/);
  assert.match(mailer, /reason:\s*"PASSWORD_RESET"/);
  assert.match(mailer, /export const sendStaffInvitationEmail[\s\S]*sendTransactionalEmail\(\{/);
  assert.match(mailer, /reason:\s*"STAFF_INVITATION"/);
  assert.match(mailer, /demoLog:\s*\{[\s\S]*temporaryPassword:\s*input\.temporaryPassword/s);
});

test("call-center agent access is limited to assigned salon workflows", () => {
  const app = readApi("app.ts");
  const routes = readApi("modules/call-center/call-center.routes.ts");
  const service = readApi("modules/call-center/call-center.service.ts");
  const ownerApp = readRepo("apps/app/src/App.tsx");

  assert.match(app, /requireRoles\(Role\.CALL_CENTER_AGENT, Role\.SALON_OWNER\)/);
  assert.match(ownerApp, /path="call-center"[\s\S]*?RequireRole roles=\{\["CALL_CENTER_AGENT"\]\}/);
  assert.match(routes, /listEscalationQueue\(\s*\{\s*userId: req\.auth!\.userId,\s*role: req\.auth!\.role,\s*salonId: req\.auth!\.salonId\s*\}/s);
  assert.match(service, /export const assertCallCenterSalonAccess/);
  assert.match(service, /salonId_agentUserId/);
  assert.match(service, /Salon is not assigned to this call center agent\./);
});

test("owner navigation exposes owner pages and staff navigation exposes profile only", () => {
  const layout = readRepo("apps/app/src/components/layout.tsx");
  const ownerBasicStart = layout.indexOf("const ownerBasicNav = [");
  const ownerNavStart = layout.indexOf("const ownerNav = [");
  const staffNavStart = layout.indexOf("const staffNav = [");
  const callCenterNavStart = layout.indexOf("const callCenterNav = [");

  assert.notEqual(ownerBasicStart, -1);
  assert.notEqual(ownerNavStart, -1);
  assert.notEqual(staffNavStart, -1);
  assert.notEqual(callCenterNavStart, -1);

  const ownerBasicNavBlock = layout.slice(ownerBasicStart, ownerNavStart);
  const ownerNavBlock = layout.slice(ownerNavStart, staffNavStart);
  const staffNavBlock = layout.slice(staffNavStart, callCenterNavStart);

  let lastBasicRouteIndex = -1;
  for (const route of [
    "/dashboard",
    "/appointments",
    "/customers",
    "/services",
    "/staff",
    "/alerts",
    "/salon-profile"
  ]) {
    const routeIndex = ownerBasicNavBlock.indexOf(`to: "${route}"`);
    assert.ok(routeIndex > lastBasicRouteIndex);
    lastBasicRouteIndex = routeIndex;
  }

  for (const route of [
    "/dashboard",
    "/appointments",
    "/customers",
    "/staff",
    "/services",
    "/business-hours",
    "/availability",
    "/salon-profile",
    "/billing",
    "/messages",
    "/alerts"
  ]) {
    assert.match(ownerNavBlock, new RegExp(`to: "${route}"`));
  }
  assert.doesNotMatch(ownerBasicNavBlock, /to: "\/call-center"|to: "\/calls"|to: "\/ai-logs"/);
  assert.doesNotMatch(ownerNavBlock, /to: "\/call-center"|to: "\/calls"|to: "\/ai-logs"/);

  assert.match(staffNavBlock, /to: "\/my-profile"/);
  assert.doesNotMatch(layout, new RegExp(`role === "${"OPER"}${"ATOR"}"`));
});

test("customer page warns instead of blocking active appointment deletion", () => {
  const page = readRepo("apps/app/src/pages/customers-page.tsx");
  const i18n = readRepo("apps/app/src/lib/i18n.tsx");

  assert.doesNotMatch(page, /deleteActiveFutureBlocked/);
  assert.match(page, /activeCount/);
  assert.match(i18n, /Deleting customer data will cancel all active appointments/);
  assert.match(i18n, /Xóa dữ liệu khách hàng sẽ hủy tất cả lịch hẹn đang hoạt động/);
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
