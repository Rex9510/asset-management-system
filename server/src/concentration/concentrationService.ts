import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

export interface SectorAllocation {
  sector: string;
  stockCount: number;
  totalValue: number;
  percentage: number;
}

export interface ConcentrationResult {
  sectors: SectorAllocation[];
  totalValue: number;
  riskWarning: string | null;
}

interface PositionRow {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  shares: number;
}

// --- Helpers ---

const CONCENTRATION_THRESHOLD = 60;

/**
 * Map stock code prefix to sector (board) name.
 * Uses A-share stock code prefix conventions.
 */
export function getSectorFromCode(stockCode: string): string {
  if (!stockCode || stockCode.length < 3) return '其他';
  const prefix3 = stockCode.substring(0, 3);

  // 科创板: 688xxx, 689xxx
  if (prefix3 === '688' || prefix3 === '689') return '科创板';

  // 创业板: 300xxx, 301xxx
  if (prefix3 === '300' || prefix3 === '301') return '创业板';

  // 沪市主板: 600xxx, 601xxx, 603xxx, 605xxx
  if (prefix3 === '600' || prefix3 === '601' || prefix3 === '603' || prefix3 === '605') return '沪市主板';

  // 深市主板: 000xxx, 001xxx, 002xxx, 003xxx
  if (prefix3 === '000' || prefix3 === '001' || prefix3 === '002' || prefix3 === '003') return '深市主板';

  return '其他';
}

/**
 * Calculate sector concentration for a user's holding positions.
 * Pure rule engine — zero AI calls.
 *
 * Groups positions by sector (derived from stock code prefix),
 * calculates each sector's total market value (shares × current price),
 * then computes percentage = sector_value / total_value × 100%.
 */
export function getConcentration(
  userId: number,
  db?: Database.Database
): ConcentrationResult {
  const database = db || getDatabase();

  // Get all holding positions with shares > 0
  const positions = database
    .prepare(
      `SELECT id, user_id, stock_code, stock_name, shares
       FROM positions
       WHERE user_id = ? AND position_type = 'holding' AND shares > 0`
    )
    .all(userId) as PositionRow[];

  if (positions.length === 0) {
    return { sectors: [], totalValue: 0, riskWarning: null };
  }

  // Build sector map: sector -> { stocks, totalValue }
  const sectorMap = new Map<string, { stockCodes: Set<string>; totalValue: number }>();

  for (const pos of positions) {
    const cache = database
      .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
      .get(pos.stock_code) as { price: number } | undefined;

    if (!cache) continue;

    const marketValue = pos.shares * cache.price;
    const sector = getSectorFromCode(pos.stock_code);

    const entry = sectorMap.get(sector);
    if (entry) {
      entry.stockCodes.add(pos.stock_code);
      entry.totalValue += marketValue;
    } else {
      sectorMap.set(sector, {
        stockCodes: new Set([pos.stock_code]),
        totalValue: marketValue,
      });
    }
  }

  // Calculate total value across all sectors
  let totalValue = 0;
  for (const entry of sectorMap.values()) {
    totalValue += entry.totalValue;
  }

  if (totalValue === 0) {
    return { sectors: [], totalValue: 0, riskWarning: null };
  }

  // Build sector allocations with percentages
  const sectors: SectorAllocation[] = [];
  let riskWarning: string | null = null;

  for (const [sector, entry] of sectorMap.entries()) {
    const percentage = (entry.totalValue / totalValue) * 100;
    sectors.push({
      sector,
      stockCount: entry.stockCodes.size,
      totalValue: entry.totalValue,
      percentage,
    });

    if (percentage > CONCENTRATION_THRESHOLD) {
      riskWarning = `${sector}板块持仓占比${percentage.toFixed(1)}%，超过${CONCENTRATION_THRESHOLD}%集中度阈值`;
    }
  }

  // Sort by percentage descending
  sectors.sort((a, b) => b.percentage - a.percentage);

  return { sectors, totalValue, riskWarning };
}

/**
 * Check concentration risk for a user and create a concentration_risk
 * message if any single sector exceeds the threshold.
 * Skips if a recent (24h) concentration_risk message already exists.
 */
export function checkConcentrationRisk(
  userId: number,
  db?: Database.Database
): void {
  const database = db || getDatabase();
  const result = getConcentration(userId, database);

  if (!result.riskWarning) return;

  // Find the risk sector
  const riskSector = result.sectors.find(
    (s) => s.percentage > CONCENTRATION_THRESHOLD
  );
  if (!riskSector) return;

  // Check for recent (24h) concentration_risk message to avoid duplicates
  const recentMsg = database
    .prepare(
      `SELECT id FROM messages
       WHERE user_id = ? AND type = 'concentration_risk'
         AND created_at > datetime('now', '-24 hours')
       LIMIT 1`
    )
    .get(userId) as { id: number } | undefined;

  if (recentMsg) return;

  const summary = `持仓集中度风险提示`;
  const detail = JSON.stringify({
    sectors: result.sectors,
    riskSector: riskSector.sector,
    percentage: riskSector.percentage,
    totalValue: result.totalValue,
  });

  database
    .prepare(
      `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
       VALUES (?, 'concentration_risk', '', '', ?, ?, 0)`
    )
    .run(userId, summary, detail);
}

/**
 * Check concentration risk for ALL users that have holding positions.
 * Called during daily post-close check.
 */
export function checkAllUsersConcentrationRisk(db?: Database.Database): void {
  const database = db || getDatabase();

  const users = database
    .prepare(
      `SELECT DISTINCT user_id FROM positions WHERE position_type = 'holding' AND shares > 0`
    )
    .all() as { user_id: number }[];

  for (const { user_id } of users) {
    checkConcentrationRisk(user_id, database);
  }
}
