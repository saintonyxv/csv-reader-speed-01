// A faster drop-in for csv-reader 1.0.0: run(input) returns csv-reader's exact reading of {text, header} —
// {columns, rows, errors} — with the same broken-row policy, the same errors in the same order, and the same
// values code unit for code unit, but reads the text with bounded indexOf scans, whole-line fast paths and
// slice-built fields instead of one character at a time.
//
// The policy, matched exactly:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and
//     each CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a quote that never closes is a literal
//     character, and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR
//     inside a quoted field counted), row its record's index in rows (null for the header), in the order met.
//
// Every search is bounded to the field, segment or line it inspects: an indexOf over the whole text for a
// character that may not occur again (a quote in a quoteless file, a CR in a CR-less one) would make the
// reader quadratic, so lines and long segments are sliced first and searched inside the slice.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader's answer for one case's input {text, header}, computed faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Line breaks inside the segment most recently read by segment().
  let segBreaks = 0;

  // The text in [a, b) as a quoted field holds it: each CRLF or lone CR becomes one LF. Sets segBreaks to the
  // number of line breaks the segment holds (every LF, CRLF and lone CR counts once).
  function segment(a, b) {
    segBreaks = 0;
    const len = b - a;
    if (len === 0) return '';
    if (len <= 96) {
      // One pass over the range: count the breaks, and build the transformed text only if a CR appears.
      let out = null;
      let piece = a;
      for (let j = a; j < b; j += 1) {
        const c = text.charCodeAt(j);
        if (c === 13) {
          out = (out === null ? text.slice(a, j) : out + text.slice(piece, j)) + '\n';
          segBreaks += 1;
          if (text.charCodeAt(j + 1) === 10) j += 1;
          piece = j + 1;
        } else if (c === 10) {
          segBreaks += 1;
        }
      }
      return out === null ? text.slice(a, b) : out + text.slice(piece, b);
    }
    // A long segment: slice it out and search inside the slice, never the whole text.
    const s = text.slice(a, b);
    if (s.indexOf('\r') === -1) {
      let k = s.indexOf('\n');
      while (k !== -1) {
        segBreaks += 1;
        k = s.indexOf('\n', k + 1);
      }
      return s;
    }
    let out = '';
    let piece = 0;
    for (let j = 0; j < s.length; j += 1) {
      const c = s.charCodeAt(j);
      if (c === 13) {
        out += s.slice(piece, j) + '\n';
        segBreaks += 1;
        if (s.charCodeAt(j + 1) === 10) j += 1;
        piece = j + 1;
      } else if (c === 10) {
        segBreaks += 1;
      }
    }
    return out + s.slice(piece);
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is
  // dropped (stray_cr). Returns the field and how it ended.
  function readUnquoted(value) {
    let i = pos;
    let piece = pos;
    let built = null; // value plus everything kept so far, once a stray CR forces the field into pieces
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        pos = i + 1;
        return { value: (built === null ? value : built) + text.slice(piece, i), ended: COMMA };
      }
      if (c === 10) {
        pos = i + 1;
        line += 1;
        return { value: (built === null ? value : built) + text.slice(piece, i), ended: LINE_BREAK };
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          pos = i + 2;
          line += 1;
          return { value: (built === null ? value : built) + text.slice(piece, i), ended: LINE_BREAK };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        built = (built === null ? value : built) + text.slice(piece, i);
        i += 1;
        piece = i;
        continue;
      }
      i += 1;
    }
    pos = n;
    return { value: (built === null ? value : built) + text.slice(piece, n), ended: END };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    let i = pos + 1;
    let segStart = i;
    let breaks = 0;
    const pieces = [];
    while (true) {
      const q = text.indexOf('"', i);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        // `line` was never touched during the scan (breaks is local), so nothing needs restoring.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        pieces.push(segment(segStart, q));
        breaks += segBreaks;
        pieces.push('"');
        i = q + 2;
        segStart = i;
        continue;
      }
      pieces.push(segment(segStart, q));
      breaks += segBreaks;
      const value = pieces.length === 1 ? pieces[0] : pieces.join('');
      line += breaks;
      pos = q + 1;
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.value.length > value.length) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return junk;
    }
  }

  // Stores one finished record: the first sets the width (and is the header when header is true); later ones
  // are padded (short_row) or cut (long_row) to it.
  function storeRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record sits on one line and no field of it opens a quote. The line is sliced out first
    // and searched inside the slice, so a file without quotes (or without CRs) never pays a whole-text scan.
    // A CR inside the line is a stray CR: dropped, one error each.
    if (text.charCodeAt(pos) !== 34) {
      const nl = text.indexOf('\n', pos);
      const le = nl === -1 ? n : nl;
      let ce = le;
      if (nl !== -1 && ce > pos && text.charCodeAt(ce - 1) === 13) ce -= 1;
      const lineText = text.slice(pos, ce);
      if (lineText.indexOf('"') === -1) {
        const fields = lineText.split(',');
        if (lineText.indexOf('\r') !== -1) {
          for (let f = 0; f < fields.length; f += 1) {
            const fv = fields[f];
            if (fv.indexOf('\r') !== -1) {
              let count = 0;
              for (let k = 0; k < fv.length; k += 1) if (fv.charCodeAt(k) === 13) count += 1;
              for (let k = 0; k < count; k += 1) {
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              }
              fields[f] = fv.split('\r').join('');
            }
          }
        }
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
        // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
        if (fields.length === 1 && fields[0] === '') continue;
        storeRecord(fields);
        continue;
      }
    }

    // General path: field by field.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    storeRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
