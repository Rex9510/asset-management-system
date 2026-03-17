-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    failed_login_count INTEGER DEFAULT 0,
    locked_until DATETIME NULL
);

-- 持仓/关注表
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    position_type TEXT NOT NULL DEFAULT 'holding' CHECK(position_type IN ('holding', 'watching')),
    cost_price REAL,
    shares INTEGER,
    buy_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- AI分析结果表
CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('scheduled', 'volatility', 'manual', 'self_correction')),
    stage TEXT NOT NULL CHECK(stage IN ('bottom', 'rising', 'main_wave', 'high', 'falling')),
    space_estimate TEXT,
    key_signals TEXT,
    action_ref TEXT NOT NULL CHECK(action_ref IN ('hold', 'add', 'reduce', 'clear')),
    batch_plan TEXT,
    confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
    reasoning TEXT NOT NULL,
    data_sources TEXT,
    technical_indicators TEXT,
    news_summary TEXT,
    recovery_estimate TEXT,
    profit_estimate TEXT,
    risk_alerts TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);


-- 对话记录表
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    stock_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 消息中心表
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('scheduled_analysis', 'volatility_alert', 'self_correction', 'daily_pick', 'target_price_alert', 'ambush_recommendation')),
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT NOT NULL,
    analysis_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id)
);

-- 行情缓存表
CREATE TABLE IF NOT EXISTS market_cache (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    price REAL NOT NULL,
    change_percent REAL NOT NULL,
    volume REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 行情历史数据表
CREATE TABLE IF NOT EXISTS market_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open_price REAL NOT NULL,
    close_price REAL NOT NULL,
    high_price REAL NOT NULL,
    low_price REAL NOT NULL,
    volume REAL NOT NULL,
    UNIQUE(stock_code, trade_date)
);

-- 技术指标缓存表
CREATE TABLE IF NOT EXISTS technical_indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    trade_date DATE NOT NULL,
    ma5 REAL, ma10 REAL, ma20 REAL, ma60 REAL,
    dif REAL, dea REAL, macd_histogram REAL,
    k_value REAL, d_value REAL, j_value REAL,
    rsi6 REAL, rsi12 REAL, rsi24 REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(stock_code, trade_date)
);

-- 沪深300成分股表
CREATE TABLE IF NOT EXISTS hs300_constituents (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    weight REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 新闻缓存表
CREATE TABLE IF NOT EXISTS news_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL,
    published_at DATETIME NOT NULL,
    url TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI配置表
CREATE TABLE IF NOT EXISTS ai_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);