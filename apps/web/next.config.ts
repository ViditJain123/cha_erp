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
    // The tariff master is ~12,000 rows parsed from the printed tariff and read
    // off disk as JSON (packages/core/src/masters/tariff-book.ts), for the same
    // reason as the template: it is too big to be a TypeScript literal, and a
    // readFileSync is invisible to tracing. Every route that touches a tariff
    // row needs it — draft building, the masters page, job views — so it is
    // included everywhere rather than named route by route. Leaving it out does
    // not fail loudly: the loader falls back to the three-row seed, and every
    // invoice line goes back to "BCD rate needs manual entry".
    '/**': ['../../packages/core/src/masters/generated/tariff-book/*.json'],
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
