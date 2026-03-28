 # 实现计划：AI智能投资陪伴助手 第二期（语风方法论 + 核心留存）

## 概述

基于第一期已完成的基础架构（用户认证、实时行情、AI分析、持仓管理、消息中心、AI对话等），增量实现16个新功能模块。技术栈延续：React H5 + Node.js/Express + SQLite + DeepSeek API + Jest/fast-check。所有新增模块在一期代码基础上扩展，不重写一期代码。按P0→P1→P2优先级顺序实现。

## 任务

- [x] 1. 数据库迁移与基础设施准备
  - [x] 1.1 创建二期数据库迁移脚本
    - 在 `server/src/db/` 下创建 `migration-phase2.sql`，包含所有二期新增表：valuation_cache, rotation_status, chain_status, event_calendar, deep_reports, cycle_monitors, market_environment, daily_pick_tracking, sentiment_index, operation_logs, notification_settings, portfolio_snapshots, user_settings
    - 执行 `ALTER TABLE positions ADD COLUMN stop_loss_price REAL`
    - 移除 messages 表的 type CHECK 约束限制（SQLite 不支持 ALTER COLUMN，在应用层验证新增的9种消息类型：stop_loss_alert, rotation_switch, chain_activation, event_window, cycle_bottom, market_env_change, daily_pick_tracking, concentration_risk, deep_report）
    - 修改 `server/src/db/connection.ts` 或 init 逻辑，启动时自动执行迁移
    - _需求：全局数据模型_

  - [x]* 1.2 编写数据库迁移单元测试
    - 验证所有新表创建成功、字段类型正确
    - 验证 positions 表新增 stop_loss_price 字段
    - 验证 messages 表支持新消息类型插入
    - _需求：全局数据模型_

  - [x] 1.3 实现交易日判断守卫
    - 创建 `server/src/scheduler/tradingDayGuard.ts`，实现 `isTradingDay(date: Date): boolean`
    - 创建 `server/src/scheduler/holidays.json`，内置2024-2025年A股休市日期表
    - 排除周六日、法定节假日，包含调休补班日
    - 兜底机制：节假日表缺失时回退到仅判断周六日
    - 实现 `isTradingHours(date: Date): boolean`，判断是否在 9:30-11:30 或 13:00-15:00（排除午休）
    - _需求：9.4, 全局性能约束_

  - [x]* 1.4 编写交易日守卫属性测试
    - 验证周六日一定返回 false
    - 验证交易时间判断排除午休 11:30-13:00
    - _需求：9.4_

  - [x] 1.5 一期行为调整：SSE推送频率与Tab切换刷新
    - 修改 `server/src/market/marketRoutes.ts`：`SSE_POLL_INTERVAL_MS` 从 5000 改为 1800000（30分钟）
    - 修改 `client/src/components/BottomNav.tsx`：tab 切换时触发行情刷新事件
    - 修改 `client/src/pages/DashboardPage.tsx`：监听 tab 切换刷新事件，调用 `/api/market/quotes` 刷新数据
    - _需求：一期行为调整_

  - [x]* 1.6 编写 SSE 频率与 Tab 刷新测试
    - 验证 SSE 间隔为 1800000ms
    - 验证 BottomNav tab 切换触发刷新事件
    - _需求：一期行为调整_

- [x] 2. 检查点 — 基础设施就绪
  - 确保所有测试通过，ask the user if questions arise。

- [x] 3. 降本优化架构：规则引擎 + 批量AI + 变化触发 + 去重
  - [x] 3.1 实现变化触发制过滤器
    - 创建 `server/src/scheduler/changeDetector.ts`
    - 实现变化检测逻辑：股价变化 < 2% 且 RSI 变化 < 5 → 跳过AI调用，复用上次分析结果
    - 缓存上次分析时的价格和RSI值用于对比
    - _需求：降本优化_

  - [x] 3.2 实现股票去重池
    - 创建 `server/src/scheduler/stockDeduplicator.ts`
    - 多用户持有同一股票时只分析一次，结果共享给所有持有该股票的用户
    - 24h未登录用户跳过定时分析
    - _需求：降本优化_

  - [x] 3.3 重构定时分析为批量AI调用模式
    - 修改 `server/src/scheduler/schedulerService.ts`：集成变化触发制 + 去重池
    - 规则引擎先计算所有股票的 stage/actionRef/keySignals/batchPlan/confidence
    - 将有变化的股票合并为一次批量AI请求生成 reasoning 文本
    - 集成交易日守卫：盘中分析仅在交易日 9:30-11:30、13:00-15:00 运行
    - _需求：降本优化, 9.4_

  - [x]* 3.4 编写变化触发制和去重池单元测试
    - 验证价格变化 < 2% 且 RSI 变化 < 5 时跳过
    - 验证同一股票多用户只分析一次
    - _需求：降本优化_

