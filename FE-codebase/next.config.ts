import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app. Left to inference, Next picks the
  // directory of the highest lockfile it finds above this one — a stray
  // lockfile at the repo root once made Turbopack watch the whole repo
  // (api/, worker/, .worktrees/ with their node_modules junctions), which
  // exhausted memory on startup and spawned PostCSS workers until the
  // machine fell over.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
