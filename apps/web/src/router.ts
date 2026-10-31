import { useEffect, useState } from "react";

const NAVIGATE_EVENT = "mg:navigate";

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Current pathname, updated on navigate() and browser back/forward. */
export function usePathname(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return path;
}