- [x] 4. 检查点 — 降本架构就绪
  - 确保所有测试通过，ask the user if questions arise。


- [x] 5. P0：估值分位系统（需求1）
  - [x] 5.1 实现估值分位服务后端
    - 创建 `server/src/valuation/valuationService.ts`
    - 实现多源降级获取PE/PB：腾讯 qt.gtimg.cn → 新浪 → 数据库缓存 → AI估算
    - 腾讯/新浪接口使用 `responseType: 'arraybuffer'` + `TextDecoder('gbk')` 解码
    - 基于腾讯历史K线（一期 historyService）反推历史PE序列：当前PE × 当前价 / 历史价
    - 计算分位数 = rank(当前PE) / total，区间映射：0-30%→low, 30-70%→fair, 70-100%→high
    - 数据年限标注：不足10年时标注实际年限
    - 写入 valuation_cache 表，每交易日收盘后更新
    - 批量初始化：队列逐只处理，500ms 间隔
    - _需求：1.1, 1.2, 1.3, 1.4, 1.6_

  - [x]* 5.2 编写属性测试：估值区间映射正确性
    - **属性 1：估值区间映射正确性**
    - 对任意百分位数值（0-100），0-30%→low, 30-70%→fair, 70-100%→high
    - **验证需求：1.4**

  - [x]* 5.3 编写属性测试：估值分位数据源降级链
    - **属性 2：估值分位数据源降级链**
    - 对任意故障场景，降级顺序为腾讯→新浪→缓存→AI估算，source字段正确标注
    - **验证需求：1.2**

  - [x]* 5.4 编写属性测试：估值分位数据年限标注
    - **属性 3：估值分位数据年限标注**
    - 数据不足10年时 dataYears 等于实际年限
    - **验证需求：1.3**

  - [x] 5.5 创建估值分位 API 路由
    - 创建 `server/src/valuation/valuationRoutes.ts`
    - `GET /api/valuation/:stockCode` — 返回估值分位数据
    - 注册路由到 `server/src/app.ts`
    - _需求：1.1_

  - [x] 5.6 实现估值分位前端组件
    - 创建 `client/src/components/ValuationTag.tsx` — 紧凑标签（如"PE 15%分位 低估"）
    - 在 StockCard 组件中集成 ValuationTag，展示估值分位 + 数据年限
    - 加载失败时显示"估值计算中"占位标签
    - 遵循UI规范：最小12px标签文字、低估绿/合理蓝/高估红状态色
    - _需求：1.1, 1.7_

  - [x]* 5.7 编写属性测试：估值分位展示完整性
    - **属性 4：估值分位展示完整性**
    - 渲染结果包含PE分位、PB分位、区间标签、数据年限
    - **验证需求：1.1, 1.7**

- [x] 6. P0：板块轮动追踪（需求2）
  - [x] 6.1 实现板块轮动服务后端
    - 创建 `server/src/rotation/rotationService.ts`
    - 基于三只ETF（科技515000、有色512400、消费159928）近20日涨幅 + 成交量比综合得分判断阶段
    - 纯规则引擎，零AI调用
    - 检测阶段切换，切换时创建 rotation_switch 消息
    - 写入 rotation_status 表，每交易日收盘后更新
    - _需求：2.1, 2.2, 2.4, 2.6_

  - [x]* 6.2 编写属性测试：板块轮动阶段判断一致性
    - **属性 5：板块轮动阶段判断一致性**
    - 综合得分最高的板块决定阶段，P1↔科技成长, P2↔周期品, P3↔消费白酒
    - **验证需求：2.1, 2.2**

  - [x]* 6.3 编写属性测试：轮动阶段切换触发通知
    - **属性 38：轮动阶段切换触发通知**
    - 阶段变化时创建 rotation_switch 消息
    - **验证需求：2.4**

  - [x] 6.4 创建板块轮动 API 路由与前端组件
    - 创建 `server/src/rotation/rotationRoutes.ts`，`GET /api/rotation/current`
    - 创建 `client/src/components/RotationTag.tsx` — 看板顶部标签（如"P1 科技成长 🔄"）
    - 集成到 DashboardPage 顶部状态条
    - _需求：2.3, 2.5_

