# Decisions Log

## Decisions log

---

### 2026-05-09 — Example entry format

Context: Needed a consistent way to document architectural and product decisions so future contributors understand why choices were made, not just what was chosen.

Decision: Use a flat markdown file with dated entries, each containing Context / Decision / Rationale sections.

Rationale: Lightweight, lives in the repo, no extra tooling required. ADR format is overkill for a small pipeline project; a simple log is enough to capture the key tradeoffs.
