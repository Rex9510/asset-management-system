-- ============================================================
-- Phase 2 Database Migration
-- Idempotent: safe to run multiple times
-- ============================================================

-- 估值分位缓存表
CREATE TABLE IF NOT EXISTS valuation_cache (
    stock_code TEXT NOT NULL,
    pe_value REAL,
    pb_value REAL,
    pe_percentile REAL,
    pb_percentile REAL,
    pe_zone TEXT CHECK(pe_zone IN ('low', 'fair', 'high')),
    pb_zone TEXT CHECK(pb_zone IN ('low', 'fair', 'high')),
    data_years INTEGER,
    source TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (stock_code)
);

-- 板块轮动状态表
CREATE TABLE IF NOT EXISTS rotation_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_phase TEXT NOT NULL CHECK(current_phase IN ('P1', 'P2', 'P3')),
    phase_label TEXT NOT NULL,
    tech_change_20d REAL,
    tech_volume_ratio REAL,
    cycle_change_20d REAL,
    cycle_volume_ratio REAL,
    consumer_change_20d REAL,
    consumer_volume_ratio REAL,
    previous_phase TEXT,
    switched_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 商品传导链状态表
CREATE TABLE IF NOT EXISTS chain_status (
    node_index INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('activated', 'transmitting', 'inactive')),
    change_10d REAL,
    change_aux REAL,
    primary_days_used INTEGER,
    max_history_days INTEGER,
    window_note TEXT,
    pending_status TEXT,
    pending_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (node_index)
);

-- 事件日历表
CREATE TABLE IF NOT EXISTS event_calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    event_date DATE NOT NULL,
    event_end_date DATE,
    category TEXT NOT NULL,
    related_sectors TEXT,
    before_days INTEGER DEFAULT 5,
    after_days INTEGER DEFAULT 3,
    tip TEXT,
    is_seed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 深度分析报告表
CREATE TABLE IF NOT EXISTS deep_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    conclusion TEXT NOT NULL,
    fundamentals TEXT NOT NULL,
    financials TEXT NOT NULL,
    valuation TEXT NOT NULL,
    strategy TEXT NOT NULL,
    ai_model TEXT NOT NULL,
    confidence INTEGER,
    data_cutoff_date DATE,
    status TEXT DEFAULT 'completed' CHECK(status IN ('generating', 'completed', 'failed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 周期监控表
CREATE TABLE IF NOT EXISTS cycle_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    cycle_length TEXT,
    current_phase TEXT,
    status TEXT CHECK(status IN ('bottom', 'falling', 'rising', 'high')),
    description TEXT,
    bottom_signals TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, stock_code)
);

-- 大盘环境状态表
CREATE TABLE IF NOT EXISTS market_environment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    environment TEXT NOT NULL CHECK(environment IN ('bull', 'sideways', 'bear')),
    label TEXT NOT NULL,
    confidence_adjust INTEGER DEFAULT 0,
    risk_tip TEXT,
    sh_ma20_trend TEXT,
    sh_ma60_trend TEXT,
    hs300_ma20_trend TEXT,
    hs300_ma60_trend TEXT,
    volume_change REAL,
    advance_decline_ratio REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 每日关注追踪表
CREATE TABLE IF NOT EXISTS daily_pick_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pick_message_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    pick_date DATE NOT NULL,
    pick_price REAL NOT NULL,
    tracking_days INTEGER NOT NULL,
    tracked_price REAL,
    return_percent REAL,
    tracked_at DATETIME,
    FOREIGN KEY (pick_message_id) REFERENCES messages(id)
);

-- 市场情绪指数表
CREATE TABLE IF NOT EXISTS sentiment_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
    label TEXT NOT NULL,
    volume_ratio REAL,
    sh_change_percent REAL,
    hs300_change_percent REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    operation_type TEXT NOT NULL CHECK(operation_type IN ('create', 'update', 'delete')),
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    price REAL,
    shares INTEGER,
    ai_summary TEXT,
    review_7d TEXT,
    review_7d_at DATETIME,
    review_30d TEXT,
    review_30d_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 通知设置表
CREATE TABLE IF NOT EXISTS notification_settings (
    user_id INTEGER NOT NULL,
    message_type TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, message_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 持仓快照表
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    shares INTEGER NOT NULL,
    cost_price REAL NOT NULL,
    market_price REAL NOT NULL,
    market_value REAL NOT NULL,
    profit_loss REAL NOT NULL,
    sector TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, snapshot_date, stock_code)
);

-- 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    ai_model TEXT DEFAULT 'deepseek-v3',
    analysis_frequency INTEGER DEFAULT 60,
    risk_preference TEXT DEFAULT 'balanced' CHECK(risk_preference IN ('conservative', 'balanced', 'aggressive')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- users表新增last_login_at字段（用于24h未登录用户过滤）
-- SQLite不支持IF NOT EXISTS for ALTER TABLE，需要在代码层面处理
