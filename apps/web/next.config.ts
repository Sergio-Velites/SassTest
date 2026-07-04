import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output → small container image for Cloud Run (ADR-0008).
  output: 'standalone',
};

export default nextConfig;
