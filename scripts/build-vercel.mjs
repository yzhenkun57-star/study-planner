import { spawnSync } from "node:child_process";

// Use the package-manager shim so this works in PowerShell, cmd.exe, CI, and
// Vercel's Linux build image without relying on shell-specific env syntax.
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(packageManager, ["exec", "vite", "build"], {
  env: { ...process.env, NITRO_PRESET: "vercel" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