- [x] 7. P0：深度分析报告（需求5）
  - [x] 7.1 实现深度分析服务后端
    - 创建 `server/src/analysis/deepAnalysisService.ts`
    - 按语风框架生成报告：结论先行→基本面→财务数据→估值分位→交易策略
    - 使用"参考方案"措辞，禁止"建议"/"推荐"
    - 包含生成时间、数据截止日期、AI模型名称、置信度
    - 60秒超时处理：返回"报告生成中"，后台继续生成
    - 24h缓存跨用户共享（同一股票）
    - 写入 deep_reports 表，完成后创建 deep_report 消息
    - _需求：5.1, 5.2, 5.3, 5.6_

  - [x]* 7.2 编写属性测试：深度分析报告结构完整性
    - **属性 10：深度分析报告结构完整性**
    - 已完成报告包含 conclusion/fundamentals/financials/valuation/strategy/aiModel/dataCutoffDate/confidence 所有非空字段
    - **验证需求：5.1, 5.3**

  - [x]* 7.3 编写属性测试：AI输出合规措辞
    - **属性 11：AI输出合规措辞**
    - AI文本不含"建议"/"推荐"（"埋伏推荐"除外），使用"参考方案"；复盘评价无批评语言
    - **验证需求：5.2, 13.4**

  - [x]* 7.4 编写属性测试：深度报告存储与检索往返
    - **属性 12：深度报告存储与检索往返**
    - 按股票代码和时间检索能找到报告，内容一致
    - **验证需求：5.4**

  - [x] 7.5 创建深度分析 API 路由与前端组件
    - 创建 `server/src/analysis/deepAnalysisRoutes.ts`
    - `POST /api/analysis/deep/:stockCode` — SSE流式/异步生成
    - `GET /api/analysis/deep/history` — 历史报告列表
    - 创建 `client/src/components/DeepReportModal.tsx` — 深度报告弹窗
    - 在 AnalysisPanel 中添加"生成深度报告"按钮
    - 超时时显示提示，完成后消息中心通知
    - _需求：5.4, 5.5, 5.6_

- [x] 8. P0：止损线设置与提醒（需求8）
  - [x] 8.1 实现止损线服务后端
    - 创建 `server/src/stoploss/stopLossService.ts`
    - 止损价设置：更新 positions 表 stop_loss_price 字段
    - 止损触发检测：当前价 < 止损价时创建 stop_loss_alert 消息
    - 默认规则判断，用户点击"详细评估"时按需调用AI
    - AI评估内容：买入逻辑回顾、基本面变化、持有或止损参考方案
    - 未设止损价时，AI分析结果中给出参考止损价
    - _需求：8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 8.2 编写属性测试：止损线设置往返
    - **属性 18：止损线设置往返**
    - 设置止损价后查询返回相同值
    - **验证需求：8.1**

  - [x]* 8.3 编写属性测试：止损线触发正确性
    - **属性 19：止损线触发正确性**
    - 当前价 < 止损价时创建 stop_loss_alert 消息
    - **验证需求：8.2**

  - [x]* 8.4 编写属性测试：止损提醒内容完整性
    - **属性 20：止损提醒内容完整性**
    - detail 包含买入逻辑回顾、基本面变化评估、参考方案三部分
    - **验证需求：8.3**

  - [x] 8.5 创建止损线 API 路由与前端组件
    - 创建 `server/src/stoploss/stopLossRoutes.ts`
    - `PUT /api/positions/:id/stoploss` — 设置止损价
    - `GET /api/stoploss/check` — 检查止损触发
    - 创建 `client/src/components/StopLossIndicator.tsx` — 止损线标记
    - 在 PositionForm 中添加止损价输入字段
    - _需求：8.1, 8.4_

- [x] 9. P0：大盘环境判断与联动（需求9）
  - [x] 9.1 实现大盘环境服务后端
    - 创建 `server/src/marketenv/marketEnvService.ts`
    - 纯规则引擎：MA20/MA60趋势 + 成交量变化 + 涨跌家数比 → bull/sideways/bear
    - 熊市时 confidenceAdjust = -10~-20，附加风险提示
    - 检测环境切换，切换时创建 market_env_change 消息
    - 写入 market_environment 表，每交易日收盘后更新
    - _需求：9.1, 9.3, 9.4, 9.5_

  - [x]* 9.2 编写属性测试：大盘环境分类正确性
    - **属性 21：大盘环境分类正确性**
    - 指标组合与 bull/sideways/bear 分类严格对应
    - **验证需求：9.1**

  - [x]* 9.3 编写属性测试：熊市置信度下调
    - **属性 22：熊市置信度下调**
    - 熊市环境下 confidenceAdjust 在 -10 到 -20 之间，附加风险提示
    - **验证需求：9.3**

  - [x]* 9.4 编写属性测试：环境切换触发通知
    - **属性 23：环境切换触发通知**
    - 环境变化时创建 market_env_change 消息
    - **验证需求：9.5**

  - [x] 9.5 创建大盘环境 API 路由与前端组件
    - 创建 `server/src/marketenv/marketEnvRoutes.ts`，`GET /api/market-env/current`
    - 创建 `client/src/components/MarketEnvTag.tsx` — 看板顶部标签（如"大盘环境：震荡 ⚖️"）
    - 集成到 DashboardPage 顶部状态条
    - _需求：9.2_

