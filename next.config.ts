import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdfjs-dist resolved at runtime in Node functions to avoid worker/module bundling issues.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
