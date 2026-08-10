import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship raw TypeScript, so Next has to compile them.
  // @checklist/library was previously missing here and only survived on the
  // extensionAlias hack below.
  transpilePackages: [
    '@checklist/core',
    '@checklist/extraction',
    '@checklist/library',
    '@checklist/config',
    '@checklist/db',
    '@checklist/mail',
    '@checklist/graph',
    '@checklist/ingest',
    '@checklist/exporter',
  ],
  serverExternalPackages: ['playwright'],
  // The exporter reads the vendor's ImportXLSXTemplate.xlsx off disk and
  // splices rows into it. File tracing does not see a readFileSync of a
  // non-imported asset, so it has to be named — otherwise the export route
  // deploys without its template and throws on first use.
  outputFileTracingIncludes: {
    '/api/jobs/[id]/export': ['../../packages/exporter/templates/**'],
  },
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
