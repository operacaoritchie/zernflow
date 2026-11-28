/** Tiny in-memory stand-in for the Supabase client, for tests only. */
type Row = Record<string, unknown>;

export function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const writes: Array<{ table: string; op: "insert" | "update"; values: unknown }> = [];

  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: unknown;
    const filters: Array<(r: Row) => boolean> = [];
    let one: "single" | "maybe" | null = null;

    const exec = () => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((v) => ({ id: `gen-${++seq}`, created_at: "2026-11-28T12:00:00.000Z", updated_at: "2026-11-28T12:00:00.000Z", ...v }));
        rows.push(...made);
        writes.push({ table, op, values: payload });
        return finish(made);
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "delete") {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return finish(hit);
      }
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, payload));
        writes.push({ table, op, values: payload });
      }
      return finish(hit);
    };
    const finish = (list: Row[]) => {
      if (one === "single") return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "row not found" } };
      if (one === "maybe") return { data: list[0] ?? null, error: null };
      return { data: list, error: null };
    };

    const q: Record<string, unknown> = {
      select: () => q,
      insert: (v: unknown) => ((op = "insert"), (payload = v), q),
      delete: () => ((op = "delete"), q),
      update: (v: unknown) => ((op = "update"), (payload = v), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      limit: () => q,
      order: () => q,
      range: () => q,
      single: () => ((one = "single"), q),
      maybeSingle: () => ((one = "maybe"), q),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };

  return { from, tables, writes };
}
