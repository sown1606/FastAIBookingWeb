#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-fastaibooking-current-state.zip}"
LIST="$(mktemp)"
MANIFEST_DIR="$(mktemp -d)"
MANIFEST_FILE="$MANIFEST_DIR/artifact-manifest.json"
trap 'rm -f "$LIST"; rm -rf "$MANIFEST_DIR"' EXIT

SAFE_ENV_TEMPLATES=(
  ".env.example"
  ".env.production.example"
  "apps/api/.env.example"
  "apps/app/.env.example"
  "apps/admin/.env.example"
)

# Phải chạy trong Git repo.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Lỗi: hãy chạy script tại root repo FastAIBooking." >&2
  exit 1
}

OUT_DIR="$(dirname "$OUT")"
OUT_BASE="$(basename "$OUT")"
mkdir -p "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" && pwd)/$OUT_BASE"

rm -f "$OUT_ABS"

echo "Đang lập danh sách source và log Codex..."

is_safe_env_template() {
  local candidate="$1"
  local template
  for template in "${SAFE_ENV_TEMPLATES[@]}"; do
    if [ "$candidate" = "$template" ]; then
      return 0
    fi
  done
  return 1
}

is_excluded_path() {
  local candidate="$1"
  local lower
  lower="$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]')"

  case "$candidate" in
    .git/*|*/.git/*|node_modules/*|*/node_modules/*|.idea/*|*/.idea/*|.vscode/*|*/.vscode/*|.cursor/*|*/.cursor/*|.continue/*|*/.continue/*|.agents/*|*/.agents/*|.turbo/*|*/.turbo/*|.next/*|*/.next/*|.vercel/*|*/.vercel/*|coverage/*|*/coverage/*|dist/*|*/dist/*|build/*|*/build/*|logs/*|*/logs/*|Trash/*|*/Trash/*|secrets/*|*/secrets/*|diagnostics/releases/*)
      return 0
      ;;
    .DS_Store|*/.DS_Store|FastAIBooking_Postman_Environment.json|*/FastAIBooking_Postman_Environment.json|firebase-notification-setup.local.md|*/firebase-notification-setup.local.md)
      return 0
      ;;
  esac

  if is_safe_env_template "$candidate"; then
    return 1
  fi

  case "$candidate" in
    .env|*/.env|.env.local|*/.env.local|.env.development|*/.env.development|.env.test|*/.env.test|.env.production|*/.env.production|.env.staging|*/.env.staging|.env.*.local|*/.env.*.local)
      return 0
      ;;
    .env.*|*/.env.*)
      return 0
      ;;
  esac

  case "$lower" in
    *.zip|*.7z|*.rar|*.tar|*.tgz|*.gz|*.pem|*.p12|*.pfx|*.key|*.crt|*.cer|*.cert|*.jks|*.keystore|*.db|*.sqlite|*.sqlite3|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.bmp|*.tiff|*.mp3|*.mp4|*.m4a|*.aac|*.wav|*.flac|*.ogg|*.webm|*.mov|*.avi|*.mkv)
      return 0
      ;;
  esac

  return 1
}

# Source tracked + untracked, nhưng bỏ dependency, build output, secret và binary lớn.
git ls-files -co --exclude-standard | while IFS= read -r candidate; do
  if is_excluded_path "$candidate"; then
    continue
  fi
  printf '%s\n' "$candidate"
done > "$LIST"

for template in "${SAFE_ENV_TEMPLATES[@]}"; do
  if [ -f "$template" ]; then
    printf '%s\n' "$template" >> "$LIST"
  fi
done

# Codex có thể ghi log vào các thư mục bị .gitignore; lấy riêng các file text này.
for DIR in diagnostics/codex-run artifacts/codex-run codex-output; do
  if [ -d "$DIR" ]; then
    find "$DIR" -type f \
      \( -iname '*.md' -o -iname '*.txt' -o -iname '*.json' \
         -o -iname '*.jsonl' -o -iname '*.log' -o -iname '*.patch' \
         -o -iname '*.diff' -o -iname '*.xml' -o -iname '*.csv' \
         -o -iname '*.yaml' -o -iname '*.yml' \) \
      -print >> "$LIST"
  fi
done

LC_ALL=C sort -u "$LIST" -o "$LIST"

COUNT="$(wc -l < "$LIST" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then
  echo "Lỗi: không tìm thấy file để nén." >&2
  exit 1
fi

GIT_COMMIT_SHA="$(git rev-parse HEAD)"
GIT_DIRTY_HASH="$(git status --porcelain=v1 | shasum -a 256 | awk '{print $1}')"
ZIP_VERSION="$(zip -v 2>/dev/null | sed -n '1p' || true)"

node - "$LIST" "$MANIFEST_FILE" "$GIT_COMMIT_SHA" "$GIT_DIRTY_HASH" "$ZIP_VERSION" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [listPath, manifestPath, commitSha, dirtyTreeHash, zipVersion] = process.argv.slice(2);
const paths = fs.readFileSync(listPath, "utf8").split("\n").filter(Boolean);
const files = paths.map((relativePath) => {
  const bytes = fs.readFileSync(relativePath);
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
});
const sourceHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 }))))
  .digest("hex");
const manifest = {
  schemaVersion: "fastaibooking.archive-manifest.v1",
  generatedAt: new Date().toISOString(),
  commitSha,
  dirtyTreeHash,
  sourceHash,
  toolVersions: {
    node: process.version,
    zip: zipVersion || "unknown"
  },
  archivedPaths: [...paths, "artifact-manifest.json"],
  files,
  generatedFiles: [
    {
      path: "artifact-manifest.json",
      sha256: null,
      reason: "self_describing_manifest"
    }
  ],
  exclusions: {
    deniedEnvironmentFiles: [
      ".env",
      ".env.local",
      ".env.development",
      ".env.test",
      ".env.production",
      ".env.staging",
      ".env.*.local",
      "non-allowlisted .env.*"
    ],
    safeEnvironmentTemplateAllowlist: [
      ".env.example",
      ".env.production.example",
      "apps/api/.env.example",
      "apps/app/.env.example",
      "apps/admin/.env.example"
    ],
    deniedDirectories: [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      "logs",
      "secrets",
      "diagnostics/releases"
    ],
    deniedExtensions: [
      ".zip",
      ".pem",
      ".p12",
      ".pfx",
      ".key",
      ".sqlite",
      ".db",
      ".png",
      ".jpg",
      ".mp3",
      ".mp4",
      ".wav"
    ]
  }
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "Đang nén nhanh $COUNT file..."
# -1 = nén nhanh; -@ = đọc danh sách file từ stdin.
zip -q -1 -@ "$OUT_ABS" < "$LIST"
(cd "$MANIFEST_DIR" && zip -q -1 "$OUT_ABS" artifact-manifest.json)

echo "Xong: $OUT_ABS"
du -h "$OUT_ABS"
