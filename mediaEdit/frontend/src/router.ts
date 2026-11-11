import { useEffect, useState } from "react";

// 极简 History 路由：不引入 react-router，避免为两个页面增加依赖。
export type Route = { view: "home" } | { view: "editor"; projectId: string };

const NAV_EVENT = "me:navigate";

export function parseRoute(path: string = window.location.pathname): Route {
  const m = /^\/project\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (m) return { view: "editor", projectId: m[1] };
  return { view: "home" };
}

export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

export function editorPath(id: string): string {
  return `/project/${id}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAV_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAV_EVENT, onChange);
    };
  }, []);
  return route;
}
