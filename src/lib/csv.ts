// Only parse as much of the CSV as the preview can display.
export function csvPreviewRows(text: string, truncated = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let recordStart = 0;

  function finishField() {
    if (row.length < 24) row.push(field);
    field = "";
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || !field)) {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      finishField();
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishField();
      rows.push(row);
      if (rows.length === 100) return rows;
      row = [];
      recordStart = i + 1;
    } else field += char;
  }

  // A quoted empty field is a record even when its decoded value is empty.
  if (!truncated && recordStart < text.length) {
    finishField();
    rows.push(row);
  }
  return rows;
}
