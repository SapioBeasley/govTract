import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium resolves its compressed runtime assets relative to its
  // installed package directory. Keep it external so Next/Vercel does not inline
  // the module and lose that runtime path relationship.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],

  // Native/browser assets referenced through runtime __dirname lookups are not
  // always discovered by output file tracing. Scope the explicit include to the
  // Beacon connection function rather than copying Chromium into every route.
  outputFileTracingIncludes: {
    "/api/admin/source-connections/beacon": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
