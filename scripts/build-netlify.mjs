import { spawnSync } from "node:child_process";

// Use the package-manager shim so the same script works in PowerShell,
// cmd.exe, CI Linux containers, and Netlify's build image.
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(packageManager, ["exec", "vite", "build"], {
  env: { ...process.env, NITRO_PRESET: "netlify" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
