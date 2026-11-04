/**
 * CSV Generation with RFC 4180 compliance and spreadsheet formula injection neutralization.
 */

export function toCsv(
  rows: Array<Record<string, string | number | null | undefined>>,
  columns: string[],
): string {
  const sanitize = (raw: string | number | null | undefined): string => {
    if (raw === null || raw === undefined) {
      return '';
    }
    let val = String(raw);

    // Formula injection neutralization:
    // If cell begins with =, +, -, @, \t, or \r, prefix with a single quote (')
    if (/^[=+\-@\t\r]/.test(val)) {
      val = `'${val}`;
    }

    // RFC 4180 quoting:
    // If val contains double quotes, commas, CR, or LF, enclose in double quotes
    // and escape any embedded double quotes by doubling them ("")
    if (/[",\r\n]/.test(val)) {
      val = `"${val.replace(/"/g, '""')}"`;
    }

    return val;
  };

  const header = columns.map((col) => sanitize(col)).join(',');
  const lines = [header];

  for (const row of rows) {
    const line = columns.map((col) => sanitize(row[col])).join(',');
    lines.push(line);
  }

  return lines.join('\r\n') + '\r\n';
}
