"use client";

import { useEffect, useMemo, useState } from "react";

import {
  loadAllThemes,
  type TemplateLayout,
  type TemplateTheme,
} from "@/lib/templates/themes";

/** "Show every theme at once" sentinel for the filter chips. */
export const ALL_THEMES = "__all__";

type ThemeState = {
  themes: TemplateTheme[];
  /** Every theme's layouts, flattened and already asset-resolved + tagged. */
  layouts: TemplateLayout[];
  loading: boolean;
};

/** Loads every theme once and keeps the active filter. Shared by the Insert
 *  panel's Templates tab and the sidebar's layout picker so the two can't
 *  drift back into showing different subsets of the library. */
export function useTemplateThemes(initialThemeId: string = ALL_THEMES) {
  const [state, setState] = useState<ThemeState>({
    themes: [],
    layouts: [],
    loading: true,
  });
  const [activeThemeId, setActiveThemeId] = useState(initialThemeId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const themes = await loadAllThemes();
      if (cancelled) return;
      setState({
        themes,
        layouts: themes.flatMap((theme) => theme.layouts),
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleLayouts = useMemo(() => {
    if (activeThemeId === ALL_THEMES) return state.layouts;
    const theme = state.themes.find((t) => t.id === activeThemeId);
    return theme?.layouts ?? [];
  }, [activeThemeId, state.layouts, state.themes]);

  return {
    themes: state.themes,
    loading: state.loading,
    activeThemeId,
    setActiveThemeId,
    visibleLayouts,
  };
}

export function ThemeFilterBar({
  themes,
  activeThemeId,
  onChange,
  includeAll = true,
}: {
  themes: TemplateTheme[];
  activeThemeId: string;
  onChange: (themeId: string) => void;
  includeAll?: boolean;
}) {
  if (themes.length === 0) return null;

  const options = includeAll
    ? [{ id: ALL_THEMES, name: "All", count: themes.reduce((n, t) => n + t.layouts.length, 0) }, ...themes.map((t) => ({ id: t.id, name: t.name, count: t.layouts.length }))]
    : themes.map((t) => ({ id: t.id, name: t.name, count: t.layouts.length }));

  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
      {options.map((option) => {
        const active = option.id === activeThemeId;
        const theme = themes.find((t) => t.id === option.id);
        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            title={theme?.description || undefined}
            className={
              active
                ? "rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white"
                : "rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            }
          >
            {option.name}
            <span className={active ? "ml-1 opacity-70" : "ml-1 opacity-50"}>
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
