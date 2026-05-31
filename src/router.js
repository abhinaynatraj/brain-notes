export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const api = { get: add("GET"), post: add("POST"), patch: add("PATCH"), delete: add("DELETE") };

  api.match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const keys = [];
      const rx = new RegExp("^" + r.pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) + "$");
      const m = pathname.match(rx);
      if (m) {
        const params = {};
        keys.forEach((k, i) => (params[k] = m[i + 1]));
        return { handler: r.handler, params };
      }
    }
    return null;
  };
  return api;
}
