import { useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
addEventListener('popstate', () => subs.forEach((f) => f()));

export function usePath() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => location.pathname,
  );
}

export function go(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  scrollTo(0, 0);
  subs.forEach((f) => f());
}

export function linkProps(path: string) {
  return {
    href: path,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(path);
    },
  };
}
