// Market overview filters: number parsing with K/M/B/T suffixes, min/max ranges, sorting and a
// small safe condition language over table columns (no eval). Tested in dev/tests/market-filter.test.ts.
//
//   change > 5 and volume >= 10M
//   (mcap > 1B or name contains "usd") and not exchange = okx
//   price between 1 and 10

export type Cell = number | string | null;
export type Row = Record<string, Cell>;

export interface ColumnDef {
  key: string;
  label: string;
  kind: "text" | "num" | "pct" | "usd" | "price";
  /** Other names the condition language accepts for this column. */
  aliases?: string[];
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** "1.5B" → 1.5e9, "250k" → 250000, "-3%" → -3, "" → null. */
export function parseAmount(text: string): number | null {
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([kmbt])?\s*%?\s*$/i.exec(text.replace(/[,_$]/g, ""));
  if (!m) return null;
  return Number(m[1]) * (m[2] ? SUFFIX[m[2].toLowerCase()]! : 1);
}

/** Keep rows whose `key` is within [min, max]; a null bound is open. Rows without a value fail a set bound. */
export function inRange(row: Row, key: string, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  const v = row[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return (min === null || v >= min) && (max === null || v <= max);
}

/** Sort a copy by one column; empty cells always go last. */
export function sortRows<T extends Row>(rows: T[], key: string, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const xe = x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x));
    const ye = y === null || y === undefined || (typeof y === "number" && !Number.isFinite(y));
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y)) * sign;
  });
}

// ── Condition language ────────────────────────────────────

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "word"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" };

const OPS = [">=", "<=", "!=", "==", ">", "<", "=", "&&", "||", "!"];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c, v: c } as Token);
      i++;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: "op", v: op });
      i += op.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unclosed quote at ${i + 1}`);
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?[kmbt]?%?(?![\w.])/i.exec(src.slice(i));
    if (num && /\d/.test(num[0])) {
      out.push({ t: "num", v: parseAmount(num[0])! });
      i += num[0].length;
      continue;
    }
    const word = /^[\w.\-/]+/.exec(src.slice(i));
    if (word) {
      out.push({ t: "word", v: word[0] });
      i += word[0].length;
      continue;
    }
    throw new Error(`Unexpected "${c}" at ${i + 1}`);
  }
  return out;
}

type Pred = (row: Row) => boolean;
const WORD_OPS: Record<string, string> = { and: "&&", or: "||", not: "!" };
const TEXT_OPS = new Set(["contains", "startswith", "endswith", "between"]);

/**
 * Compile a condition into a row predicate. Throws an Error with a readable message on bad input.
 * An empty condition matches every row.
 */
export function compileCondition(src: string, columns: ColumnDef[]): Pred {
  const tokens = tokenize(src);
  if (!tokens.length) return () => true;
  const names = new Map<string, string>();
  for (const c of columns) {
    names.set(c.key.toLowerCase(), c.key);
    names.set(c.label.toLowerCase().replace(/\s+/g, ""), c.key);
    for (const a of c.aliases ?? []) names.set(a.toLowerCase(), c.key);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const tk = peek();
    return (tk?.t === "op" && tk.v === v) || (tk?.t === "word" && WORD_OPS[tk.v.toLowerCase()] === v);
  };

  function value(): number | string {
    const tk = tokens[pos++];
    if (!tk) throw new Error("A value is missing at the end");
    if (tk.t === "num" || tk.t === "str" || tk.t === "word") return tk.v;
    throw new Error(`Expected a value, found "${tk.v}"`);
  }

  function comparison(): Pred {
    const tk = tokens[pos++];
    if (!tk || tk.t !== "word") throw new Error(tk ? `Expected a column name, found "${tk.v}"` : "Expected a column name");
    const key = names.get(tk.v.toLowerCase().replace(/\s+/g, ""));
    if (!key) throw new Error(`Unknown column "${tk.v}". Columns: ${columns.map((c) => c.key).join(", ")}`);
    const opTk = tokens[pos++];
    const op = opTk?.t === "op" ? opTk.v : opTk?.t === "word" && TEXT_OPS.has(opTk.v.toLowerCase()) ? opTk.v.toLowerCase() : null;
    if (!op || op === "&&" || op === "||" || op === "!") throw new Error(`Expected >, <, =, != or contains after "${tk.v}"`);
    const rhs = value();
    if (op === "between") {
      const and = tokens[pos++];
      if (!and || !(and.t === "word" && and.v.toLowerCase() === "and") && !(and.t === "op" && and.v === "&&")) {
        throw new Error('Write "between 1 and 10"');
      }
      const hi = value();
      if (typeof rhs !== "number" || typeof hi !== "number") throw new Error("between needs two numbers");
      return (row) => typeof row[key] === "number" && (row[key] as number) >= rhs && (row[key] as number) <= hi;
    }
    return (row) => {
      const v = row[key];
      if (v === null || v === undefined) return op === "!=";
      if (op === "contains" || op === "startswith" || op === "endswith") {
        const s = String(v).toLowerCase();
        const r = String(rhs).toLowerCase();
        return op === "contains" ? s.includes(r) : op === "startswith" ? s.startsWith(r) : s.endsWith(r);
      }
      if (typeof v === "number" && typeof rhs === "number") {
        switch (op) {
          case ">": return v > rhs;
          case ">=": return v >= rhs;
          case "<": return v < rhs;
          case "<=": return v <= rhs;
          case "=": case "==": return v === rhs;
          case "!=": return v !== rhs;
        }
      }
      const a = String(v).toLowerCase();
      const b = String(rhs).toLowerCase();
      switch (op) {
        case "=": case "==": return a === b;
        case "!=": return a !== b;
        case ">": return a > b;
        case ">=": return a >= b;
        case "<": return a < b;
        case "<=": return a <= b;
      }
      return false;
    };
  }

  function unary(): Pred {
    if (isOp("!")) {
      pos++;
      const inner = unary();
      return (row) => !inner(row);
    }
    if (peek()?.t === "(") {
      pos++;
      const inner = or();
      if (peek()?.t !== ")") throw new Error("Missing )");
      pos++;
      return inner;
    }
    return comparison();
  }

  function and(): Pred {
    let left = unary();
    while (isOp("&&")) {
      pos++;
      const l = left;
      const r = unary();
      left = (row) => l(row) && r(row);
    }
    return left;
  }

  function or(): Pred {
    let left = and();
    while (isOp("||")) {
      pos++;
      const l = left;
      const r = and();
      left = (row) => l(row) || r(row);
    }
    return left;
  }

  const pred = or();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos]!.v}" — join conditions with and / or`);
  return pred;
}

/** Percent change between the closes at or before two times (seconds), or null without data. */
export function changeBetween(closes: Array<[number, number]>, fromSec: number, toSec: number): number | null {
  const at = (t: number) => {
    let found: number | null = null;
    for (const [time, close] of closes) {
      if (time <= t) found = close;
      else break;
    }
    return found;
  };
  const a = at(fromSec) ?? closes[0]?.[1] ?? null;
  const b = at(toSec);
  if (a === null || b === null || a <= 0) return null;
  return ((b - a) / a) * 100;
}
