#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const PATTERNS = [
  {
    category: "aws_access_key_id",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/m
  },
  {
    category: "aws_presigned_url",
    re: /\bX-Amz-(?:Signature|Credential|Security-Token|Algorithm|Expires)\b|[?&](?:AWSAccessKeyId|Signature|Expires)=/m
  },
  {
    category: "bearer_authorization",
    re: /\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/im
  },
  {
    category: "private_key_material",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/m
  },
  {
    category: "lambda_environment_dump",
    re: /"Environment"\s*:\s*\{\s*"Variables"\s*:/m
  },
  {
    category: "internal_token_assignment",
    re: /FASTAIBOOKING_API_INTERNAL_TOKEN[^\n\r]*(?::|=)[^\n\r]*[A-Za-z0-9_./+=-]{20,}/m
  },
  {
    category: "session_token_name",
    re: /\b(?:AWS_SESSION_TOKEN|SessionToken|aws_session_token)\b/m
  }
];

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

const pathspecs = process.argv.slice(2);
const pathArgs = pathspecs.length > 0 ? ["--", ...pathspecs] : ["--"];
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const findings = new Map();

const historicalObjects = git(["rev-list", "--objects", "--all", ...pathArgs])
  .trim()
  .split("\n")
  .filter(Boolean);
const blobsByObject = new Map();

for (const line of historicalObjects) {
  const [objectId, ...pathParts] = line.split(" ");
  const objectPath = pathParts.join(" ");
  if (!objectPath || blobsByObject.has(objectId)) {
    continue;
  }
  const type = git(["cat-file", "-t", objectId]).trim();
  if (type !== "blob") {
    continue;
  }
  const size = Number(git(["cat-file", "-s", objectId]).trim());
  if (!Number.isFinite(size) || size > MAX_TEXT_BYTES) {
    continue;
  }
  blobsByObject.set(objectId, objectPath);
}

for (const [objectId, objectPath] of blobsByObject.entries()) {
  const contentResult = spawnSync("git", ["cat-file", "-p", objectId], {
    encoding: "utf8",
    maxBuffer: MAX_TEXT_BYTES + 1024
  });
  if (contentResult.status !== 0) {
    throw new Error(contentResult.stderr || `git cat-file failed for ${objectPath}`);
  }
  if (contentResult.stdout.includes("\0")) {
    continue;
  }
  const matchedCategories = PATTERNS
    .filter((pattern) => pattern.re.test(contentResult.stdout))
    .map((pattern) => pattern.category);
  if (matchedCategories.length === 0) {
    continue;
  }
  for (const category of matchedCategories) {
    const key = `${category}\tblob:${objectId.slice(0, 12)}\t${objectPath}`;
    findings.set(key, true);
  }
}

for (const finding of [...findings.keys()].sort()) {
  console.log(finding);
}

console.log(`history_findings=${findings.size}`);
