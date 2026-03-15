/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': ['./.data/**/*'],
  },
  turbopack: {},
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],
  webpack(config) {
    // Force the client runtime to use globalThis directly so the emitted
    // bootstrap does not fall back to Function("return this") under CSP.
    if (!config.output) config.output = {}
    config.output.globalObject = 'globalThis'
    return config
  },
  
  // Security headers
  // Content-Security-Policy is set in src/proxy.ts with a per-request nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.MC_ENABLE_HSTS === '1' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
          ] : []),
        ],
      },
    ];
  },
  
};

module.exports = nextConfig;
