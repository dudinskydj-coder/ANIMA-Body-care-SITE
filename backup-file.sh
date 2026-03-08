#!/bin/zsh

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: ./backup-file.sh <file> [more files...]" >&2
  exit 1
fi

backup_dir="backup"
mkdir -p "$backup_dir"

timestamp="$(TZ=Europe/Berlin date +%Y%m%d_%H%M)"

for target in "$@"; do
  if [ ! -f "$target" ]; then
    echo "Skipping '$target': file not found" >&2
    continue
  fi

  filename="${target:t}"
  extension="${filename:e}"
  basename="${filename:r}"

  if [ -n "$extension" ] && [ "$extension" != "$filename" ]; then
    backup_name="${basename}_${timestamp}.${extension}"
  else
    backup_name="${filename}_${timestamp}"
  fi

  cp "$target" "$backup_dir/$backup_name"
  echo "Created backup: $backup_dir/$backup_name"
done
