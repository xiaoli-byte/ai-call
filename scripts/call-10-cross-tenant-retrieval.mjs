#!/usr/bin/env node
/**
 * CALL-10 · 跨仓真隔离联调实测（ai-call ↔ ai-knowledge）
 *
 * 目的：在真实运行的 ai-knowledge 上验证 CALL-06 的租户隔离检索链路。
 *   - 【安全·必过】租户 A 的通话检索不返回租户 B 的文档（visibleDocumentWhereSql 生效）
 *   - 【鉴权·必过】缺/错 X-Service-Token、缺 X-Tenant-Id、缺 X-User-Id 均被拒
 *   - 【契约·探针】knowledgeBaseId 是否被 ai-knowledge 采纳（当前实现为 no-op，见运行手册）
 *
 * 这个脚本**不做数据播种**（fixtures 与环境强相关）。运行前需按
 * `docs/testing/call-10-cross-tenant-retrieval.md` 准备两个租户各一篇文档：
 *   - 两篇都含共享检索词 QUERY_SHARED（否则跨租户命中无从谈起）
 *   - 各自含租户专属标记 MARKER_A / MARKER_B（用于判断结果归属）
 *
 * 依赖：Node ≥ 18（用全局 fetch），零 npm 依赖。
 * 运行：node scripts/call-10-cross-tenant-retrieval.mjs
 * 退出码：任一【必过】断言失败 → 非 0；仅探针 WARN → 0。
 */

// ───────────────────────────── 配置（全部可用环境变量覆盖）─────────────────────────────
const cfg = {
  // 服务地址（含 /api 前缀）
  aiCallBase: env('AI_CALL_BASE', 'http://127.0.0.1:3001/api'),
  aiKnowledgeBase: env('AI_KNOWLEDGE_BASE', 'http://127.0.0.1:3010/api'),

  // 令牌：
  //  - knowledgeToken = ai-knowledge 入站 SERVICE_API_TOKEN（也即 ai-call 的 KNOWLEDGE_SERVICE_API_TOKEN）
  //  - aiCallToken    = ai-call 入站 SERVICE_API_TOKEN（voice-agent 打 ai-call 用；默认同 knowledgeToken）
  knowledgeToken: env('SERVICE_API_TOKEN', ''),
  aiCallToken: env('AI_CALL_SERVICE_TOKEN', process.env.SERVICE_API_TOKEN || ''),

  // 两个租户 / 用户（须与 fixtures 一致）
  tenantA: env('TENANT_A', 'tenant-a'),
  userA: env('USER_A', 'user-a'),
  tenantB: env('TENANT_B', 'tenant-b'),
  userB: env('USER_B', 'user-b'),

  // ai-call 侧知识库 id（scenario.knowledgeBaseId），透传给 ai-knowledge
  kbId: env('KB_ID', 'kb-collection'),
  // 同一租户 A 下的另一个知识库 id，用于 knowledgeBaseId 作用域探针（可选）
  kbIdOther: env('KB_ID_OTHER', ''),

  // fixtures 约定
  queryShared: env('QUERY_SHARED', 'SHAREDTERM'),
  markerA: env('MARKER_A', 'ALPHAMARK'),
  markerB: env('MARKER_B', 'BETAMARK'),
  topK: Number(env('TOP_K', '5')),

  // ai-knowledge 是否配置了 SERVICE_API_TOKEN（决定“缺令牌应被拒”类断言是否适用；
  // dev 下未配则 guard fail-open，相关断言自动跳过）
};

// ───────────────────────────── 轻量测试运行器 ─────────────────────────────
let pass = 0;
let fail = 0;
let warn = 0;
let skip = 0;
const fails = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  \x1b[31mx\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function warnMsg(name, detail = '') {
  warn++;
  console.log(`  \x1b[33m⚠\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function skipMsg(name, detail = '') {
  skip++;
  console.log(`  \x1b[90m∅ skip\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

// ───────────────────────────── HTTP 帮助函数 ─────────────────────────────
async function post(url, body, headers) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text };
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: String(err?.message || err) };
  }
}

/** ai-knowledge /search/retrieve 直连 */
function retrieveKnowledge({ query, tenantId, userId, token, kbId, tags }) {
  const headers = {};
  if (token) headers['x-service-token'] = token;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (userId) headers['x-user-id'] = userId;
  const body = { q: query, mode: 'hybrid', topK: cfg.topK };
  if (kbId) body.knowledgeBaseId = kbId; // 当前实现会被 zod 剥离——探针用
  if (tags) body.tags = tags;
  return post(`${cfg.aiKnowledgeBase}/search/retrieve`, body, headers);
}

/** 端到端：voice-agent → ai-call /knowledge-base/:id/retrieve */
function retrieveViaAiCall({ query, tenantId, userId, token, kbId }) {
  const headers = {};
  if (token) headers['x-service-token'] = token;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (userId) headers['x-user-id'] = userId;
  return post(
    `${cfg.aiCallBase}/knowledge-base/${encodeURIComponent(kbId)}/retrieve`,
    { query, topK: cfg.topK },
    headers,
  );
}

