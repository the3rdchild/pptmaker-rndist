"use client";

import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

const SEEN_KEY = "ppt-maker:onboarding-seen";

const STEPS: DriveStep[] = [
  {
    element: "#onboarding-canvas",
    popover: {
      title: "Welcome to the editor",
      description:
        "This is your slide canvas. Click any text, shape, or image to select and edit it directly.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-sidebar",
    popover: {
      title: "Manage your slides",
      description:
        "Add, duplicate, reorder, lock, or hide slides here. Drag to reorder.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#onboarding-insert-rail",
    popover: {
      title: "Insert & style",
      description:
        "Add elements, text, charts, tables, and images — or open Palette to manage colors and Background to set the slide backdrop.",
      side: "left",
      align: "start",
    },
  },
  {
    element: "#onboarding-ai-assistant",
    popover: {
      title: "AI Assistant",
      description:
        "Chat with AI to generate a whole deck, rewrite text, change fonts/themes, or manage slides — just describe what you want.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-slide-sorter",
    popover: {
      title: "Slide Sorter",
      description: "See every slide at once in a grid — handy for reordering a long deck.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-present",
    popover: {
      title: "Present",
      description: "Go fullscreen and present your deck to an audience.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-export",
    popover: {
      title: "Export",
      description: "Download your finished deck as a .pptx file, ready for PowerPoint.",
      side: "left",
      align: "center",
    },
  },
];

// First-time tour (PRD #28). Runs once per browser (localStorage flag) —
// re-run manually via window.__runOnboardingTour() for debugging/QA.
//
// Module-level (not a ref/state) so React 18 StrictMode's dev-only
// mount→cleanup→remount double-invoke can't reset it between the two
// passes — a ref would, since a cancelled setTimeout plus a fresh ref on
// remount was silently swallowing the tour before it ever opened.
let tourStarted = false;

export default function OnboardingTour({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || tourStarted) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(SEEN_KEY)) return;

    tourStarted = true;
    const markSeen = () => window.localStorage.setItem(SEEN_KEY, "1");

    const tour = driver({
      showProgress: true,
      allowClose: true,
      overlayClickBehavior: "close",
      // Target elements normally already exist by the time `ready` flips
      // true, but give driver.js a window to find them anyway rather than
      // depending on manual setTimeout scaffolding around it.
      steps: STEPS.map((step) => ({ ...step, waitForElement: 1500 })),
      onPopoverRender: (popover) => {
        const skipBtn = document.createElement("button");
        skipBtn.textContent = "Skip";
        skipBtn.className = "driver-popover-skip-btn";
        skipBtn.style.cssText =
          "margin-right:auto;padding:5px 12px;font-size:13px;border-radius:6px;border:1px solid #E4E5E8;background:#fff;color:#666;cursor:pointer;";
        skipBtn.addEventListener("click", () => {
          markSeen();
          tour.destroy();
        });
        popover.footerButtons.insertBefore(skipBtn, popover.footerButtons.firstChild);
      },
      onDestroyed: markSeen,
    });
    tour.drive();

    (window as unknown as { __runOnboardingTour?: () => void }).__runOnboardingTour = () => {
      window.localStorage.removeItem(SEEN_KEY);
      tour.drive();
    };
  }, [ready]);

  return null;
}