- [x] 10. P0：每日关注后续追踪（需求10）
  - [x] 10.1 实现每日关注追踪服务后端
    - 创建 `server/src/dailypick/dailyPickTrackingService.ts`
    - 自动追踪历史每日关注在推荐后 3/7/14/30 天的实际涨跌幅
    - 收益率 = (追踪日价格 - 推荐价格) / 推荐价格 × 100%
    - 追踪节点到达时创建 daily_pick_tracking 消息
    - 准确率统计：totalPicks/profitCount/lossCount/avgReturn/winRate
    - 写入 daily_pick_tracking 表，每交易日收盘后检查
    - _需求：10.1, 10.2, 10.3_

  - [x]* 10.2 编写属性测试：每日关注追踪收益计算
    - **属性 24：每日关注追踪收益计算**
    - 收益率 = (追踪日价格 - 推荐价格) / 推荐价格 × 100%
    - **验证需求：10.1**

  - [x]* 10.3 编写属性测试：追踪节点触发消息
    - **属性 25：追踪节点触发消息**
    - 3/7/14/30天节点到达时各创建一条 daily_pick_tracking 消息
    - **验证需求：10.2**

  - [x]* 10.4 编写属性测试：准确率统计正确性
    - **属性 26：准确率统计正确性**
    - totalPicks=总数, profitCount=收益>0数, winRate=profitCount/totalPicks, avgReturn=算术平均
    - **验证需求：10.3**

  - [x] 10.5 创建追踪 API 路由
    - 创建 `server/src/dailypick/dailyPickTrackingRoutes.ts`
    - `GET /api/daily-pick/tracking` — 追踪列表
    - `GET /api/daily-pick/accuracy` — 准确率统计
    - _需求：10.1, 10.3_

- [x] 11. 检查点 — P0 后端服务就绪
  - 确保所有测试通过，ask the user if questions arise。


- [x] 12. P1：商品传导链监控（需求3）
  - [x] 12.1 实现商品传导链服务后端
    - 创建 `server/src/chain/commodityChainService.ts`
    - 监控7个节点ETF（黄金518880→白银161226→有色512400→煤炭515220→化工516020→橡胶159886→原油161129）
    - 基于腾讯K线接口获取近10日涨跌幅，状态映射：>3%→activated, 1%-3%→transmitting, <1%→inactive
    - 纯规则引擎，零AI调用
    - 检测节点从 inactive→activated 时创建 chain_activation 消息
    - 写入 chain_status 表，每交易日收盘后更新
    - _需求：3.1, 3.2, 3.4, 3.6_

  - [x]* 12.2 编写属性测试：传导链节点状态映射正确性
    - **属性 6：传导链节点状态映射正确性**
    - 涨幅>3%→activated, 1%-3%→transmitting, <1%→inactive
    - **验证需求：3.2**

  - [x]* 12.3 编写属性测试：传导链节点激活触发通知
    - **属性 39：传导链节点激活触发通知**
    - inactive→activated 时创建 chain_activation 消息
    - **验证需求：3.4**

  - [x] 12.4 创建传导链 API 路由与前端组件
    - 创建 `server/src/chain/commodityChainRoutes.ts`，`GET /api/chain/status`
    - 创建 `client/src/components/CommodityChain.tsx` — 横向流程图，绿色已激活/黄色传导中/灰色未激活
    - 集成到 DashboardPage
    - _需求：3.3, 3.5_

- [x] 13. P1：事件驱动日历（需求4）
  - [x] 13.1 实现事件日历服务后端
    - 创建 `server/src/events/eventCalendarService.ts`
    - CRUD操作：创建/查询/更新/删除事件
    - 窗口期计算：事件前N天→before_build, 事件中→during_watch, 事件后N天→after_take_profit, 其他→none
    - 窗口状态变化时创建 event_window 消息（进入 before_build 或 after_take_profit 时）
    - 使用清晰标签："事件前·可建仓"/"事件中·观望"/"利好兑现·可减仓"
    - _需求：4.1, 4.2, 4.4, 4.5, 4.7_

  - [x] 13.2 实现事件种子数据导入
    - 创建 `server/src/events/seedEvents.ts`
    - 内置年度常规事件：两会3月、中报8月、三季报10月、年报4月、美联储议息会议等
    - 系统初始化时自动导入，标记 is_seed=1
    - _需求：4.8_

  - [x]* 13.3 编写属性测试：事件窗口期计算正确性
    - **属性 7：事件窗口期计算正确性**
    - 事件前N天→before_build, 事件中→during_watch, 事件后N天→after_take_profit, 其他→none
    - **验证需求：4.2**

  - [x]* 13.4 编写属性测试：事件日历CRUD往返
    - **属性 8：事件日历CRUD往返**
    - 创建后查询返回相同数据，更新后返回更新数据，删除后不存在
    - **验证需求：4.7**

  - [x]* 13.5 编写属性测试：事件窗口期变化触发通知
    - **属性 9：事件窗口期变化触发通知**
    - none→before_build 或 during_watch→after_take_profit 时创建 event_window 消息
    - **验证需求：4.4, 4.5**

  - [x] 13.6 创建事件日历 API 路由与前端组件
    - 创建 `server/src/events/eventCalendarRoutes.ts`
    - `GET /api/events?days=7` — 未来N天事件列表
    - `POST /api/events` — 创建事件
    - `PUT /api/events/:id` — 更新事件
    - `DELETE /api/events/:id` — 删除事件
    - 创建 `client/src/components/EventCalendar.tsx` — 事件日历卡片，展示事件名/日期/关联板块/窗口标签/操作提示
    - 集成到 DashboardPage
    - _需求：4.3, 4.6, 4.7_

