import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), "utf8");

test("alerts UI maps known types and does not render raw alert fields as fallback", () => {
  const source = readRepoFile("apps/app/src/pages/alerts-page.tsx");

  assert.match(source, /knownAlertConfig/);
  assert.match(source, /alerts\.systemTitle/);
  assert.doesNotMatch(source, /label:\s*alert\.alertType/);
  assert.doesNotMatch(source, /title:\s*alert\.title/);
  assert.doesNotMatch(source, /message:\s*alert\.message/);
  assert.doesNotMatch(source, /Human escalation created/);
  assert.doesNotMatch(source, /Caller pressed zero for operator/);
});

test("dashboard uses server-side appointment summary for operational today count", () => {
  const source = readRepoFile("apps/app/src/pages/dashboard-page.tsx");

  assert.match(source, /\/api\/v1\/appointments\/summary/);
  assert.match(source, /todaySummary\.operationalCount/);
  assert.doesNotMatch(source, /todayAppointments\.length/);
});

test("admin salon list uses shared delete dialog and preview endpoint", () => {
  const listSource = readRepoFile("apps/admin/src/pages/salons-page.tsx");
  const helperSource = readRepoFile("apps/admin/src/lib/salon-delete.ts");

  assert.match(listSource, /openSalonDeleteDialog/);
  assert.match(listSource, /deletingSalonId/);
  assert.match(helperSource, /delete-preview/);
  assert.match(helperSource, /confirmPermanentDelete/);
});

test("admin call detail copy and download share sanitized debug payload", () => {
  const source = readRepoFile("apps/admin/src/pages/call-detail-page.tsx");
  const debugSource = readRepoFile("apps/admin/src/lib/debug-export.ts");
  const downloadSource = readRepoFile("apps/admin/src/lib/download-json.ts");
  const clipboardSource = readRepoFile("apps/admin/src/lib/clipboard.ts");
  const i18nSource = readRepoFile("apps/admin/src/lib/i18n.tsx");

  assert.match(debugSource, /export const buildCallDebugPayload/);
  assert.match(source, /const payload = buildCallDebugPayload\(call,\s*exportedAt\)/);
  assert.match(source, /downloadJsonFile\(filename,\s*payload\)/);
  assert.match(source, /copyTextToClipboard\(stringifyDebugJson\(payload\)\)/);
  assert.match(clipboardSource, /navigator\.clipboard\?\.writeText/);
  assert.match(clipboardSource, /document\.execCommand\("copy"\)/);
  assert.match(downloadSource, /isSensitiveKey\(key\) \? "\[REDACTED\]"/);
  for (const key of [
    "authorization",
    "cookie",
    "set-cookie",
    "accesstoken",
    "refreshtoken",
    "apikey",
    "secret",
    "password",
    "sessiontoken",
    "privatekey",
    "clientsecret"
  ]) {
    assert.match(downloadSource, new RegExp(`"${key.replace("-", "")}"`));
  }
  assert.match(source, /calls\.copyDebugJson/);
  assert.match(source, /calls\.debugJsonCopied/);
  assert.match(i18nSource, /"calls\.copyDebugJson": "Copy debug JSON"/);
  assert.match(i18nSource, /"calls\.debugJsonCopied": "Debug JSON copied"/);
});

