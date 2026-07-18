#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".vercel",
  ".idea"
]);
const IGNORED_FILE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".m4a",
  ".mp3",
  ".wav",
  ".zip",
  ".pem"
]);

const PATTERNS = [
  {
    category: "aws_access_key_id",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    category: "aws_presigned_url",
    re: /\bX-Amz-(?:Signature|Credential|Security-Token|Algorithm|Expires)\b|[?&](?:AWSAccessKeyId|Signature|Expires)=/
  },
  {
    category: "bearer_authorization",
    re: /\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i
  },
  {
    category: "private_key_material",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    category: "lambda_environment_dump",
    re: /"Environment"\s*:\s*\{\s*"Variables"\s*:/
  },
  {
    category: "internal_token_variable_name",
    re: /\bFASTAIBOOKING_API_INTERNAL_TOKEN\b/
  },
  {
    category: "session_token_name",
    re: /\b(?:AWS_SESSION_TOKEN|SessionToken|aws_session_token)\b/
  }
];
const DOCUMENTATION_PATH_RE = /^(?:README\.md|docs\/)/;
const DOCUMENTATION_PHONE_RE = /\+\d[\d ().-]{7,}\d|\b\d{10,15}\b/g;
const KNOWN_NON_PHONE_LONG_NUMBERS = new Set([
  "197452633989"
]);

const VALUE_CATEGORY_ALLOWLIST = new Map([
  [".env.production.example", new Set(["internal_token_variable_name"])],
  ["README.md", new Set(["internal_token_variable_name"])],
  ["apps/api/package.json", new Set(["internal_token_variable_name"])],
  ["scripts/secret-scan.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/secret-history-scan.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/sanitize-aws-artifact.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/aws/verify-fastaibooking-aws-identity.sh", new Set(["session_token_name"])],
  ["infra/lambda/booking-handler/index.mjs", new Set(["internal_token_variable_name"])],
  ["apps/api/src/modules/ai-reception/ai-reception.service.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/src/modules/ai/ai.routes.ts", new Set(["internal_token_variable_name"])],
  ["tests/lambda/booking-handler.test.mjs", new Set(["internal_token_variable_name"])],
  ["apps/api/src/config/env.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/test/ai-internal.test.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/test/role-guards.test.ts", new Set(["internal_token_variable_name"])]
]);

function gitFiles() {
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  const files = [];
  for (const result of [tracked, untracked]) {
    if (result.status !== 0) {
      throw new Error(result.stderr || "git ls-files failed");
    }
    files.push(...result.stdout.split("\n").filter(Boolean));
  }
  return Array.from(new Set(files)).sort();
}

function shouldSkip(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => IGNORED_DIRS.has(part))) {
    return true;
  }
  return IGNORED_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) {
    return null;
  }
  const buffer = fs.readFileSync(fullPath);
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString("utf8");
}

const findings = [];
for (const relativePath of gitFiles()) {
  if (process.env.SECRET_SCAN_DEBUG === "1") {
    console.error(`scan\t${relativePath}`);
  }
  if (shouldSkip(relativePath)) {
    continue;
  }
  const text = readText(relativePath);
  if (text === null) {
    continue;
  }
  const allowedCategories = VALUE_CATEGORY_ALLOWLIST.get(relativePath) ?? new Set();
  for (const { category, re } of PATTERNS) {
    if (!re.test(text)) {
      continue;
    }
    findings.push({
      path: relativePath,
      category,
      allowed: allowedCategories.has(category)
    });
  }
  if (DOCUMENTATION_PATH_RE.test(relativePath)) {
    for (const match of text.matchAll(DOCUMENTATION_PHONE_RE)) {
      const digits = match[0].replace(/\D/g, "");
      if (KNOWN_NON_PHONE_LONG_NUMBERS.has(digits)) {
        continue;
      }
      findings.push({
        path: relativePath,
        category: "documentation_phone_number",
        allowed: false
      });
      break;
    }
  }
}

for (const finding of findings) {
  const marker = finding.allowed ? "ALLOWLISTED" : "FAIL";
  console.log(`${marker}\t${finding.category}\t${finding.path}`);
}

if (findings.some((finding) => !finding.allowed)) {
  process.exit(1);
}