- [x] 14. P1：周期底部检测（需求6）
  - [x] 14.1 实现周期底部检测服务后端
    - 创建 `server/src/cycle/cycleDetectorService.ts`
    - 底部信号检测：价格处于近3年最低30%区间 + 成交量萎缩后放大 + RSI<30或MACD底背离（至少满足2项）
    - 纯规则引擎，零AI调用
    - 用户自定义监控标的 CRUD（添加/删除）
    - 触发底部信号时创建 cycle_bottom 消息
    - 写入 cycle_monitors 表，每交易日收盘后更新
    - _需求：6.1, 6.2, 6.3, 6.5, 6.6_

  - [x]* 14.2 编写属性测试：周期底部信号检测正确性
    - **属性 13：周期底部信号检测正确性**
    - 至少满足2项条件时触发底部信号
    - **验证需求：6.2**

  - [x]* 14.3 编写属性测试：周期监控CRUD往返
    - **属性 14：周期监控CRUD往返**
    - 添加后查询返回记录，删除后不存在
    - **验证需求：6.5**

  - [x]* 14.4 编写属性测试：底部信号触发通知
    - **属性 40：底部信号触发通知**
    - 触发底部信号时创建 cycle_bottom 消息，包含标的名称/当前价格/预估底部区间
    - **验证需求：6.3**

  - [x] 14.5 创建周期监控 API 路由与前端组件
    - 创建 `server/src/cycle/cycleDetectorRoutes.ts`
    - `GET /api/cycle/monitors` — 监控列表
    - `POST /api/cycle/monitors` — 添加监控
    - `DELETE /api/cycle/monitors/:id` — 删除监控
    - 创建 `client/src/components/CycleMonitor.tsx` — 周期监控卡片，展示周期节奏/当前位置/持续时间/距下一阶段
    - 集成到 DashboardPage "周期监控"区域
    - _需求：6.4, 6.5_

- [x] 15. P1：持仓回测（需求7）
  - [x] 15.1 实现持仓回测服务后端
    - 创建 `server/src/backtest/backtestService.ts`
    - 找出当前估值分位±5%范围内的所有历史时点
    - 计算持有30d/90d/180d/365d的收益率
    - 统计摘要：盈利概率/平均收益率/最大收益率/最大亏损率/中位数收益率
    - 纯规则引擎，零AI调用
    - 匹配点<5个时 sampleWarning=true
    - disclaimer 字段："历史数据不代表未来表现，仅供学习参考"
    - _需求：7.1, 7.2, 7.3, 7.5, 7.6_

  - [x]* 15.2 编写属性测试：回测历史匹配点筛选正确性
    - **属性 15：回测历史匹配点筛选正确性**
    - 所有匹配时点的估值分位在当前分位±5%范围内
    - **验证需求：7.1**

  - [x]* 15.3 编写属性测试：回测统计摘要正确性
    - **属性 16：回测统计摘要正确性**
    - 盈利概率=正收益数/总数, 平均=算术平均, 最大/最小=极值, 中位数=排序中位
    - **验证需求：7.2, 7.3**

  - [x]* 15.4 编写属性测试：回测结果风险提示
    - **属性 17：回测结果风险提示**
    - disclaimer 非空，匹配点<5时 sampleWarning=true
    - **验证需求：7.5, 7.6**

  - [x] 15.5 创建回测 API 路由与前端组件
    - 创建 `server/src/backtest/backtestRoutes.ts`，`POST /api/backtest/:stockCode`
    - 创建 `client/src/components/BacktestPanel.tsx` — 回测结果面板
    - 在 AnalysisPanel 中添加"历史回测"按钮
    - _需求：7.4_

