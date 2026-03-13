/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: []
  },
  outputFileTracingIncludes: {
    "/lanes/[slug]": [
      "./data/**",
      "./schemas/**",
      "./config/**"
    ]
  }
};

export default nextConfig;