test("admin debug list pages support multi-select bulk debug export", () => {
  const callsSource = readRepoFile("apps/admin/src/pages/calls-page.tsx");
  const aiLogsSource = readRepoFile("apps/admin/src/pages/ai-logs-page.tsx");
  const hookSource = readRepoFile("apps/admin/src/lib/use-row-selection.ts");
  const bulkActionsSource = readRepoFile("apps/admin/src/components/debug-bulk-actions.tsx");
  const debugSource = readRepoFile("apps/admin/src/lib/debug-export.ts");
  const downloadSource = readRepoFile("apps/admin/src/lib/download-json.ts");

  for (const source of [callsSource, aiLogsSource]) {
    assert.match(source, /useRowSelection\(visibleIds\)/);
    assert.match(source, /selectAllRef\.current\.indeterminate/);
    assert.match(source, /DebugBulkActions/);
    assert.match(source, /copySelectedDebug/);
    assert.match(source, /exportSelectedDebug/);
    assert.match(source, /copyTextToClipboard\(prepared\.json\)/);
    assert.match(source, /downloadPreparedJson\(filename,\s*prepared\.json\)/);
    assert.match(source, /stringifyServerDebugBundle\(payload\)/);
    assert.match(source, /getJsonByteSize\(json\)/);
    assert.match(source, /timeout:\s*DEBUG_EXPORT_TIMEOUT_MS/);
    assert.match(source, /type DebugExportMode = "compact" \| "gpt"/);
    assert.match(source, /mode,\s*payload,\s*json,/);
    assert.match(source, /prepareSelectedDebugBundle\("gpt"\)/);
    assert.match(source, /mode:\s*"full"/);
    assert.match(source, /apiPostBlob/);
    assert.match(source, /download=true/);
    assert.match(source, /event\.nativeEvent instanceof MouseEvent && event\.nativeEvent\.shiftKey/);
    assert.match(source, /buildBulkDebugBundle/);
    assert.match(source, /className="row-checkbox"/);
    assert.match(source, /aria-label=\{t\("debugBulk\.selectAllVisible"\)\}/);
  }

  assert.match(callsSource, /\/api\/v1\/admin\/calls\/debug-export/);
  assert.match(callsSource, /sourcePage: "call_logs"/);
  assert.match(callsSource, /fastaibooking-call-debug-\$\{prepared\.response\.recordCount\}-records/);
  assert.match(aiLogsSource, /groupAiLogsByCall/);
  assert.match(aiLogsSource, /groupedItems\.map\(\(group\) => group\.latest\.id\)/);
  assert.match(aiLogsSource, /\/api\/v1\/admin\/ai-logs\/debug-export/);
  assert.match(aiLogsSource, /sourcePage: "ai_logs"/);
  assert.match(aiLogsSource, /fastaibooking-ai-debug-\$\{prepared\.response\.recordCount\}-calls/);
  assert.match(hookSource, /selectedIds/);
  assert.match(hookSource, /anchorId/);
  assert.match(hookSource, /getVisibleRangeIds/);
  assert.match(hookSource, /options\.shiftKey/);
  assert.match(hookSource, /toggleOne/);
  assert.match(hookSource, /selectAllVisible/);
  assert.match(hookSource, /clearAll/);
  assert.match(hookSource, /allVisibleSelected/);
  assert.match(hookSource, /someVisibleSelected/);
  assert.match(hookSource, /reconcileVisibleIds/);
  assert.match(bulkActionsSource, /debugBulk\.copyCompactJson/);
  assert.match(bulkActionsSource, /debugBulk\.exportCompactJson/);
  assert.match(bulkActionsSource, /debugBulk\.selectAllVisible/);
  assert.match(bulkActionsSource, /debugBulk\.shiftHint/);
  assert.match(debugSource, /sanitizeDebugJsonValue/);
  assert.match(downloadSource, /stringifyJsonExport/);
  assert.match(downloadSource, /downloadPreparedJson/);
  assert.match(downloadSource, /downloadBlobFile/);
});

test("admin row selection hook supports Shift-click visible range behavior", () => {
  const hookSource = readRepoFile("apps/admin/src/lib/use-row-selection.ts");
  const aiLogsSource = readRepoFile("apps/admin/src/pages/ai-logs-page.tsx");

  assert.match(hookSource, /const anchorIndex = visibleIds\.indexOf\(anchorId\)/);
  assert.match(hookSource, /const targetIndex = visibleIds\.indexOf\(targetId\)/);
  assert.match(hookSource, /visibleIds\.slice\(start,\s*end \+ 1\)/);
  assert.match(hookSource, /rangeIds\.forEach\(\(rangeId\) => next\.add\(rangeId\)\)/);
  assert.match(hookSource, /setAnchorId\(id\)/);
  assert.match(hookSource, /setAnchorId\(\(current\) => \(current && nextVisibleIdSet\.has\(current\) \? current : null\)\)/);
  assert.match(hookSource, /setAnchorId\(null\)/);
  assert.match(hookSource, /visibleIdSet\.has\(id\)/);
  assert.match(hookSource, /visibleIds\.every\(\(id\) => current\.has\(id\)\)/);
  assert.match(aiLogsSource, /groupedItems\.map\(\(group\) => group\.latest\.id\)/);
});

