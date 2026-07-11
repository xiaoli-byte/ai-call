// PM2 进程守护配置。
//
// 铁律（详见 docs/deployment.md）：
// - 全部进程跑编译产物（`node dist/*.js`），禁止用 tsx 跑 worker —— tsx 走
//   esbuild transpile-only，对 emitDecoratorMetadata 的支持不完整，会导致
//   NestJS 依赖注入静默拿到 undefined（表现为 worker "能启动但什么都不做"）。
// - 绝不能在这些进程运行期间执行 `nest build` / `pnpm build`：nest-cli.json
//   开了 deleteOutDir，build 会先 rimraf dist，直接杀死正在跑的 API/worker。
//   正确顺序永远是：pm2 stop → build → pm2 start（见部署文档）。
//
// 使用：
//   npm i -g pm2
//   pnpm pm2:start   # 等价于 pm2 start ecosystem.config.js
//   pnpm pm2:stop    # 等价于 pm2 stop ecosystem.config.js
//
// Linux 部署时把下面 `.venv/Scripts/python.exe` 换成 `.venv/bin/python`
// （详见 docs/deployment.md「Linux 路径差异」一节）。

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, '.runtime', 'pm2-logs');
const DEAD_LETTER_PATH = path.join(
  ROOT,
  '.runtime',
  'dead-letters',
  'freeswitch-event-dead-letter.jsonl',
);

// pm2 在部分版本上不会自动递归创建日志目录，这里提前建好，避免首次启动因
// ENOENT 而没有日志可看。
fs.mkdirSync(LOG_DIR, { recursive: true });

/** 生成统一风格的日志路径配置。 */
function logPaths(name) {
  return {
    out_file: path.join(LOG_DIR, `${name}.log`),
    error_file: path.join(LOG_DIR, `${name}.error.log`),
    merge_logs: true,
    time: true,
  };
}

/** 所有进程共用的重启策略：崩溃自动重启，但不无限重启风暴。 */
const RESTART_POLICY = {
  autorestart: true,
  max_restarts: 10,
  min_uptime: '30s',
  restart_delay: 3000,
};

module.exports = {
  apps: [
    {
      name: 'api',
      cwd: path.join(ROOT, 'apps/api'),
      script: 'dist/main.js',
      ...RESTART_POLICY,
      ...logPaths('api'),
    },
    {
      name: 'outbox-worker',
      cwd: path.join(ROOT, 'apps/api'),
      script: 'dist/outbox-worker.main.js',
      ...RESTART_POLICY,
      ...logPaths('outbox-worker'),
    },
    {
      name: 'scheduler-worker',
      cwd: path.join(ROOT, 'apps/api'),
      script: 'dist/scheduler-worker.main.js',
      ...RESTART_POLICY,
      ...logPaths('scheduler-worker'),
    },
    {
      name: 'freeswitch-event-worker',
      cwd: path.join(ROOT, 'apps/api'),
      script: 'dist/freeswitch-event-worker.main.js',
      env: {
        FREESWITCH_EVENT_DEAD_LETTER_PATH: DEAD_LETTER_PATH,
      },
      ...RESTART_POLICY,
      ...logPaths('freeswitch-event-worker'),
    },
    {
      name: 'voice-agent',
      cwd: path.join(ROOT, 'services/voice-agent'),
      // pm2 + Python 模块运行的标准写法：
      // interpreter + interpreter_args + script 拼接成 `python.exe -m voice_agent.main`
      interpreter: path.join(
        ROOT,
        'services/voice-agent/.venv/Scripts/python.exe',
      ),
      interpreter_args: '-m',
      script: 'voice_agent.main',
      env: {
        PYTHONPATH: 'src',
      },
      ...RESTART_POLICY,
      ...logPaths('voice-agent'),
    },
    {
      name: 'funasr-server',
      cwd: path.join(ROOT, 'services/funasr-server'),
      interpreter: path.join(
        ROOT,
        'services/funasr-server/.venv/Scripts/python.exe',
      ),
      interpreter_args: '-m',
      script: 'funasr_server',
      env: {
        PYTHONPATH: 'src',
      },
      ...RESTART_POLICY,
      ...logPaths('funasr-server'),
    },
    {
      // 可选：生产 dashboard。启动前必须先 `pnpm --filter @ai-call/dashboard build`，
      // 否则 `next start` 找不到 .next 产物会持续崩溃重启。
      name: 'dashboard',
      cwd: path.join(ROOT, 'apps/dashboard'),
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      ...RESTART_POLICY,
      ...logPaths('dashboard'),
    },
  ],
};
