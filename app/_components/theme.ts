// The saved theme lives in localStorage (applied before paint by layout.tsx);
// this store lets React render the toggle from it without a sync effect.

export type ThemeChoice = "system" | "light" | "dark";

const listeners = new Set<() => void>();

export const themeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get(): ThemeChoice {
    try {
      const saved = window.localStorage.getItem("jobagent:theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  },
  server(): ThemeChoice {
    return "system";
  },
  set(next: ThemeChoice) {
    try {
      if (next === "system") window.localStorage.removeItem("jobagent:theme");
      else window.localStorage.setItem("jobagent:theme", next);
    } catch {}
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    listeners.forEach((listener) => listener());
  },
};
