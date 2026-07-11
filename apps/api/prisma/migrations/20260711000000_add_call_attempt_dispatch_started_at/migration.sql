-- 派发在途持久标记(合规窄窗口 A4):originate 之前单独一笔已提交写入,
-- 供 outbox 重投识别"曾开始派发但结局未知"的歧义态,绝不二次真实外呼。
-- 可空、无默认 → 纯增量,不回填、不锁表。
ALTER TABLE "call_attempts"
  ADD COLUMN "dispatch_started_at" TIMESTAMP(3);
