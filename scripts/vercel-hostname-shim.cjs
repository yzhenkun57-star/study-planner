/* eslint-disable @typescript-eslint/no-require-imports, no-control-regex */
// Vercel CLI sends the local hostname in an ASCII request header. On Windows
// machines with a Chinese hostname that can throw a ByteString conversion
// error before the login flow starts. Keep the workaround process-local.
const os = require("node:os");

const originalHostname = os.hostname;
os.hostname = () => {
  const value = originalHostname();
  return /^[\x00-\x7F]*$/.test(value) ? value : "codex-host";
};
