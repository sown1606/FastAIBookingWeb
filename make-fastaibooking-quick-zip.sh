#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-fastaibooking-current-state.zip}"
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT

# Phải chạy trong Git repo.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Lỗi: hãy chạy script tại root repo FastAIBooking." >&2
  exit 1
}

rm -f "$OUT"

echo "Đang lập danh sách source và log Codex..."

# Source tracked + untracked, nhưng bỏ dependency, build output, secret và binary lớn.
{
  git ls-files -co --exclude-standard \
    | grep -Eiv '(^|/)(node_modules|\.git|\.idea|\.vscode|\.cursor|\.continue|\.agents|\.turbo|\.next|\.vercel|coverage|dist|build|logs|Trash|secrets)(/|$)' \
    | grep -Eiv '(^|/)\.DS_Store$|(^|/)\.env($|\.)|(^|/)FastAIBooking_Postman_Environment\.json$|(^|/)firebase-notification-setup\.local\.md$' \
    | grep -Eiv '\.(zip|7z|rar|tar|tgz|gz|pem|p12|pfx|key|crt|cer|cert|jks|keystore|db|sqlite|sqlite3|png|jpg|jpeg|gif|webp|ico|bmp|tiff|mp3|mp4|m4a|aac|wav|flac|ogg|webm|mov|avi|mkv)$' \
    || true
} > "$LIST"

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

echo "Đang nén nhanh $COUNT file..."
# -1 = nén nhanh; -@ = đọc danh sách file từ stdin.
zip -q -1 -@ "$OUT" < "$LIST"

echo "Xong: $OUT"
du -h "$OUT"
