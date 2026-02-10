/**
 * 记忆遗忘模块 (Memory Forgetter)
 * 
 * 功能：模拟人类记忆的自然遗忘过程，自动清理低价值记忆
 * 设计参考：SmartAgent2 架构设计文档 v2.0
 * 
 * 核心机制：
 * 1. 时间衰减 (Temporal Decay)：记忆随时间推移自然衰减，遵循艾宾浩斯遗忘曲线
 * 2. 访问强化 (Access Reinforcement)：被检索/引用的记忆会获得强化，延缓遗忘
 * 3. 重要性保护 (Importance Shield)：高重要性记忆受到保护，衰减速度更慢
 * 4. 合并压缩 (Memory Consolidation)：相似的低重要性记忆可以合并为摘要
 * 
 * 遗忘策略：
 * - 每条记忆维护一个 retention_score（保留分数，0.0-1.0）
 * - retention_score < 0.2 的记忆将被标记为可遗忘
 * - 定时任务每隔一段时间扫描并清理低分记忆
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'smartagent2.db');
const db = new Database(DB_PATH);

// ========== 数据库扩展：记忆元数据表 ==========

/**
 * 初始化遗忘模块所需的数据库表
 */
export function initForgetterTables(): void {
  // 记忆元数据表：存储每条记忆的遗忘相关信息
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_metadata (
      memory_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      retention_score REAL NOT NULL DEFAULT 1.0,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decay_rate REAL NOT NULL DEFAULT 0.05,
      is_consolidated INTEGER NOT NULL DEFAULT 0,
      consolidated_into TEXT,
      FOREIGN KEY (memory_id) REFERENCES episodic_memories(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_user ON memory_metadata(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_retention ON memory_metadata(retention_score)`);

  // 遗忘日志表：记录遗忘操作的历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS forgetting_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      retention_score_before REAL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log('[Forgetter] 遗忘模块数据库表初始化完成');
}

// ========== 记忆元数据管理 ==========

/**
 * 为新记忆创建元数据
 * 在 addEpisodicMemory 后调用
 */
export function createMemoryMetadata(memoryId: string, userId: string, importance: number): void {
  // 重要性越高，衰减速率越低
  const decayRate = Math.max(0.01, 0.08 - (importance / 5) * 0.06);
  // 重要性越高，初始保留分数越高
  const initialRetention = Math.min(1.0, 0.5 + (importance / 5) * 0.5);

  db.prepare(`
    INSERT OR REPLACE INTO memory_metadata 
    (memory_id, user_id, retention_score, access_count, last_accessed_at, created_at, decay_rate, is_consolidated, consolidated_into)
    VALUES (?, ?, ?, 0, NULL, datetime('now'), ?, 0, NULL)
  `).run(memoryId, userId, initialRetention, decayRate);
}

/**
 * 记录记忆被访问（检索命中时调用）
 * 访问会强化记忆，提升保留分数
 */
export function recordMemoryAccess(memoryId: string): void {
  const meta = db.prepare('SELECT * FROM memory_metadata WHERE memory_id = ?').get(memoryId) as any;
  if (!meta) return;

  // 访问强化：每次访问提升 0.15 的保留分数，上限 1.0
  const newRetention = Math.min(1.0, meta.retention_score + 0.15);
  const newAccessCount = meta.access_count + 1;

  db.prepare(`
    UPDATE memory_metadata 
    SET retention_score = ?, access_count = ?, last_accessed_at = datetime('now')
    WHERE memory_id = ?
  `).run(newRetention, newAccessCount, memoryId);
}

/**
 * 批量记录记忆访问（检索返回多条记忆时调用）
 */
export function batchRecordAccess(memoryIds: string[]): void {
  const batchUpdate = db.transaction(() => {
    for (const id of memoryIds) {
      recordMemoryAccess(id);
    }
  });
  batchUpdate();
}

// ========== 时间衰减计算 ==========

/**
 * 计算单条记忆的时间衰减后的保留分数
 * 
 * 公式：R(t) = R0 * e^(-λ * t)
 * - R0: 当前保留分数
 * - λ: 衰减速率（decay_rate）
 * - t: 距离上次访问或创建的天数
 * 
 * 修正因子：
 * - 访问次数越多，衰减越慢（访问强化）
 * - 重要性越高，衰减越慢（已体现在 decay_rate 中）
 */
function calculateDecayedRetention(meta: any): number {
  const now = Date.now();
  const lastActive = meta.last_accessed_at 
    ? new Date(meta.last_accessed_at).getTime() 
    : new Date(meta.created_at).getTime();
  
  const daysSinceActive = Math.max(0, (now - lastActive) / (1000 * 60 * 60 * 24));

  // 访问强化因子：访问越多，衰减越慢
  const accessFactor = 1 / (1 + meta.access_count * 0.3);
  
  // 艾宾浩斯衰减
  const effectiveDecayRate = meta.decay_rate * accessFactor;
  const decayedRetention = meta.retention_score * Math.exp(-effectiveDecayRate * daysSinceActive);

  return Math.max(0, Math.min(1.0, decayedRetention));
}

// ========== 遗忘扫描与执行 ==========

interface ForgetResult {
  user_id: string;
  scanned: number;
  decayed: number;
  forgotten: number;
  consolidated: number;
  details: Array<{
    memory_id: string;
    action: 'decayed' | 'forgotten' | 'consolidated';
    retention_before: number;
    retention_after: number;
    reason: string;
  }>;
}

/**
 * 对单个用户执行遗忘扫描
 * 
 * @param userId 用户 ID
 * @param forgetThreshold 遗忘阈值（保留分数低于此值的记忆将被删除），默认 0.15
 * @param dryRun 是否为试运行（不实际删除），默认 false
 */
export async function scanAndForget(
  userId: string,
  forgetThreshold: number = 0.15,
  dryRun: boolean = false,
): Promise<ForgetResult> {
  const result: ForgetResult = {
    user_id: userId,
    scanned: 0,
    decayed: 0,
    forgotten: 0,
    consolidated: 0,
    details: [],
  };

  // 获取该用户所有记忆的元数据
  const allMeta = db.prepare(
    'SELECT * FROM memory_metadata WHERE user_id = ? AND is_consolidated = 0'
  ).all(userId) as any[];

  result.scanned = allMeta.length;

  if (allMeta.length === 0) {
    console.log(`[Forgetter] 用户 ${userId}: 无记忆需要扫描`);
    return result;
  }

  const toForget: string[] = [];

  const scanTransaction = db.transaction(() => {
    for (const meta of allMeta) {
      const oldRetention = meta.retention_score;
      const newRetention = calculateDecayedRetention(meta);

      // 更新衰减后的保留分数
      if (Math.abs(newRetention - oldRetention) > 0.001) {
        if (!dryRun) {
          db.prepare('UPDATE memory_metadata SET retention_score = ? WHERE memory_id = ?')
            .run(newRetention, meta.memory_id);
        }
        result.decayed++;
        result.details.push({
          memory_id: meta.memory_id,
          action: 'decayed',
          retention_before: oldRetention,
          retention_after: newRetention,
          reason: `时间衰减: ${oldRetention.toFixed(3)} → ${newRetention.toFixed(3)}`,
        });
      }

      // 判断是否需要遗忘
      if (newRetention < forgetThreshold) {
        toForget.push(meta.memory_id);
        result.forgotten++;
        result.details.push({
          memory_id: meta.memory_id,
          action: 'forgotten',
          retention_before: oldRetention,
          retention_after: newRetention,
          reason: `保留分数 ${newRetention.toFixed(3)} 低于阈值 ${forgetThreshold}`,
        });

        if (!dryRun) {
          // 记录遗忘日志
          db.prepare(`
            INSERT INTO forgetting_log (user_id, memory_id, action, reason, retention_score_before)
            VALUES (?, ?, 'forgotten', ?, ?)
          `).run(userId, meta.memory_id, `保留分数 ${newRetention.toFixed(3)} < ${forgetThreshold}`, oldRetention);
        }
      }
    }

    // 执行遗忘：删除低分记忆
    if (!dryRun && toForget.length > 0) {
      const placeholders = toForget.map(() => '?').join(',');
      db.prepare(`DELETE FROM episodic_memories WHERE id IN (${placeholders})`).run(...toForget);
      db.prepare(`DELETE FROM memory_metadata WHERE memory_id IN (${placeholders})`).run(...toForget);
    }
  });

  scanTransaction();

  console.log(`[Forgetter] 用户 ${userId}: 扫描 ${result.scanned} 条, 衰减 ${result.decayed} 条, 遗忘 ${result.forgotten} 条${dryRun ? ' (试运行)' : ''}`);

  return result;
}

/**
 * 对所有用户执行遗忘扫描
 */
export async function scanAllUsers(
  forgetThreshold: number = 0.15,
  dryRun: boolean = false,
): Promise<ForgetResult[]> {
  const userIds = db.prepare('SELECT DISTINCT user_id FROM memory_metadata').all() as any[];
  const results: ForgetResult[] = [];

  for (const row of userIds) {
    const result = await scanAndForget(row.user_id, forgetThreshold, dryRun);
    results.push(result);
  }

  return results;
}

// ========== 记忆合并压缩 ==========

/**
 * 合并相似的低重要性记忆
 * 将多条相似记忆合并为一条摘要记忆
 */
export async function consolidateMemories(
  userId: string,
  memoryIds: string[],
  consolidatedSummary: string,
): Promise<string | null> {
  if (memoryIds.length < 2) return null;

  const consolidateTransaction = db.transaction(() => {
    // 创建合并后的新记忆
    const newId = `consolidated_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO episodic_memories (id, user_id, date, event_type, summary, participants, location, details, importance, created_at)
      VALUES (?, ?, ?, '合并记忆', ?, '[]', '', ?, 3, ?)
    `).run(newId, userId, now.slice(0, 10), consolidatedSummary, `由 ${memoryIds.length} 条记忆合并而成`, now);

    // 创建新记忆的元数据
    createMemoryMetadata(newId, userId, 3);

    // 标记原始记忆为已合并
    const placeholders = memoryIds.map(() => '?').join(',');
    db.prepare(`
      UPDATE memory_metadata SET is_consolidated = 1, consolidated_into = ? WHERE memory_id IN (${placeholders})
    `).run(newId, ...memoryIds);

    // 记录合并日志
    for (const mid of memoryIds) {
      db.prepare(`
        INSERT INTO forgetting_log (user_id, memory_id, action, reason)
        VALUES (?, ?, 'consolidated', ?)
      `).run(userId, mid, `合并到 ${newId}`);
    }

    // 删除原始记忆
    db.prepare(`DELETE FROM episodic_memories WHERE id IN (${placeholders})`).run(...memoryIds);

    return newId;
  });

  const newId = consolidateTransaction();
  console.log(`[Forgetter] 合并 ${memoryIds.length} 条记忆 → ${newId}`);
  return newId as string;
}

// ========== 查询接口 ==========

/**
 * 获取用户记忆的遗忘状态概览
 */
export function getForgetterStats(userId: string): any {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM memory_metadata WHERE user_id = ?').get(userId) as any;
  const active = db.prepare('SELECT COUNT(*) as cnt FROM memory_metadata WHERE user_id = ? AND is_consolidated = 0').get(userId) as any;
  const consolidated = db.prepare('SELECT COUNT(*) as cnt FROM memory_metadata WHERE user_id = ? AND is_consolidated = 1').get(userId) as any;
  
  const avgRetention = db.prepare(
    'SELECT AVG(retention_score) as avg_score FROM memory_metadata WHERE user_id = ? AND is_consolidated = 0'
  ).get(userId) as any;

  const atRisk = db.prepare(
    'SELECT COUNT(*) as cnt FROM memory_metadata WHERE user_id = ? AND is_consolidated = 0 AND retention_score < 0.3'
  ).get(userId) as any;

  const recentForgotten = db.prepare(
    'SELECT COUNT(*) as cnt FROM forgetting_log WHERE user_id = ? AND action = \'forgotten\' AND executed_at > datetime(\'now\', \'-7 days\')'
  ).get(userId) as any;

  return {
    user_id: userId,
    total_tracked: total?.cnt || 0,
    active_memories: active?.cnt || 0,
    consolidated_memories: consolidated?.cnt || 0,
    average_retention: avgRetention?.avg_score ? Number(avgRetention.avg_score.toFixed(3)) : 0,
    at_risk_count: atRisk?.cnt || 0,
    recently_forgotten: recentForgotten?.cnt || 0,
  };
}

/**
 * 获取遗忘日志
 */
export function getForgetterLog(userId: string, limit: number = 20): any[] {
  return db.prepare(
    'SELECT * FROM forgetting_log WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?'
  ).all(userId, limit) as any[];
}

/**
 * 获取单条记忆的元数据
 */
export function getMemoryMetadata(memoryId: string): any {
  return db.prepare('SELECT * FROM memory_metadata WHERE memory_id = ?').get(memoryId);
}

/**
 * 获取用户所有记忆的保留分数排名
 */
export function getRetentionRanking(userId: string): any[] {
  const rows = db.prepare(`
    SELECT mm.*, em.summary, em.date, em.event_type, em.importance
    FROM memory_metadata mm
    JOIN episodic_memories em ON mm.memory_id = em.id
    WHERE mm.user_id = ? AND mm.is_consolidated = 0
    ORDER BY mm.retention_score ASC
  `).all(userId) as any[];

  return rows.map(r => ({
    memory_id: r.memory_id,
    summary: r.summary,
    date: r.date,
    event_type: r.event_type,
    importance: r.importance,
    retention_score: Number(r.retention_score.toFixed(3)),
    access_count: r.access_count,
    last_accessed_at: r.last_accessed_at,
    decay_rate: r.decay_rate,
  }));
}

// ========== 定时任务 ==========

let forgetterInterval: NodeJS.Timeout | null = null;

/**
 * 启动定时遗忘扫描
 * @param intervalMinutes 扫描间隔（分钟），默认 60 分钟
 */
export function startForgetterScheduler(intervalMinutes: number = 60): void {
  if (forgetterInterval) {
    clearInterval(forgetterInterval);
  }

  console.log(`[Forgetter] 定时遗忘扫描已启动，间隔: ${intervalMinutes} 分钟`);

  forgetterInterval = setInterval(async () => {
    console.log('[Forgetter] 执行定时遗忘扫描...');
    try {
      const results = await scanAllUsers();
      const totalForgotten = results.reduce((sum, r) => sum + r.forgotten, 0);
      const totalDecayed = results.reduce((sum, r) => sum + r.decayed, 0);
      console.log(`[Forgetter] 定时扫描完成: ${results.length} 个用户, ${totalDecayed} 条衰减, ${totalForgotten} 条遗忘`);
    } catch (error: any) {
      console.error('[Forgetter] 定时扫描失败:', error.message);
    }
  }, intervalMinutes * 60 * 1000);
}

/**
 * 停止定时遗忘扫描
 */
export function stopForgetterScheduler(): void {
  if (forgetterInterval) {
    clearInterval(forgetterInterval);
    forgetterInterval = null;
    console.log('[Forgetter] 定时遗忘扫描已停止');
  }
}

// 初始化表结构
initForgetterTables();
