import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result.stdout;
}

test("quick source archive includes safe templates, excludes secret files, and carries a deterministic manifest", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fastaibooking-archive-contract-"));
  const zipPath = path.join(tmpDir, "fastaibooking-current-state.zip");
  const extractDir = path.join(tmpDir, "extract");
  fs.mkdirSync(extractDir);

  run("bash", ["make-fastaibooking-quick-zip.sh", zipPath]);

  const zipListing = run("unzip", ["-Z1", zipPath])
    .split("\n")
    .filter(Boolean)
    .sort();
  const zipPaths = new Set(zipListing);

  for (const requiredPath of [
    ".env.example",
    ".env.production.example",
    "apps/api/.env.example",
    "apps/app/.env.example",
    "apps/admin/.env.example",
    "infra/lambda/booking-handler/index.mjs",
    "artifact-manifest.json"
  ]) {
    assert.equal(zipPaths.has(requiredPath), true, `${requiredPath} must be present`);
  }

  for (const forbiddenPath of [
    ".env",
    ".env.local",
    "apps/api/.env",
    "diagnostics/releases/voice-20260719T131256Z-e399848a0d6e/before-production.json",
    "FastAIBooking_Postman_Environment.json"
  ]) {
    assert.equal(zipPaths.has(forbiddenPath), false, `${forbiddenPath} must not be archived`);
  }

  assert.equal(zipListing.some((entry) => entry.startsWith(".git/")), false, ".git must not be archived");
  assert.equal(zipListing.some((entry) => entry.startsWith("node_modules/")), false, "node_modules must not be archived");
  assert.equal(zipListing.some((entry) => /\.(?:pem|p12|pfx|key|sqlite|db)$/i.test(entry)), false);

  const manifest = JSON.parse(run("unzip", ["-p", zipPath, "artifact-manifest.json"]));
  assert.equal(manifest.schemaVersion, "fastaibooking.archive-manifest.v1");
  assert.match(manifest.commitSha, /^[0-9a-f]{40}$/);
  assert.match(manifest.sourceHash, /^[0-9a-f]{64}$/);
  assert.deepEqual([...manifest.archivedPaths].sort(), zipListing);
  for (const archivedFile of manifest.files) {
    assert.match(archivedFile.sha256, /^[0-9a-f]{64}$/);
    assert.equal(zipPaths.has(archivedFile.path), true);
  }

  run("unzip", ["-q", zipPath, "-d", extractDir]);
  run("node", ["--check", path.join(extractDir, "infra/lambda/booking-handler/index.mjs")], {
    cwd: extractDir
  });
  run("node", [
    "scripts/secret-scan.mjs",
    "--mode",
    "manifest",
    "--root",
    extractDir,
    "--manifest",
    path.join(extractDir, "artifact-manifest.json")
  ]);
});