// hits 归一：直连返回 {hits:[{text,documentTitle,documentId}]}；经 ai-call 返回 {results:[{content,source,id}]}
function extractDocs(json) {
  const arr = json?.hits ?? json?.results ?? [];
  return arr.map((h) => ({
    id: h.documentId ?? h.id ?? h.chunkId ?? '',
    text: `${h.text ?? h.content ?? ''}`,
    title: `${h.documentTitle ?? h.source ?? ''}`,
  }));
}
function blob(docs) {
  return docs.map((d) => `${d.title}\n${d.text}`).join('\n').toUpperCase();
}
function contains(docs, marker) {
  return blob(docs).includes(marker.toUpperCase());
}

// ───────────────────────────── 断言场景 ─────────────────────────────
async function main() {
  printConfig();

  const knowledgeGuardArmed = Boolean(cfg.knowledgeToken);
  const aiCallGuardArmed = Boolean(cfg.aiCallToken);

  // ========== 场景 1：ai-knowledge /search/retrieve 直连 —— 租户隔离核心 ==========
  section('【1】ai-knowledge /search/retrieve 直连 — 租户隔离');

  const kA = await retrieveKnowledge({
    query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: cfg.knowledgeToken, kbId: cfg.kbId,
  });
  const kB = await retrieveKnowledge({
    query: cfg.queryShared, tenantId: cfg.tenantB, userId: cfg.userB, token: cfg.knowledgeToken, kbId: cfg.kbId,
  });
  const docsA = extractDocs(kA.json);
  const docsB = extractDocs(kB.json);

  ok('1.0 A 检索返回 200', kA.status === 200, `status=${kA.status}`);
  ok('1.0 B 检索返回 200', kB.status === 200, `status=${kB.status}`);
  // fixtures 就绪性：A 的共享词查询必须至少命中 A 的文档，否则隔离测试无意义
  ok('1.1 A 查询命中非空（fixtures/索引就绪）', docsA.length > 0, `hits=${docsA.length}`);
  // 软检查：依赖分块/分词，命中的 chunk 未必是含标记的那段，故 WARN 不阻断
  if (contains(docsA, cfg.markerA)) ok('1.2 A 结果含自身标记 MARKER_A', true);
  else warnMsg('1.2 A 结果未见 MARKER_A', '可能是分块把 SHAREDTERM 与 MARKER_A 拆到不同 chunk；建议 fixtures 用短文档');
  // 【安全·必过】A 的结果绝不含 B 的标记
  ok('1.3 [安全] A 结果不含 MARKER_B', !contains(docsA, cfg.markerB));
  ok('1.4 [安全] B 结果不含 MARKER_A', !contains(docsB, cfg.markerA));
  // 更强：A/B 命中的 documentId 集合不相交
  const idsA = new Set(docsA.map((d) => d.id).filter(Boolean));
  const idsB = new Set(docsB.map((d) => d.id).filter(Boolean));
  const overlap = [...idsA].filter((x) => idsB.has(x));
  ok('1.5 [安全] A/B 命中文档 id 不相交', overlap.length === 0, overlap.length ? `overlap=${overlap.join(',')}` : '');

  // ========== 场景 2：ai-knowledge 鉴权边界 ==========
  section('【2】ai-knowledge 服务鉴权边界');
  if (knowledgeGuardArmed) {
    const noToken = await retrieveKnowledge({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: '', kbId: cfg.kbId });
    ok('2.1 [鉴权] 缺 X-Service-Token → 401', noToken.status === 401, `status=${noToken.status}`);
    const badToken = await retrieveKnowledge({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: `${cfg.knowledgeToken}-WRONG`, kbId: cfg.kbId });
    ok('2.2 [鉴权] 错误 X-Service-Token → 401', badToken.status === 401, `status=${badToken.status}`);
  } else {
    skipMsg('2.1/2.2 缺/错令牌断言', 'ai-knowledge 未配 SERVICE_API_TOKEN（dev fail-open），设置 SERVICE_API_TOKEN 后再测');
  }
  // 缺 X-Tenant-Id / X-User-Id：guard 无论是否配令牌都要求这两个 header
  const noTenant = await retrieveKnowledge({ query: cfg.queryShared, tenantId: '', userId: cfg.userA, token: cfg.knowledgeToken, kbId: cfg.kbId });
  ok('2.3 [鉴权] 缺 X-Tenant-Id → 401', noTenant.status === 401, `status=${noTenant.status}`);
  const noUser = await retrieveKnowledge({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: '', token: cfg.knowledgeToken, kbId: cfg.kbId });
  ok('2.4 [鉴权] 缺 X-User-Id → 401（即 ownerId=null 的历史任务行为）', noUser.status === 401, `status=${noUser.status}`);

  // ========== 场景 3：端到端经 ai-call 代理 ==========
  section('【3】端到端 voice-agent → ai-call → ai-knowledge');
  if (!aiCallGuardArmed) {
    skipMsg('3.x 端到端断言', 'ai-call 未配 SERVICE_API_TOKEN（外部模式启动自检本应拒启动；请配置后再测）');
  } else {
    const eA = await retrieveViaAiCall({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: cfg.aiCallToken, kbId: cfg.kbId });
    const eB = await retrieveViaAiCall({ query: cfg.queryShared, tenantId: cfg.tenantB, userId: cfg.userB, token: cfg.aiCallToken, kbId: cfg.kbId });
    const edA = extractDocs(eA.json);
    const edB = extractDocs(eB.json);
    ok('3.0 A 经 ai-call 返回 200', eA.status === 200, `status=${eA.status}`);
    ok('3.1 A 端到端命中非空', edA.length > 0, `hits=${edA.length}`);
    ok('3.2 [安全] A 端到端结果不含 MARKER_B', !contains(edA, cfg.markerB));
    ok('3.3 [安全] B 端到端结果不含 MARKER_A', !contains(edB, cfg.markerA));
    const noSvc = await retrieveViaAiCall({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: '', kbId: cfg.kbId });
    ok('3.4 [鉴权] ai-call 缺 X-Service-Token → 401', noSvc.status === 401, `status=${noSvc.status}`);
  }

  // ========== 场景 4：knowledgeBaseId 作用域探针（已知缺口）==========
  section('【4】knowledgeBaseId 作用域探针（契约缺口，WARN 不阻断）');
  if (!cfg.kbIdOther) {
    skipMsg('4.x knowledgeBaseId 探针', '未设 KB_ID_OTHER（同租户 A 下另一个库 id）');
  } else {
    const r1 = extractDocs((await retrieveKnowledge({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: cfg.knowledgeToken, kbId: cfg.kbId })).json);
    const r2 = extractDocs((await retrieveKnowledge({ query: cfg.queryShared, tenantId: cfg.tenantA, userId: cfg.userA, token: cfg.knowledgeToken, kbId: cfg.kbIdOther })).json);
    const same = JSON.stringify(r1.map((d) => d.id).sort()) === JSON.stringify(r2.map((d) => d.id).sort());
    if (same) {
      warnMsg(
        '4.1 knowledgeBaseId 未按库过滤（走了兜底）',
        `kbId=${cfg.kbId} 与 kbId=${cfg.kbIdOther} 返回同一结果集。ai-knowledge 已支持按 folder 过滤，` +
          `但这两个 id 未对应真实 folder → 优雅退回租户级（预期，非回归失败）。要生效需 KB_ID=真实 folder id。见运行手册。`,
      );
    } else {
      ok('4.1 knowledgeBaseId 按库过滤生效（结果集随库变化）', true);
    }
  }

  // ───────────────────────────── 汇总 ─────────────────────────────
  console.log(`\n\x1b[1m结果\x1b[0m  通过 ${pass} · 失败 ${fail} · 警告 ${warn} · 跳过 ${skip}`);
  if (fail > 0) {
    console.log(`\x1b[31m失败项：\x1b[0m ${fails.join(' | ')}`);
    // 用 exitCode 而非 process.exit()：后者在 Node/Windows 下若有未清理的 fetch 句柄会触发
    // libuv 断言崩溃（exit 127）。设置退出码后让事件循环自然收尾。
    process.exitCode = 1;
    return;
  }
  console.log('\x1b[32m所有【必过】断言通过。\x1b[0m' + (warn ? ' （存在契约探针 WARN，需按手册决策）' : ''));
}

function printConfig() {
  section('CALL-10 跨仓真隔离实测');
  console.log(`  ai-call        : ${cfg.aiCallBase}`);
  console.log(`  ai-knowledge   : ${cfg.aiKnowledgeBase}`);
  console.log(`  租户 A / 用户 A : ${cfg.tenantA} / ${cfg.userA}`);
  console.log(`  租户 B / 用户 B : ${cfg.tenantB} / ${cfg.userB}`);
  console.log(`  kbId           : ${cfg.kbId}${cfg.kbIdOther ? ` （探针另一库：${cfg.kbIdOther}）` : ''}`);
  console.log(`  共享词/标记     : ${cfg.queryShared} / ${cfg.markerA} · ${cfg.markerB}`);
  console.log(`  令牌就绪        : ai-knowledge=${cfg.knowledgeToken ? 'yes' : 'no'} · ai-call=${cfg.aiCallToken ? 'yes' : 'no'}`);
}

function env(k, d) {
  const v = process.env[k];
  return v === undefined || v === '' ? d : v;
}

main().catch((err) => {
  console.error('\x1b[31m脚本异常：\x1b[0m', err);
  process.exitCode = 2;
});
