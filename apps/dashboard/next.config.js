/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ai-call/shared'],
  async rewrites() {
    return [
      {
        // 开发环境：浏览器同源 /api/* 代理到 NestJS
        // 生产环境不生效（由 app/api/[...path]/route.ts 接管）
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