- [x] 16. P1：市场情绪指标（需求11）
  - [x] 16.1 实现市场情绪服务后端
    - 创建 `server/src/sentiment/sentimentService.ts`
    - 基于成交量/20日均量比值 + 上证涨跌幅 + 沪深300涨跌幅加权计算，输出0-100
    - 标签映射：0-25→极度恐慌😱, 25-45→恐慌😰, 45-55→中性😐, 55-75→贪婪😊, 75-100→极度贪婪🤑
    - 纯规则引擎，零AI调用
    - 写入 sentiment_index 表，每交易日收盘后更新
    - _需求：11.1, 11.2, 11.5_

  - [x]* 16.2 编写属性测试：情绪指数计算与标签映射
    - **属性 27：情绪指数计算与标签映射**
    - 输出0-100整数，标签映射严格对应区间
    - **验证需求：11.1, 11.2**

  - [x] 16.3 创建情绪指数 API 路由与前端组件
    - 创建 `server/src/sentiment/sentimentRoutes.ts`，`GET /api/sentiment/current`
    - 创建 `client/src/components/SentimentTag.tsx` — 紧凑标签（如"😐 情绪48"）
    - 创建 `client/src/components/SentimentGauge.tsx` — 点击展开的仪表盘详细视图
    - 集成到 DashboardPage 顶部状态条
    - _需求：11.3, 11.4_

- [x] 17. 检查点 — P1 后端服务就绪
  - 确保所有测试通过，ask the user if questions arise。


- [x] 18. P2：持仓集中度风险提示（需求12）
  - [x] 18.1 实现持仓集中度服务后端
    - 创建 `server/src/concentration/concentrationService.ts`
    - 纯规则引擎：计算各板块持仓金额占比，百分比之和=100%
    - 单板块占比>60%时创建 concentration_risk 消息
    - 用户添加新持仓时检查集中度，超阈值时附加风险提示
    - 每交易日收盘后检查
    - _需求：12.1, 12.2, 12.4_

  - [x]* 18.2 编写属性测试：持仓集中度计算正确性
    - **属性 28：持仓集中度计算正确性**
    - 各板块占比之和=100%，每个板块占比=该板块总市值/所有持仓总市值×100%
    - **验证需求：12.1**

  - [x]* 18.3 编写属性测试：集中度超阈值触发通知
    - **属性 29：集中度超阈值触发通知**
    - 某板块占比>60%时创建 concentration_risk 消息
    - **验证需求：12.2**

  - [x] 18.4 创建集中度 API 路由与前端组件
    - 创建 `server/src/concentration/concentrationRoutes.ts`，`GET /api/concentration`
    - 在"我的"页面展示持仓板块分布简易饼图（复用量化可视化的 SectorPieChart）
    - _需求：12.3_

- [x] 19. P2：操作日志与复盘（需求13）
  - [x] 19.1 实现操作日志服务后端
    - 创建 `server/src/oplog/operationLogService.ts`
    - 持仓创建/修改/删除时自动记录操作日志（hook 到 positionService）
    - 记录：操作类型、股票代码/名称、价格、份额、时间、当时AI参考方案摘要
    - 纯规则复盘评价：操作后7天和30天节点，对比操作时价格与当前价格，模板文本生成
    - 复盘评价使用客观中性措辞，不含批评或指责性语言
    - _需求：13.1, 13.3, 13.4_

  - [x]* 19.2 编写属性测试：操作日志自动记录
    - **属性 30：操作日志自动记录**
    - 持仓创建/修改/删除时自动创建操作日志，包含操作类型/股票代码/价格/份额/时间
    - **验证需求：13.1**

  - [x]* 19.3 编写属性测试：复盘评价生成
    - **属性 31：复盘评价生成**
    - 操作后7天和30天节点生成复盘评价
    - **验证需求：13.3**

  - [x] 19.4 创建操作日志 API 路由与前端页面
    - 创建 `server/src/oplog/operationLogRoutes.ts`
    - `GET /api/oplog?page=1&limit=20` — 操作日志列表（分页）
    - `GET /api/oplog/review` — 复盘评价列表
    - 创建 `client/src/pages/OperationLogPage.tsx` — 操作复盘子页面，按时间倒序展示
    - 带 sticky 标题栏和返回按钮
    - _需求：13.2_

- [x] 20. P2：消息推送（需求14）
  - [x] 20.1 实现通知推送服务后端
    - 创建 `server/src/notification/notificationService.ts`
    - 通知设置 CRUD：各消息类型独立开关
    - 推送过滤：用户关闭某类型通知时不触发浏览器推送，但消息仍存入消息中心
    - 写入 notification_settings 表
    - _需求：14.2, 14.3, 14.4_

  - [x]* 20.2 编写属性测试：通知设置过滤
    - **属性 32：通知设置过滤**
    - 关闭某类型通知时不触发浏览器推送，但消息中心仍展示
    - **验证需求：14.2, 14.3**

  - [x] 20.3 创建通知 API 路由与前端页面
    - 创建 `server/src/notification/notificationRoutes.ts`
    - `GET /api/notification/settings` — 获取通知设置
    - `PUT /api/notification/settings` — 更新通知设置
    - 创建 `client/src/pages/NotificationSettingsPage.tsx` — 独立通知设置子页面
    - 包含返回按钮、各消息类型独立开关（附一句话说明）、toggle 切换
    - 首次登录时请求浏览器 Notification API 权限
    - 浏览器不支持或权限被拒时静默降级
    - _需求：14.1, 14.4_

