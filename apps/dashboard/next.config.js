// 知识库微前端（Multi-Zones）：KNOWLEDGE_ZONE_URL 指向 ai-knowledge web 时，
// /knowledge/* 转发到该 zone（内嵌 ai-knowledge 原厂知识库 UI）；不设则回落 ai-call
// 自带的 /knowledge mock 页。详见 docs/knowledge-base-microfrontend.md。
const knowledgeZoneUrl = process.env.KNOWLEDGE_ZONE_URL?.replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ai-call/shared'],
  async rewrites() {
    return {
      // beforeFiles 先于本地文件路由匹配 → zone 覆盖 ai-call 自带的 /knowledge 页。
      // 注意：/knowledge/api/* 也走这条转发到 ai-knowledge web，由其自身 rewrite 再到 :9999。
      beforeFiles: knowledgeZoneUrl
        ? [
            { source: '/knowledge', destination: `${knowledgeZoneUrl}/knowledge` },
            { source: '/knowledge/:path*', destination: `${knowledgeZoneUrl}/knowledge/:path*` },
          ]
        : [],
      afterFiles: [
        {
          // 开发环境：浏览器同源 /api/* 代理到 NestJS
          // 生产环境不生效（由 app/api/[...path]/route.ts 接管）
          source: '/api/:path*',
          destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api'}/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
