// A tiny in-memory stand-in for the Supabase client, for unit tests of
// server helpers (lib/server/*). Supports the query shapes those helpers
// use: from(t).select / insert / update / delete with eq, neq, is, in,
// not(col,'in','(a,b)'), or('a.eq.x,b.eq.y'), lt, maybeSingle, single,
// and .select() after a write (returns the changed rows). rpc() calls a
// handler you pass in. Never imported by the app itself.

function parseList(v) {
  return String(v)
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function orMatches(row, expr) {
  return expr.split(',').some((part) => {
    const [col, op, ...rest] = part.split('.');
    const val = rest.join('.');
    if (op === 'eq') return String(row[col]) === val;
    if (op === 'in') return parseList(val).includes(String(row[col]));
    return false;
  });
}

export function fakeSupabase(tables = {}, { rpc = {}, failOn = {} } = {}) {
  const db = {};
  for (const [t, rows] of Object.entries(tables)) db[t] = rows.map((r) => ({ ...r }));
  const calls = [];

  function query(table) {
    const filters = [];
    let op = 'select';
    let payload = null;
    let returning = false;
    let single = null;

    const api = {
      select() {
        if (op !== 'select') returning = true;
        return api;
      },
      insert(rows) {
        op = 'insert';
        payload = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      update(obj) {
        op = 'update';
        payload = obj;
        return api;
      },
      delete() {
        op = 'delete';
        return api;
      },
      eq: (c, v) => (filters.push((r) => r[c] === v), api),
      neq: (c, v) => (filters.push((r) => r[c] !== v), api),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), api),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), api),
      lt: (c, v) => (filters.push((r) => r[c] < v), api),
      not: (c, o, v) => (filters.push((r) => (o === 'in' ? !parseList(v).includes(String(r[c])) : r[c] !== v)), api),
      or: (expr) => (filters.push((r) => orMatches(r, expr)), api),
      maybeSingle: () => ((single = 'maybe'), api),
      single: () => ((single = 'one'), api),
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function run() {
      calls.push({ table, op, payload });
      const fail = failOn[`${table}.${op}`];
      if (fail) {
        const e = typeof fail === 'function' ? fail(payload) : fail;
        if (e) return { data: null, error: e };
      }
      const rows = (db[table] = db[table] || []);
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      let data;
      if (op === 'select') data = hit.map((r) => ({ ...r }));
      else if (op === 'insert') {
        const added = payload.map((r) => ({ id: r.id || `id${rows.length + 1}`, ...r }));
        rows.push(...added);
        data = returning ? added : null;
      } else if (op === 'update') {
        hit.forEach((r) => Object.assign(r, payload));
        data = returning ? hit.map((r) => ({ ...r })) : null;
      } else if (op === 'delete') {
        db[table] = rows.filter((r) => !hit.includes(r));
        data = returning ? hit : null;
      }
      if (single) {
        if (data.length > 1) return { data: null, error: { message: 'more than one row' } };
        if (single === 'one' && data.length === 0) return { data: null, error: { message: 'no rows' } };
        data = data[0] || null;
      }
      return { data, error: null };
    }

    return api;
  }

  return {
    db,
    calls,
    from: query,
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      const h = rpc[name];
      if (!h) return { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } };
      return h(args, db);
    },
  };
}
