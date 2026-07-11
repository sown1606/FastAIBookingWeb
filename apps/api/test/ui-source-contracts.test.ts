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

test("call-center CCP is embedded-first with collapsed technical details", () => {
  const source = readRepoFile("apps/app/src/pages/call-center-page.tsx");

  assert.match(source, /VITE_AMAZON_CONNECT_EMBEDDED_CCP_ENABLED !== "false"/);
  assert.match(source, /\.core\.initCCP/);
  assert.match(source, /loginPopup:\s*false/);
  assert.match(source, /ccpStatus === "login_required"/);
  assert.doesNotMatch(source, /setCcpStatus\("direct"\)/);
  assert.doesNotMatch(source, /<details className="ccp-technical-details" open=/);
});
