#!/usr/bin/env bash
set -Eeuo pipefail

OUT_NAME="${1:-fastaibooking-current-state.zip}"
MAX_SOURCE_BYTES="${MAX_SOURCE_BYTES:-12582912}"          # 12 MiB mỗi source file
MAX_CODEX_FILE_BYTES="${MAX_CODEX_FILE_BYTES:-26214400}" # 25 MiB mỗi log
MAX_CODEX_TOTAL_BYTES="${MAX_CODEX_TOTAL_BYTES:-104857600}" # 100 MiB tổng log

for cmd in git zip python3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: thiếu command '$cmd'" >&2
    exit 1
  }
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: chạy script bên trong repo FastAIBooking." >&2
  exit 1
}
cd "$ROOT"

case "$OUT_NAME" in
  /*) OUT_PATH="$OUT_NAME" ;;
  *)  OUT_PATH="$ROOT/$OUT_NAME" ;;
esac

BUNDLE_NAME="fastaibooking-current-state"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/fastaibooking-bundle.XXXXXX")"
BUNDLE="$STAGE/$BUNDLE_NAME"
DIAG="$BUNDLE/_diagnostics"
GEN="$DIAG/generated"
SKIPPED="$DIAG/SKIPPED_FILES.txt"
INCLUDED="$DIAG/INCLUDED_FILES.txt"
trap 'rm -rf "$STAGE"' EXIT

rm -f "$OUT_PATH"
mkdir -p "$GEN" "$DIAG/codex-run"
: > "$SKIPPED"
: > "$INCLUDED"

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

skip_repo_file() {
  local file="$1" lower base
  lower="$(printf '%s' "$file" | tr '[:upper:]' '[:lower:]')"
  base="${lower##*/}"

  case "/$lower/" in
    */node_modules/*|*/.git/*|*/.idea/*|*/.vscode/*|*/.cursor/*|*/.continue/*|*/.agents/*|*/.codex/*|*/.turbo/*|*/.next/*|*/.vercel/*|*/coverage/*|*/dist/*|*/build/*|*/logs/*|*/trash/*|*/playwright-report/*|*/test-results/*|*/diagnostics/codex-run/*|*/artifacts/codex-run/*|*/codex-output/*)
      return 0 ;;
  esac

  case "$base" in
    .ds_store|.env|.env.*|.npmrc|.netrc|credentials|credentials.*|terraform.tfstate|terraform.tfstate.*|*.tfvars|*.tfvars.json|id_rsa|id_rsa.*|id_ed25519|id_ed25519.*)
      return 0 ;;
  esac

  case "$lower" in
    *postman*environment*.json|*service-account*.json|*serviceaccount*.json|*firebase-adminsdk*.json|*google-credentials*.json)
      return 0 ;;
  esac

  case "$base" in
    *.zip|*.7z|*.rar|*.tar|*.tgz|*.gz|*.bz2|*.xz|*.pem|*.p12|*.pfx|*.key|*.crt|*.cer|*.cert|*.jks|*.keystore|*.log|*.db|*.sqlite|*.sqlite3|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.bmp|*.tiff|*.mp3|*.mp4|*.m4a|*.aac|*.wav|*.flac|*.ogg|*.webm|*.mov|*.avi|*.mkv|*.pdf|*.exe|*.dll|*.so|*.dylib|*.bin|*.wasm)
      return 0 ;;
  esac

  [[ "$ROOT/$file" == "$OUT_PATH" ]] && return 0
  return 1
}

copy_repo_file() {
  local file="$1" size dest

  if [[ ! -f "./$file" || -L "./$file" ]]; then
    printf 'SKIP_NOT_REGULAR_OR_SYMLINK\t%s\n' "$file" >> "$SKIPPED"
    return
  fi

  if skip_repo_file "$file"; then
    printf 'SKIP_POLICY\t%s\n' "$file" >> "$SKIPPED"
    return
  fi

  size="$(file_size "./$file")"
  if (( size > MAX_SOURCE_BYTES )); then
    printf 'SKIP_TOO_LARGE\t%s\t%s bytes\n' "$file" "$size" >> "$SKIPPED"
    return
  fi

  dest="$BUNDLE/$file"
  mkdir -p "$(dirname "$dest")"
  cp -p "./$file" "$dest"
  printf '%s\n' "$file" >> "$INCLUDED"
}

# NUL-safe: xử lý đúng filename có khoảng trắng.
while IFS= read -r -d '' file; do
  copy_repo_file "$file"
done < <(git ls-files -z -c -o --exclude-standard)

cat > "$BUNDLE/README_FIRST.txt" <<EOF
FastAIBooking diagnostic bundle
Generated UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Branch: $(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo DETACHED_HEAD)
HEAD: $(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)

Có trong bundle:
- source tracked + untracked không bị gitignore;
- Git status/diff/commit metadata;
- log Codex từ diagnostics/codex-run, artifacts/codex-run hoặc codex-output;
- báo cáo file bị loại và secret redaction.

Không có:
- .env, credential/key/certificate, Postman Environment;
- media/audio/video, database, build output, node_modules;
- ~/.codex, ~/.aws, shell history hoặc environment dump.

Phone number và Amazon Connect ContactId được giữ để đối chiếu cuộc gọi.
EOF

# Không lấy remote URL và không dump environment vì có thể chứa token.
git status --short --branch --untracked-files=all > "$GEN/git-status.txt" 2>&1 || true
git log -n 40 --date=iso-strict --decorate --pretty='format:%h %ad %d %s' > "$GEN/git-log-last-40.txt" 2>&1 || true
git show -s --date=iso-strict --format=fuller HEAD > "$GEN/git-head.txt" 2>&1 || true
git diff --no-ext-diff --no-color --stat > "$GEN/git-diff-stat.txt" 2>&1 || true
git diff --cached --no-ext-diff --no-color --stat > "$GEN/git-diff-cached-stat.txt" 2>&1 || true
git diff --no-ext-diff --no-color > "$GEN/git-working-tree.patch" 2>&1 || true
git diff --cached --no-ext-diff --no-color > "$GEN/git-staged.patch" 2>&1 || true
git diff --check > "$GEN/git-diff-check.txt" 2>&1 || true
git diff --name-status HEAD > "$GEN/git-changed-files.txt" 2>&1 || true
git ls-files --others --exclude-standard > "$GEN/git-untracked-files.txt" 2>&1 || true
git remote > "$GEN/git-remote-names-only.txt" 2>&1 || true

{
  echo "UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'OS: '; uname -srm 2>/dev/null || true
  printf 'git: '; git --version 2>/dev/null || true
  printf 'node: '; node --version 2>/dev/null || echo 'not installed'
  printf 'npm: '; npm --version 2>/dev/null || echo 'not installed'
  printf 'python3: '; python3 --version 2>/dev/null || true
  printf 'aws-cli: '; aws --version 2>&1 || echo 'not installed'
} > "$GEN/tool-versions.txt"

# Log Codex được lấy riêng, kể cả file .log đang bị gitignore.
CODEX_TOTAL=0
for source_dir in diagnostics/codex-run artifacts/codex-run codex-output; do
  [[ -d "$source_dir" ]] || continue
  label="$(printf '%s' "$source_dir" | tr '/' '_')"

  while IFS= read -r -d '' file; do
    rel="${file#./}"
    inside="${rel#${source_dir}/}"
    lower="$(printf '%s' "$rel" | tr '[:upper:]' '[:lower:]')"

    case "$lower" in
      *.md|*.txt|*.json|*.jsonl|*.log|*.patch|*.diff|*.xml|*.csv|*.yaml|*.yml) ;;
      *)
        printf 'SKIP_CODEX_NON_TEXT_EXTENSION\t%s\n' "$rel" >> "$SKIPPED"
        continue ;;
    esac

    [[ -f "$file" && ! -L "$file" ]] || continue
    size="$(file_size "$file")"

    if (( size > MAX_CODEX_FILE_BYTES )); then
      printf 'SKIP_CODEX_FILE_TOO_LARGE\t%s\t%s bytes\n' "$rel" "$size" >> "$SKIPPED"
      continue
    fi

    if (( CODEX_TOTAL + size > MAX_CODEX_TOTAL_BYTES )); then
      printf 'SKIP_CODEX_TOTAL_LIMIT\t%s\t%s bytes\n' "$rel" "$size" >> "$SKIPPED"
      continue
    fi

    dest="$DIAG/codex-run/$label/$inside"
    mkdir -p "$(dirname "$dest")"
    cp -p "$file" "$dest"
    CODEX_TOTAL=$((CODEX_TOTAL + size))
  done < <(find "./$source_dir" -type f -print0)
done

if (( CODEX_TOTAL == 0 )); then
  cat > "$DIAG/codex-run/NO_CODEX_EVIDENCE_FOUND.txt" <<'EOF'
Không tìm thấy log Codex rõ ràng.
Hãy yêu cầu Codex ghi output vào diagnostics/codex-run rồi chạy lại script.
Không copy ~/.codex, ~/.aws, shell history hoặc environment dump.
EOF
fi

# Chỉ redact generated/Codex diagnostics. Source code giữ nguyên để phân tích chính xác.
python3 - "$BUNDLE" <<'PYREDACT_92817'
from __future__ import annotations

import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
diag = root / "_diagnostics"
max_bytes = 30 * 1024 * 1024

keys = (
    r"authorization|proxy-authorization|x-api-key|api[_-]?key|"
    r"aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key|"
    r"access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|"
    r"password|passwd|pwd|client[_-]?secret|jwt[_-]?secret|secret|"
    r"database[_-]?url|redis[_-]?url|smtp[_-]?(?:pass|password)|private[_-]?key"
)

patterns: list[tuple[re.Pattern[str], object]] = [
    (re.compile(r"-----BEGIN [^-\r\n]*PRIVATE KEY-----.*?-----END [^-\r\n]*PRIVATE KEY-----", re.S), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(rf"(?i)([\"'](?:{keys})[\"']\s*:\s*)([\"'])(.*?)(\2)"), lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]{m.group(2)}"),
    (re.compile(rf"(?i)([\"'](?:{keys})[\"']\s*:\s*)([^,\r\n}}\]]+)"), lambda m: f'{m.group(1)}"[REDACTED]"'),
    (re.compile(rf"(?im)^([ +\-]*\s*(?:export\s+)?(?:{keys})\s*=\s*)([^\r\n#]+)"), lambda m: f"{m.group(1)}[REDACTED]"),
    (re.compile(r"(?im)^([ +\-]*\s*(?:authorization|proxy-authorization|x-api-key)\s*:\s*)(.*?)(,?\s*)$"), lambda m: f"{m.group(1)}[REDACTED]{m.group(3)}"),
    (re.compile(r"(?i)([a-z][a-z0-9+.-]*://[^:/\s]+:)([^@\s/]+)(@)"), lambda m: f"{m.group(1)}[REDACTED]{m.group(3)}"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=${}-]{12,}"), "Bearer [REDACTED]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[REDACTED_JWT]"),
    (re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "[REDACTED_AWS_ACCESS_KEY_ID]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"), "[REDACTED_GOOGLE_API_KEY]"),
    (re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"), "[REDACTED_GITHUB_TOKEN]"),
    (re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"), "[REDACTED_OPENAI_TOKEN]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "[REDACTED_SLACK_TOKEN]"),
    (re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{12,}\b"), "[REDACTED_STRIPE_SECRET]"),
]

changed: list[tuple[str, int]] = []
for path in sorted(diag.rglob("*")):
    if not path.is_file() or path.is_symlink():
        continue
    data = path.read_bytes()
    if len(data) > max_bytes or b"\x00" in data[:8192]:
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        continue

    original = text
    count = 0
    for pattern, replacement in patterns:
        text, n = pattern.subn(replacement, text)
        count += n

    if text != original:
        path.write_bytes(text.encode("utf-8"))
        changed.append((str(path.relative_to(root)), count))

with (diag / "REDACTION_REPORT.txt").open("w", encoding="utf-8") as fh:
    fh.write("Secret redaction report\n")
    fh.write("Chỉ diagnostics bị sửa; source code được giữ nguyên.\n")
    fh.write("Phone number và ContactId được giữ để đối chiếu.\n\n")
    if not changed:
        fh.write("Không phát hiện credential có khả năng cao trong diagnostics.\n")
    else:
        for name, count in changed:
            fh.write(f"{count}\t{name}\n")

# High-confidence scan source. File nghi có secret sẽ bị loại khỏi bundle, không in value.
high_risk = re.compile(
    r"-----BEGIN [^-\r\n]*PRIVATE KEY-----|"
    r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|"
    r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|"
    r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|"
    r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b|"
    r"\b(?:sk|rk)_live_[A-Za-z0-9]{12,}\b"
)
removed: list[str] = []
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.is_symlink() or diag in path.parents:
        continue
    data = path.read_bytes()
    if len(data) > max_bytes or b"\x00" in data[:8192]:
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        continue
    if high_risk.search(text):
        removed.append(str(path.relative_to(root)))
        path.unlink()

with (diag / "REMOVED_HIGH_RISK_SECRET_FILES.txt").open("w", encoding="utf-8") as fh:
    if not removed:
        fh.write("Không phát hiện high-confidence credential trong source đã copy.\n")
    else:
        fh.write("WARNING: các file sau đã bị loại khỏi bundle; chỉ ghi path, không ghi secret value.\n")
        for name in removed:
            fh.write(name + "\n")
PYREDACT_92817

(
  cd "$BUNDLE"
  find . -type f -print | LC_ALL=C sort
) > "$DIAG/BUNDLE_FILE_LIST.txt"

(
  cd "$STAGE"
  zip -q -r "$OUT_PATH" "$BUNDLE_NAME"
)

if command -v shasum >/dev/null 2>&1; then
  CHECKSUM="$(shasum -a 256 "$OUT_PATH" | awk '{print $1}')"
else
  CHECKSUM="$(sha256sum "$OUT_PATH" | awk '{print $1}')"
fi

SIZE_HUMAN="$(du -h "$OUT_PATH" | awk '{print $1}')"
echo "Created: $OUT_PATH"
echo "Size:    $SIZE_HUMAN"
echo "SHA256:  $CHECKSUM"
echo "Review:  $BUNDLE_NAME/_diagnostics/REDACTION_REPORT.txt"
echo "Review:  $BUNDLE_NAME/_diagnostics/REMOVED_HIGH_RISK_SECRET_FILES.txt"
echo "Review:  $BUNDLE_NAME/_diagnostics/SKIPPED_FILES.txt"
