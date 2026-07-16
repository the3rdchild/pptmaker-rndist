"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared visual primitives for the editor chrome (header, sidebars,
 * toolbars, panels). One visual language: surfaces from --bg-* tokens,
 * accent from --accent, elevation from --shadow-* tokens.
 */

type ToolButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  /** Visual weight: ghost (default) blends in, solid gets a filled surface. */
  variant?: "ghost" | "solid" | "accent";
  size?: "sm" | "md";
};

/** Icon (or icon+label) button used across the editor chrome. */
export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(
  function ToolButton(
    { active, variant = "ghost", size = "md", className, ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        {...props}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          size === "sm" ? "h-7 min-w-7 px-1.5 text-xs" : "h-8 min-w-8 px-2 text-xs",
          variant === "accent"
            ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
            : variant === "solid"
              ? active
                ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              : active
                ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
          className
        )}
      />
    );
  }
);

/** Thin divider between control groups. */
export function ToolDivider({
  orientation = "vertical",
  className,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 bg-[var(--border-strong)]",
        orientation === "vertical" ? "h-5 w-px" : "h-px w-full",
        className
      )}
    />
  );
}

/** Elevated popover surface (submenus, pickers, floating panels). */
export function PopPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-pop)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Row inside a PopPanel. */
export function PopItem({
  icon,
  label,
  onClick,
  className,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]",
        className
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Tiny uppercase section label used in panels. */
export function PanelLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]",
        className
      )}
    >
      {children}
    </p>
  );
}
