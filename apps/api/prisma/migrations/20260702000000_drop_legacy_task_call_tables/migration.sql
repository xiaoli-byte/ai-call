-- 删除旧版任务/通话/对话模型，统一使用 outbound_tasks / call_events / transcript_turns
-- 注意按外键依赖顺序删除：conversations -> calls -> tasks

DROP TABLE IF EXISTS "conversations";
DROP TABLE IF EXISTS "calls";
DROP TABLE IF EXISTS "tasks";

-- 删除旧模型使用的自定义枚举类型
DROP TYPE IF EXISTS "Direction";
DROP TYPE IF EXISTS "CallStatus";
DROP TYPE IF EXISTS "TaskStatus";
