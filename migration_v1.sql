-- ═══════════════════════════════════════════
-- Nbat 升级 v1 · 完整迁移脚本
-- 执行方式：docker exec -i yojo-postgres psql -U yojo -d yojo_data < migration_v1.sql
-- 2026-05-22
-- ═══════════════════════════════════════════

-- ① employee_reports 升级（新增结构化字段）
ALTER TABLE employee_reports
  ADD COLUMN IF NOT EXISTS report_type       VARCHAR(20)  DEFAULT '日报',
  ADD COLUMN IF NOT EXISTS is_valid          BOOLEAN      DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS validation_issues TEXT         DEFAULT '',
  ADD COLUMN IF NOT EXISTS score             FLOAT,
  ADD COLUMN IF NOT EXISTS score_breakdown   JSONB,
  ADD COLUMN IF NOT EXISTS score_issues      TEXT         DEFAULT '',
  ADD COLUMN IF NOT EXISTS yesterday_done    TEXT         DEFAULT '',
  ADD COLUMN IF NOT EXISTS today_plan        TEXT         DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags              TEXT[]       DEFAULT '{}';

-- ② warehouse_receipts · 收货表
CREATE TABLE IF NOT EXISTS warehouse_receipts (
  id               SERIAL PRIMARY KEY,
  created_at       TIMESTAMP DEFAULT NOW(),
  receipt_no       VARCHAR(30) UNIQUE,
  staff_id         VARCHAR(100),
  staff_name       VARCHAR(50),
  supplier         VARCHAR(100),
  product          VARCHAR(200),
  quantity         INTEGER,
  customer         VARCHAR(100),
  condition        VARCHAR(20)  DEFAULT '完好',
  condition_detail TEXT         DEFAULT '',
  notified         BOOLEAN      DEFAULT FALSE
);

-- ③ delivery_records · 送货表
CREATE TABLE IF NOT EXISTS delivery_records (
  id               SERIAL PRIMARY KEY,
  created_at       TIMESTAMP DEFAULT NOW(),
  delivery_no      VARCHAR(30) UNIQUE,
  staff_id         VARCHAR(100),
  staff_name       VARCHAR(50),
  supplier         VARCHAR(100),
  product          VARCHAR(200),
  quantity         INTEGER,
  customer         VARCHAR(100),
  address          VARCHAR(200),
  signed           BOOLEAN      DEFAULT FALSE,
  signed_note      TEXT         DEFAULT '',
  condition        VARCHAR(20)  DEFAULT '完好',
  condition_detail TEXT         DEFAULT '',
  notified         BOOLEAN      DEFAULT FALSE
);

-- 验证
SELECT 'employee_reports' AS tbl, COUNT(*) FROM information_schema.columns WHERE table_name='employee_reports'
UNION ALL
SELECT 'warehouse_receipts', COUNT(*) FROM information_schema.columns WHERE table_name='warehouse_receipts'
UNION ALL
SELECT 'delivery_records', COUNT(*) FROM information_schema.columns WHERE table_name='delivery_records';
