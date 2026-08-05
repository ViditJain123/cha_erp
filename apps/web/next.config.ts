import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@checklist/core', '@checklist/extraction'],
  serverExternalPackages: ['playwright'],
  webpack: (config) => {
    // workspace packages use NodeNext ".js" specifiers for .ts sources
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
};

export default nextConfig;