- [x] 21. P2：量化可视化（需求15）
  - [x] 21.1 实现持仓快照服务后端
    - 创建 `server/src/snapshot/snapshotService.ts`
    - 每交易日收盘后记录当日各持仓市值快照到 portfolio_snapshots 表
    - 图表数据聚合：收益曲线、板块分布、单股盈亏
    - _需求：15.1_

  - [x]* 21.2 编写属性测试：收益曲线数据正确性
    - **属性 34：收益曲线数据正确性**
    - totalValue=该日所有持仓市值之和，totalProfit=totalValue-总成本
    - **验证需求：15.1**

  - [x]* 21.3 编写属性测试：板块分布数据正确性
    - **属性 35：板块分布数据正确性**
    - 各板块 percentage 之和=100%，每个板块 value=该板块下所有股票市值之和
    - **验证需求：15.2**

  - [x]* 21.4 编写属性测试：盈亏柱状图排序
    - **属性 36：盈亏柱状图排序**
    - 数据按盈亏金额降序排列
    - **验证需求：15.3**

  - [x] 21.5 创建快照 API 路由与前端图表组件
    - 创建 `server/src/snapshot/snapshotRoutes.ts`，`GET /api/snapshot/chart-data?period=30d`
    - 安装 Chart.js（`npm install chart.js react-chartjs-2`，在 client/）
    - 创建 `client/src/components/ProfitChart.tsx` — 收益曲线图（7d/30d/90d切换）
    - 创建 `client/src/components/SectorPieChart.tsx` — 板块分布饼图
    - 创建 `client/src/components/PnlBarChart.tsx` — 盈亏柱状图（降序排列）
    - 所有图表组件使用 IntersectionObserver 懒加载，仅滚动到可视区域时渲染
    - _需求：15.1, 15.2, 15.3, 15.4_

- [x] 22. P2：我的页面子功能与用户设置（需求16）
  - [x] 22.1 实现用户设置服务后端
    - 创建 `server/src/settings/userSettingsService.ts`
    - 设置项：AI模型选择（deepseek-v3/deepseek-r1/claude/qwen）、分析频率（30/60/120分钟）、风险偏好（conservative/balanced/aggressive）
    - 写入 user_settings 表
    - _需求：16.2_

  - [x]* 22.2 编写属性测试：用户设置往返
    - **属性 37：用户设置往返**
    - 保存设置后读取返回相同值
    - **验证需求：16.2**

  - [x] 22.3 创建用户设置 API 路由
    - 创建 `server/src/settings/userSettingsRoutes.ts`
    - `GET /api/settings` — 获取设置
    - `PUT /api/settings` — 更新设置
    - _需求：16.2_

  - [x] 22.4 实现我的页面子页面前端
    - 扩展 `client/src/pages/ProfilePage.tsx`，添加菜单入口列表
    - 创建 `client/src/pages/AnalysisSettingsPage.tsx` — 分析设置子页面（AI模型/频率/风险偏好）
    - 创建 `client/src/pages/AboutPage.tsx` — 关于页面（版本号/技术栈/免责声明/联系方式）
    - 创建 `client/src/pages/DeepReportHistoryPage.tsx` — 历史深度报告列表
    - 创建 `client/src/pages/AccuracyStatsPage.tsx` — AI准确率统计页面
    - 所有子页面带 sticky 标题栏和返回按钮
    - 在 `client/src/App.tsx` 中注册子页面路由
    - _需求：16.1, 16.2, 16.3_

- [x] 23. 检查点 — P2 功能就绪
  - 确保所有测试通过，ask the user if questions arise。

- [x] 24. AI分析上下文集成
  - [x] 24.1 扩展AI分析引擎上下文数据
    - 修改 `server/src/analysis/analysisService.ts`：在生成分析时注入估值分位、板块轮动阶段、商品传导链状态、市场情绪指数、相关事件信息
    - 熊市环境下自动下调置信度（confidenceAdjust）
    - 极度恐慌时提示"市场恐慌可能是低位布局机会"，极度贪婪时提示"市场过热需警惕回调风险"
    - 对处于当前活跃板块的股票提高关注度
    - 分析周期品时注入传导链状态
    - Prompt瘦身：仅发送关键指标+新闻标题
    - _需求：1.5, 2.5, 3.5, 4.6, 9.3, 11.4_

  - [x]* 24.2 编写属性测试：AI分析上下文完整性
    - **属性 33：AI分析上下文完整性**
    - AI请求上下文包含估值分位、轮动阶段、传导链状态、情绪指数、相关事件
    - **验证需求：1.5, 2.5, 3.5, 4.6, 11.4**

