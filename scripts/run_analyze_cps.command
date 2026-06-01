#!/bin/bash
# Double-clickable launcher for analyze_cps.js on macOS.
#
# Usage:
#   1. Drop this file AND analyze_cps.js into a folder next to your exported CSVs
#      (localizations*.csv, optionally config.csv / segments.csv / voices.csv).
#   2. Double-click this file.
#   3. macOS opens Terminal, runs the script with zero args (script auto-discovers
#      the CSVs in its directory), and pauses at the end so the report stays
#      visible.
#
# First run gotcha: macOS Gatekeeper may block the file because it doesn't have
# a developer signature. Right-click → Open → confirm in the dialog. Subsequent
# double-clicks work without prompt.
#
# Requires Node.js on PATH. If `node` is missing, install from https://nodejs.org/
# or via Homebrew (`brew install node`).

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is not on your PATH."
  echo "Install Node.js from https://nodejs.org/ (or 'brew install node') and try again."
  echo ""
  read -p "Press Enter to close..." _
  exit 1
fi

node "$(dirname "$0")/analyze_cps.js"

echo ""
echo "----------------------------------------"
read -p "Press Enter to close..." _
