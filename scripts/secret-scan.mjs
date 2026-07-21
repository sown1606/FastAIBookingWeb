#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const options = {
    mode: "auto",
    root: process.cwd(),
    manifest: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      options.mode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--root") {
      options.root = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--manifest") {
      options.manifest = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/secret-scan.mjs [--mode auto|git|filesystem|manifest] [--root <path>] [--manifest <path>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["auto", "git", "filesystem", "manifest"].includes(options.mode)) {
    throw new Error(`Unsupported secret scan mode: ${options.mode}`);
  }
  if (options.mode === "manifest" && !options.manifest) {
    throw new Error("--manifest is required when --mode manifest is used");
  }
  return options;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(OPTIONS.root || process.cwd());
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "logs",
  "secrets",
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
  [".env.example", new Set(["internal_token_variable_name"])],
  [".env.production.example", new Set(["internal_token_variable_name"])],
  ["apps/api/.env.example", new Set(["internal_token_variable_name"])],
  ["README.md", new Set(["internal_token_variable_name"])],
  ["apps/api/package.json", new Set(["internal_token_variable_name"])],
  ["scripts/secret-scan.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/secret-history-scan.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/sanitize-aws-artifact.mjs", new Set(PATTERNS.map((pattern) => pattern.category))],
  ["scripts/aws/verify-fastaibooking-aws-identity.sh", new Set(["session_token_name"])],
  ["scripts/aws/voice-stack-release.mjs", new Set(["session_token_name", "internal_token_variable_name"])],
  ["infra/lambda/booking-handler/index.mjs", new Set(["internal_token_variable_name"])],
  ["apps/api/src/modules/ai-reception/ai-reception.service.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/src/modules/ai/ai.routes.ts", new Set(["internal_token_variable_name"])],
  ["tests/lambda/booking-handler.test.mjs", new Set(["internal_token_variable_name"])],
  ["apps/api/src/config/env.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/test/ai-internal.test.ts", new Set(["internal_token_variable_name"])],
  ["apps/api/test/role-guards.test.ts", new Set(["internal_token_variable_name"])]
]);

function gitFiles() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    throw new Error("git metadata is not present");
  }
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

function filesystemFiles() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(ROOT, fullPath).split(path.sep).join("/");
      if (!relativePath || shouldSkip(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  walk(ROOT);
  return Array.from(new Set(files)).sort();
}

function manifestFiles() {
  const manifestPath = path.resolve(OPTIONS.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const candidates = Array.isArray(manifest.files)
    ? manifest.files.map((file) => file?.path).filter(Boolean)
    : Array.isArray(manifest.archivedPaths)
      ? manifest.archivedPaths
      : [];
  return Array.from(new Set(candidates))
    .filter((relativePath) => {
      if (typeof relativePath !== "string" || relativePath === "artifact-manifest.json") {
        return false;
      }
      if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
        throw new Error(`Manifest path escapes scan root: ${relativePath}`);
      }
      return fs.existsSync(path.join(ROOT, relativePath));
    })
    .sort();
}

function scanFiles() {
  if (OPTIONS.mode === "git") {
    return gitFiles();
  }
  if (OPTIONS.mode === "filesystem") {
    return filesystemFiles();
  }
  if (OPTIONS.mode === "manifest") {
    return manifestFiles();
  }
  try {
    return gitFiles();
  } catch (error) {
    return filesystemFiles();
  }
}

function shouldSkip(relativePath) {
  if (relativePath === "diagnostics/releases" || relativePath.startsWith("diagnostics/releases/")) {
    return true;
  }
  const parts = relativePath.split(/[\\/]/);
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
for (const relativePath of scanFiles()) {
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
