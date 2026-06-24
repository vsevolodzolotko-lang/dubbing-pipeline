// Header-driven Google-Sheets `values` parsers, extracted from snapshot.js so the
// live snapshot poller AND offline consumers (the Tuning run-history backfill)
// parse the same arrays identically. Row 0 is the header; secrets are NOT masked
// here (callers decide). Pure — no Google calls.

export function parseKeyValue(rows) {
  const map = new Map()
  for (const r of (rows || []).slice(1)) {
    if (!r || r[0] == null || r[0] === '') continue
    map.set(String(r[0]).trim(), r[1] ?? '')
  }
  return map
}

/** Header-driven: row 0 is the header, every data row becomes {header: value}. */
export function parseTable(rows) {
  if (!rows || rows.length === 0) return { header: [], index: new Map(), objects: [] }
  const header = rows[0].map((h) => String(h ?? '').trim())
  const index = new Map(header.map((h, i) => [h, i]))
  const objects = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === '' || c == null)) continue
    const o = {}
    for (let c = 0; c < header.length; c++) if (header[c]) o[header[c]] = r[c] ?? ''
    objects.push(o)
  }
  return { header, index, objects }
}
