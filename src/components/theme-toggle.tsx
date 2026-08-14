"use client";

import { useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  function toggleTheme() {
    const useDarkTheme = !isDark;
    setIsDark(useDarkTheme);
    document.documentElement.dataset.theme = useDarkTheme ? "dark" : "light";
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
      title={isDark ? "Activar modo claro" : "Activar modo oscuro"}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <span className="theme-toggle-label">{isDark ? "Claro" : "Oscuro"}</span>
    </button>
  );
}
