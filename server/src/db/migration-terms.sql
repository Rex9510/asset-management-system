-- 用户协议同意记录迁移
-- 添加 agreed_terms 字段，记录用户是否同意用户协议和免责声明
-- 1 表示已同意，0 或 NULL 表示未同意

ALTER TABLE users ADD COLUMN agreed_terms INTEGER DEFAULT 0;
