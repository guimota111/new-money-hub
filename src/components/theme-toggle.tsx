"use client";

// Alterna claro/escuro gravando em data-theme + localStorage. Os dois ícones
// são renderizados sempre e o CSS (globals) mostra só o do tema ativo — assim
// o server render não precisa saber o tema e não há erro de hidratação.
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // navegação anônima etc. — o tema vale só para a sessão
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Alternar tema claro/escuro"
      aria-label="Alternar tema claro/escuro"
      className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:text-zinc-950 dark:border-zinc-700 dark:hover:text-zinc-50"
    >
      <span className="theme-icon-light">🌙</span>
      <span className="theme-icon-dark">☀️</span>
    </button>
  );
}
