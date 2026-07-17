"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
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

/** Vertical icon+label rail button (the Canva-style left/right rail item). */
export function RailTabButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-1 rounded-lg py-2.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
      )}
    >
      {badge && <span className="absolute right-2 top-1.5">{badge}</span>}
      {icon}
      <span className="leading-none">{label}</span>
    </button>
  );
}

/** Search input used in panel sticky headers. */
export const SearchField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function SearchField({ className, ...props }, ref) {
  return (
    <div className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
      />
      <input
        ref={ref}
        type="text"
        {...props}
        className={cn(
          "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)]/60",
          className
        )}
      />
    </div>
  );
});

/** Square/rect card used for shape, template, chart, and upload grids. */
export function GridCard({
  onClick,
  children,
  label,
  aspect = "square",
  className,
  disabled,
}: {
  onClick?: () => void;
  children: ReactNode;
  label?: string;
  aspect?: "square" | "wide";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-lg text-center transition-opacity",
        disabled && "cursor-default opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "flex w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] transition-colors",
          aspect === "square" ? "aspect-square" : "aspect-[16/10]",
          !disabled &&
            "group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-light)] group-hover:ring-[var(--accent)]/50"
        )}
      >
        {children}
      </span>
      {label && (
        <span className="truncate text-[11px] text-[var(--text-secondary)]">
          {label}
        </span>
      )}
    </button>
  );
}

/** Empty/"coming soon" state for tabs that don't have a real backend yet. */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-surface)] text-[var(--text-muted)]">
        {icon}
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="max-w-[220px] text-xs text-[var(--text-muted)]">
          {description}
        </p>
      )}
    </div>
  );
}
