export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
  const api = { get: add("GET"), post: add("POST"), patch: add("PATCH"), delete: add("DELETE") };

  api.match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const keys = [];
      // Escape regex-special chars in the literal parts of the pattern, but
      // turn :params into capture groups. Splitting on the :param tokens keeps
      // the escape from touching the inserted "([^/]+)" groups.
      const body = r.pattern
        .split(/(:[^/]+)/)
        .map((part) => {
          if (part.startsWith(":")) {
            keys.push(part.slice(1));
            return "([^/]+)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      const rx = new RegExp("^" + body + "$");
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
