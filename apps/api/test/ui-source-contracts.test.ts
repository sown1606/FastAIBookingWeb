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
