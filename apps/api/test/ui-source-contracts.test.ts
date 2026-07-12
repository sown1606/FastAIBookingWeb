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
  const i18nSource = readRepoFile("apps/admin/src/lib/i18n.tsx");

  assert.match(source, /const buildCallDebugPayload/);
  assert.match(source, /downloadJsonFile\(filename,\s*buildCallDebugPayload\(call,\s*exportedAt\)\)/);
  assert.match(source, /copyTextToClipboard\(JSON\.stringify\(payload,\s*null,\s*2\)\)/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  for (const key of [
    "authorization",
    "cookie",
    "set-cookie",
    "accesstoken",
    "refreshtoken",
    "apikey",
    "secret",
    "password"
  ]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
  assert.match(source, /calls\.copyDebugJson/);
  assert.match(source, /calls\.debugJsonCopied/);
  assert.match(i18nSource, /"calls\.copyDebugJson": "Copy debug JSON"/);
  assert.match(i18nSource, /"calls\.debugJsonCopied": "Debug JSON copied"/);
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
