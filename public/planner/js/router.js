const routes = new Set(["today", "tasks", "subjects", "focus", "settings"]);

export function readLocation() {
  const [routePart, queryPart = ""] = window.location.hash.slice(1).split("?");
  const route = routes.has(routePart) ? routePart : "today";
  return { route, query: new URLSearchParams(queryPart) };
}

export function navigate(route, query = new URLSearchParams()) {
  if (!routes.has(route)) throw new Error(`Unknown Daybreak route: ${route}`);
  const suffix = query.toString();
  const hash = `#${route}${suffix ? `?${suffix}` : ""}`;
  if (window.location.hash === hash) {
    window.dispatchEvent(new CustomEvent("daybreak:navigate"));
    return;
  }
  window.location.hash = hash;
}

export function onRouteChange(callback) {
  const handler = () => callback(readLocation());
  window.addEventListener("hashchange", handler);
  window.addEventListener("daybreak:navigate", handler);
  return () => {
    window.removeEventListener("hashchange", handler);
    window.removeEventListener("daybreak:navigate", handler);
  };
}
