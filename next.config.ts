import type { NextConfig } from "next";

const securityHeaders = [
  // The app is never meant to be framed by another site (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // next/image only serves files from /public (the logo). Remote pictures use
  // plain <img>, so no remote host is allowed through the image optimizer.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
