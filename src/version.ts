import { createRequire } from "node:module";

/**
 * The server's version, read from package.json at runtime so the MCP handshake,
 * the User-Agent the API sees, and the published npm version can't drift apart
 * (0.1.6 shipped announcing itself as 0.1.5). `dist/version.js` → `../package.json`
 * is the package root both in this repo and inside an npm install.
 */
const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string })
  .version;
