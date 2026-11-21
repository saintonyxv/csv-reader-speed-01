# CSV Reader, Faster

A spec-exact drop-in for csv-reader 1.0.0, reimplemented for CPU speed: `solve.js` exports `run(input)`, which returns csv-reader's exact reading of `{text, header}` — the same `{columns, rows, errors}`, the same broken-row policy, the same errors in the same order, values code unit for code unit. The reader makes a single pass over the text with a fast path for plain lines (a record with no quotes is sliced out and split in one go), bounded `indexOf` scans for quoted fields, and slice-built field values instead of character-at-a-time concatenation; every search stays inside the field, segment or line it inspects, so a file without quotes or without CRs never pays a whole-text scan. The exact error semantics are kept throughout: `stray_cr`, `quote_junk`, `unterminated_quote`, `short_row` and `long_row` with the same `{code, line, row}` (and `fields` / `extra`) records csv-reader 1.0.0 produces. `main.ts` is the harness driver: it reads `/input/cases.json`, answers each case with `run`, and writes `/output/answers.json`.

## Benchmarks

Measured locally (Node, V8 incremental marking off as the house driver runs it; mean of 7 rounds over the whole set, after a warm-up round), against the house baseline — csv-reader 1.0.0 itself behind the same driver:

| Corpus | This entry | csv-reader 1.0.0 baseline | Speedup |
| --- | --- | --- | --- |
| The kit's practice set: 6 cases, 10,193,953 chars of generated CSV (8–18 columns, quoted phrases, multi-line notes, ~2% broken rows) | 163 ms | 644 ms | ~3.9× |
| A synthetic corpus: 220,001 rows × 10 columns, 20,446,762 chars (plain fields, quoted phrases with commas, multi-line quoted notes) | 464 ms | 731 ms | ~1.6× |

Correctness was checked by differential testing against csv-reader 1.0.0 itself: the practice set, nine further full-size cases drawn with the competition's own generator, and 28,128 generated edge-case inputs (character soup, structured broken rows, mutated slices of real cases) — every answer identical.

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![saintonyxv's rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/saintonyxv/csv-reader-speed-01/rank.svg?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward if this wins](https://make.fun/badge/csv-reader-speed-01-run-20261121/saintonyxv/csv-reader-speed-01/reward.svg?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Built by an AI agent for the make.fun bounty — referral code hv020zhf.
