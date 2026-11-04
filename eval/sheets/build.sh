#!/usr/bin/env bash
# Compile the exercise sheets in this folder and run Paper Tour's ingestion on each PDF.
#
#   eval/sheets/build.sh                                    build every sheet, one after the other
#   eval/sheets/build.sh physics-mechanics-en linalg-de     build only these slugs
#
# For every <slug>.tex: pdflatex (twice, niced) in eval/sheets/.build/<slug>/, then the PDF is copied to
# demo/local-sheet-<slug>/paper.pdf and ingested into that folder (demo/local-*/ is gitignored).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
python="$root/ingest/.venv/bin/python"
build="$here/.build"

if [ "$#" -gt 0 ]; then
  slugs=("$@")
else
  slugs=()
  for f in "$here"/*.tex; do slugs+=("$(basename "$f" .tex)"); done
fi

failed=()
for slug in "${slugs[@]}"; do
  src="$here/$slug.tex"
  if [ ! -f "$src" ]; then
    echo "no such sheet: $slug" >&2
    failed+=("$slug")
    continue
  fi
  echo "=== $slug"
  mkdir -p "$build/$slug"
  ok=1
  # twice, for references; run from eval/sheets so that relative inputs would resolve
  for pass in 1 2; do
    if ! (cd "$here" && nice -n 15 pdflatex -interaction=nonstopmode -halt-on-error \
          -output-directory "$build/$slug" "$slug.tex" > "$build/$slug/pass$pass.out" 2>&1); then
      echo "pdflatex failed (pass $pass), see $build/$slug/pass$pass.out" >&2
      ok=0
      break
    fi
  done
  if [ "$ok" != 1 ]; then
    failed+=("$slug")
    continue
  fi

  out="$root/demo/local-sheet-$slug"
  mkdir -p "$out"
  cp "$build/$slug/$slug.pdf" "$out/paper.pdf"
  if ! nice -n 15 "$python" "$root/ingest/ingest.py" "$out/paper.pdf" --out "$out" > "$build/$slug/ingest.out" 2>&1; then
    echo "ingestion failed, see $build/$slug/ingest.out" >&2
    failed+=("$slug")
    continue
  fi
  echo "ok: $out"
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