- [x] 25. 定时任务调度集成
  - [x] 25.1 集成所有收盘后定时任务到调度器
    - 修改 `server/src/scheduler/schedulerService.ts`
    - 所有收盘后任务加入交易日守卫（isTradingDay）
    - 按时间表串行执行（15:30-17:30错峰）：
      - 15:30 K线增量更新（一期已有）
      - 15:45 估值分位数据更新（valuationService）
      - 16:00 板块轮动阶段判断（rotationService）
      - 16:10 商品传导链状态更新（commodityChainService）
      - 16:20 大盘环境判断（marketEnvService）
      - 16:30 市场情绪指数计算（sentimentService）
      - 16:40 周期底部检测（cycleDetectorService）
      - 16:50 每日关注追踪（dailyPickTrackingService）
      - 17:00 持仓集中度检查（concentrationService）
      - 17:10 持仓快照记录（snapshotService）
      - 17:20 操作复盘评价生成（operationLogService）
    - 每个任务独立 try-catch，单个任务超时10分钟强制终止
    - 批量处理时每只股票间隔500ms，避免2核2G内存压力
    - _需求：全局性能约束, 9.4_

  - [x] 25.2 集成盘中定时分析守卫
    - 修改 `server/src/scheduler/schedulerService.ts` 中的 `runScheduledJobs`
    - 加入交易日守卫 + 交易时间守卫（9:30-11:30, 13:00-15:00，排除午休）
    - 集成用户可配置的分析频率（30min/1h/2h，从 user_settings 读取）
    - _需求：9.4, 16.2_

- [x] 26. 前端看板页整合
  - [x] 26.1 整合 DashboardPage 顶部状态条
    - 修改 `client/src/pages/DashboardPage.tsx`
    - 顶部状态条紧凑排列：大盘环境标签 + 轮动阶段标签 + 情绪指数标签
    - 吸顶区域紧凑，不浪费空间
    - _需求：2.3, 9.2, 11.3_

  - [x] 26.2 整合 DashboardPage 内容区域
    - 商品传导链流程图区域
    - 事件日历卡片区域（未来7天事件）
    - 周期监控区域
    - 所有区域数据加载失败时优雅降级（隐藏或显示占位）
    - 空状态设计：优雅的空状态提示
    - 加载状态：骨架屏或loading动画
    - _需求：3.3, 4.3, 6.4_

  - [x] 26.3 扩展消息中心支持新消息类型
    - 修改 `client/src/pages/MessageCenterPage.tsx`
    - 支持展示9种新消息类型的卡片样式
    - 筛选标签精简合并，不要太多分类
    - _需求：全局消息类型扩展_

  - [x] 26.4 整合我的页面
    - 修改 `client/src/pages/ProfilePage.tsx`
    - 添加菜单入口：操作复盘、历史参考记录、AI准确率统计、通知设置、分析设置、关于
    - 集成量化可视化图表（收益曲线/板块饼图/盈亏柱状图）
    - _需求：16.1_

- [x] 27. 检查点 — 全部集成完成
  - 确保所有测试通过，ask the user if questions arise。

- [x] 28. 前端组件测试
  - [x]* 28.1 编写前端组件单元测试
    - ValuationTag 渲染测试：低估/合理/高估标签正确展示
    - CommodityChain 渲染测试：节点颜色与状态对应
    - EventCalendar 渲染测试：事件名/日期/窗口标签展示
    - SentimentGauge 交互测试：展开/收起
    - StopLossIndicator 渲染测试：止损线标记展示
    - NotificationSettingsPage 交互测试：开关切换
    - DeepReportModal 渲染测试：报告内容展示
    - 图表组件懒加载测试：IntersectionObserver 触发
    - ProfilePage 子页面导航测试
    - _需求：全局前端测试_

- [x] 29. 最终检查点 — 全部完成
  - 确保服务端测试通过：`cd server && npx jest --no-coverage`
  - 确保客户端测试通过：`cd client && npx jest --no-coverage`
  - 确保所有属性测试通过注释引用设计文档属性编号
  - ask the user if questions arise。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速MVP交付
- 每个任务引用具体需求编号，确保需求全覆盖
- 属性测试覆盖设计文档中定义的全部40个正确性属性
- 检查点确保增量验证，及时发现问题
- 所有AI输出使用"参考方案"措辞，禁止"建议"/"推荐"（"埋伏推荐"除外）
- 纯规则模块（估值分位/板块轮动/传导链/周期检测/情绪指数/回测/集中度/复盘/大盘环境/快照/通知）零AI调用
- 前端遵循世界顶级UI标准：14px正文/12px辅助、紫靛渐变设计系统、44x44px触摸区域、流畅动效
