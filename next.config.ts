import type { NextConfig } from "next";

/** The dashboard reuses the ledger/trail code in src/, which imports `./x.js` for `./x.ts` (Node ESM style). */
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;