test("owner Basic UI exposes and validates Business Hours", () => {
  const layoutSource = readRepoFile("apps/app/src/components/layout.tsx");
  const dashboardSource = readRepoFile("apps/app/src/pages/dashboard-page.tsx");
  const settingsSource = readRepoFile("apps/app/src/pages/salon-profile-page.tsx");
  const hoursSource = readRepoFile("apps/app/src/pages/business-hours-page.tsx");
  const i18nSource = readRepoFile("apps/app/src/lib/i18n.tsx");

  assert.match(layoutSource, /const ownerBasicNav = \[[\s\S]*to: "\/business-hours"/);
  assert.match(dashboardSource, /isBasicMode \? <Link to="\/business-hours">/);
  assert.match(settingsSource, /<Link to="\/business-hours" className="button-secondary">/);
  assert.match(hoursSource, /apiGet<BusinessHour\[]>\("\/api\/v1\/business-hours"\)/);
  assert.match(hoursSource, /apiPut<BusinessHour\[], \{ hours: BusinessHour\[] \}>\("\/api\/v1\/business-hours"/);
  assert.match(hoursSource, /item\.isOpen \? item\.openTime : null/);
  assert.match(hoursSource, /item\.isOpen \? item\.closeTime : null/);
  assert.match(hoursSource, /invalidDay/);
  assert.match(hoursSource, /hours\.invalidRange/);
  assert.match(hoursSource, /disabled=\{!item\.isOpen \|\| saving\}/);
  assert.match(hoursSource, /disabled=\{saving\}/);
  assert.match(hoursSource, /common\.saving/);
  assert.match(hoursSource, /weekday\.\$\{item\.dayOfWeek\}/);
  assert.match(i18nSource, /"nav\.businessHours": "Business hours"/);
  assert.match(i18nSource, /"nav\.businessHours": "Giờ làm việc"/);
  assert.match(i18nSource, /"hours\.invalidRange"/);
});

test("admin log pages show Smoke Tests by default and allow hiding them", () => {
  const callsSource = readRepoFile("apps/admin/src/pages/calls-page.tsx");
  const aiLogsSource = readRepoFile("apps/admin/src/pages/ai-logs-page.tsx");
  const i18nSource = readRepoFile("apps/admin/src/lib/i18n.tsx");
  const routesSource = readRepoFile("apps/api/src/modules/admin/admin.routes.ts");
  const callsServiceSource = readRepoFile("apps/api/src/modules/calls/calls.service.ts");

  assert.match(callsSource, /const \[includeSynthetic, setIncludeSynthetic\] = useState\(true\)/);
  assert.match(aiLogsSource, /const \[includeSynthetic, setIncludeSynthetic\] = useState\(true\)/);
  assert.match(callsSource, /params\.set\("includeSynthetic", String\(includeSynthetic\)\)/);
  assert.match(aiLogsSource, /params\.set\("includeSynthetic", String\(includeSynthetic\)\)/);
  assert.match(callsSource, /calls\.includeSynthetic/);
  assert.match(aiLogsSource, /aiLogs\.includeSynthetic/);
  assert.match(callsSource, /calls\.synthetic/);
  assert.match(aiLogsSource, /aiLogs\.synthetic/);
  assert.match(i18nSource, /"calls\.includeSynthetic": "Show Smoke Tests"/);
  assert.match(i18nSource, /"aiLogs\.includeSynthetic": "Show Smoke Tests"/);
  assert.match(routesSource, /includeSynthetic: z\.coerce\.boolean\(\)\.default\(true\)/);
  assert.match(callsServiceSource, /providerCallId:\s*\{\s*startsWith: "codex-"/);
  assert.match(callsServiceSource, /rawPayload:\s*\{\s*path: \["metadata", "isSynthetic"\]/);
});

test("admin API exposes authenticated bulk debug endpoints with server-side sanitization", () => {
  const routesSource = readRepoFile("apps/api/src/modules/admin/admin.routes.ts");
  const serviceSource = readRepoFile("apps/api/src/modules/admin/admin-debug-export.service.ts");
  const aiServiceSource = readRepoFile("apps/api/src/modules/ai/ai.service.ts");

  assert.match(routesSource, /adminRouter\.use\(authenticate, requireRoles\(Role\.PLATFORM_ADMIN\)\)/);
  assert.match(routesSource, /"\/calls\/debug-export"/);
  assert.match(routesSource, /"\/ai-logs\/debug-export"/);
  assert.match(routesSource, /ids:\s*z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(50\)/);
  assert.match(routesSource, /mode:\s*z\.enum\(\["compact", "full", "gpt"\]\)\.default\("compact"\)/);
  assert.match(routesSource, /req\.query\.download === "true"/);
  assert.match(routesSource, /Content-Disposition/);
  assert.match(routesSource, /X-Debug-Export-Mode/);
  assert.match(serviceSource, /getCallsDebugExportForAdmin/);
  assert.match(serviceSource, /getAIInteractionsDebugExportForAdmin/);
  assert.match(serviceSource, /exportType: "multi_call_debug"/);
  assert.match(serviceSource, /exportType: "multi_ai_call_debug"/);
  assert.match(serviceSource, /schemaVersion: 2/);
  assert.match(serviceSource, /call_debug_compact/);
  assert.match(serviceSource, /OMITTED_DUPLICATE_FIELDS/);
  assert.match(serviceSource, /pruneResponsePayloadForExport/);
  assert.match(serviceSource, /responsePayload\.turnHistory/);
  assert.match(serviceSource, /deduplicatedCount/);
  assert.match(serviceSource, /notFoundIds/);
  assert.match(serviceSource, /serializationDurationMs/);
  assert.match(serviceSource, /responseBytes/);
  assert.match(serviceSource, /SENSITIVE_DEBUG_KEY_PARTS/);
  assert.match(serviceSource, /"\[REDACTED\]"/);
  assert.match(serviceSource, /callSession\.findMany/);
  assert.match(serviceSource, /aiInteractionLog\.findMany/);
  assert.match(aiServiceSource, /export const buildAdminDebugTimelineItems/);
  assert.match(aiServiceSource, /export const buildAIInteractionCallDebugForAdminPayload/);
  assert.match(aiServiceSource, /turnHistories/);
});

test("edge nginx config enables gzip for API JSON responses", () => {
  const plainConfig = readRepoFile("infra/nginx/default.conf");
  const sslConfig = readRepoFile("infra/nginx/default-ssl.conf");

  for (const source of [plainConfig, sslConfig]) {
    assert.match(source, /server_name api-new-nail\.kendemo\.com/);
    assert.match(source, /gzip on;/);
    assert.match(source, /gzip_comp_level 5;/);
    assert.match(source, /gzip_min_length 1024;/);
    assert.match(source, /gzip_types application\/json application\/problem\+json text\/plain;/);
  }
});

test("call-center CCP is embedded-first with collapsed technical details", () => {
  const source = readRepoFile("apps/app/src/pages/call-center-page.tsx");

  assert.match(source, /VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED !== "false"/);
  assert.match(source, /\.core\.initCCP/);
  assert.match(source, /loginPopup:\s*false/);
  assert.match(source, /ccpStatus === "login_required"/);
  assert.doesNotMatch(source, /setCcpStatus\("direct"\)/);
  assert.doesNotMatch(source, /<details className="ccp-technical-details" open=/);
});

test("customer delete reloads list without fetching deleted selected history", () => {
  const source = readRepoFile("apps/app/src/pages/customers-page.tsx");

  assert.match(source, /const loadCustomers = async/);
  assert.match(source, /const loadSelectedHistory = async \(customerId: string\)/);
  assert.match(source, /refreshSelected\?: boolean/);
  assert.match(source, /await load\(\{ refreshSelected: false \}\)/);
  assert.match(source, /setSelected\(null\);\s*\n\s*await load\(\{ refreshSelected: false \}\)/);
  assert.match(source, /isCustomerNotFoundError\(historyError\)/);
  assert.match(source, /t\("customers\.historyUnavailable"\)/);
  assert.doesNotMatch(source, /apiGet<CustomerHistory>\(`\/api\/v1\/customers\/\$\{selected\.customer\.id\}\/appointments`\)/);
});

test("appointment deep links fetch exact appointment detail and clear stale URLs", () => {
  const source = readRepoFile("apps/app/src/pages/appointments-page.tsx");

  assert.match(source, /const allLoadedAppointments = useMemo/);
  assert.match(source, /allLoadedAppointments\.find\(\(item\) => item\.id === highlightedAppointmentId\)/);
  assert.match(source, /apiGet<AppointmentItem>\(`\/api\/v1\/appointments\/\$\{highlightedAppointmentId\}`\)/);
  assert.match(source, /isAppointmentNotFoundError\(detailError\)/);
  assert.match(source, /nextParams\.delete\("appointmentId"\)/);
  assert.match(source, /setSearchParams\(nextParams, \{ replace: true \}\)/);
  assert.match(source, /setSelectedDate\(appointmentDate\)/);
});

test("active appointment surfaces use operational status helper only", () => {
  const statusSource = readRepoFile("apps/app/src/lib/appointment-status.ts");
  const appointmentsSource = readRepoFile("apps/app/src/pages/appointments-page.tsx");
  const dashboardSource = readRepoFile("apps/app/src/pages/dashboard-page.tsx");
  const callCenterSource = readRepoFile("apps/app/src/pages/call-center-page.tsx");

  assert.match(statusSource, /OPERATIONAL_APPOINTMENT_STATUSES[\s\S]*"SCHEDULED"[\s\S]*"CONFIRMED"[\s\S]*"IN_PROGRESS"/);
  assert.doesNotMatch(statusSource.match(/OPERATIONAL_APPOINTMENT_STATUSES[\s\S]*?\];/)?.[0] ?? "", /CANCELED|NO_SHOW|COMPLETED/);
  assert.match(statusSource, /HISTORY_APPOINTMENT_STATUSES[\s\S]*"COMPLETED"[\s\S]*"CANCELED"[\s\S]*"NO_SHOW"/);
  assert.match(statusSource, /filterOperationalAppointments/);

  assert.match(appointmentsSource, /setOwnerUpcomingAppointments\(filterOperationalAppointments\(upcoming\)\)/);
  assert.match(appointmentsSource, /filterOperationalAppointments\(selectedDayAppointments\)\.filter/);
  assert.match(appointmentsSource, /const selectedDayOperationalAppointments = useMemo/);
  assert.match(appointmentsSource, /selectedDayOperationalAppointments\.map\(\(item\) =>/);
  assert.doesNotMatch(appointmentsSource, /selectedDayAppointments\.map\(\(item\) =>/);
  assert.match(appointmentsSource, /const upcomingAppointments = useMemo\(\(\) => \{[\s\S]*filterOperationalAppointments\(appointments\)/);

  assert.match(dashboardSource, /isOperationalAppointmentStatus\(item\.status\)/);
  assert.match(callCenterSource, /isOperationalAppointmentStatus\(appointment\.status\)/);
});

test("canceling selected appointments clears active local state before silent reload", () => {
  const source = readRepoFile("apps/app/src/pages/appointments-page.tsx");

  assert.match(source, /const removeAppointmentFromActiveCollections = \(appointmentId: string\) =>/);
  assert.match(source, /setAppointments\(\(items\) => items\.filter\(\(item\) => item\.id !== appointmentId\)\)/);
  assert.match(source, /setOwnerUpcomingAppointments\(\(items\) => items\.filter\(\(item\) => item\.id !== appointmentId\)\)/);
  assert.match(source, /setReminders\(\(items\) => items\.filter\(\(item\) => item\.appointment\.id !== appointmentId\)\)/);
  assert.match(source, /setSelectedAppointment\(\(current\) => \(current\?\.id === appointmentId \? null : current\)\)/);
  assert.match(source, /nextParams\.delete\("appointmentId"\)/);
  assert.match(source, /removeAppointmentFromActiveCollections\(appointment\.id\)/);
  assert.match(source, /await load\(\{ silent: true \}\)/);
});

test("appointments page silently revalidates schedules without full-page loading flicker", () => {
  const source = readRepoFile("apps/app/src/pages/appointments-page.tsx");

  assert.match(source, /interface LoadOptions[\s\S]*silent\?: boolean/);
  assert.match(source, /const load = useCallback\(async \(options: LoadOptions = \{\}\) =>/);
  assert.match(source, /if \(!options\.silent\) \{[\s\S]*setLoading\(true\)/);
  assert.match(source, /if \(!options\.silent\) \{[\s\S]*setLoading\(false\)/);
  assert.match(source, /window\.addEventListener\("focus", revalidateSchedule\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /window\.setInterval\(revalidateSchedule, 20000\)/);
  assert.match(source, /window\.removeEventListener\("focus", revalidateSchedule\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /window\.clearInterval\(interval\)/);
});

test("owner appointments page uses independent main and sidebar stacks", () => {
  const source = readRepoFile("apps/app/src/pages/appointments-page.tsx");
  const styles = readRepoFile("apps/app/src/styles.css");

  assert.match(source, /owner-appointments-workspace/);
  assert.match(source, /owner-appointments-main/);
  assert.match(source, /owner-appointments-sidebar/);
  assert.match(styles, /\.owner-appointments-workspace,\s*\n\.owner-appointments-main,\s*\n\.owner-appointments-sidebar/);
  assert.match(styles, /grid-template-columns: minmax\(0, 2fr\) minmax\(320px, 1fr\)/);
  assert.doesNotMatch(styles, /owner-appointments-page \.appointments-create-card\s*\{\s*position: sticky/);
});
