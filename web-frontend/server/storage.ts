/**
 * 存储模块 - 基于 SQLite 的持久化存储
 * 替代原有的内存存储方案，服务重启后数据不会丢失
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件存放在项目根目录的 data 文件夹下
const DB_PATH = path.join(__dirname, '..', 'data', 'smartagent2.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库连接
const db = new Database(DB_PATH);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');

// ========== 数据库初始化 ==========

function initDatabase() {
  // 用户画像表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      basic_info TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 用户偏好表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      context TEXT,
      FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pref_user ON user_preferences(user_id)`);

  // 用户关系表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      person_name TEXT NOT NULL,
      relationship TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_user ON user_relationships(user_id)`);

  // 情景记忆表
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      participants TEXT DEFAULT '[]',
      location TEXT DEFAULT '',
      details TEXT DEFAULT '',
      importance INTEGER DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_user ON episodic_memories(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_date ON episodic_memories(user_id, date DESC)`);
}

// ========== 初始数据种子 ==========

function seedInitialData() {
  // 检查是否已有数据
  const count = db.prepare('SELECT COUNT(*) as cnt FROM user_profiles').get() as any;
  if (count.cnt > 0) {
    console.log('[Storage] 数据库已有数据，跳过种子数据初始化');
    return;
  }

  console.log('[Storage] 首次启动，初始化种子数据...');

  const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // ===== 插入用户画像 =====
  const insertProfile = db.prepare(
    'INSERT INTO user_profiles (user_id, basic_info, updated_at) VALUES (?, ?, ?)'
  );
  const insertPref = db.prepare(
    'INSERT INTO user_preferences (id, user_id, category, key, value, context) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO user_relationships (user_id, person_name, relationship, details, tags) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMemory = db.prepare(
    'INSERT INTO episodic_memories (id, user_id, date, event_type, summary, participants, location, details, importance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const seedAll = db.transaction(() => {
    // --- 张明 ---
    insertProfile.run('zhangming', JSON.stringify({ name: '张明', age: '35', occupation: '软件工程师', phone: '138****6789' }), new Date().toISOString());

    const zmPrefs = [
      { id: 'zm_p1', category: '音乐', key: '喜欢的歌手', value: '周杰伦、五月天、林俊杰' },
      { id: 'zm_p2', category: '音乐', key: '喜欢的歌曲', value: '晴天、倔强、江南、稻香' },
      { id: 'zm_p3', category: '音乐', key: '音乐风格', value: '华语流行、摇滚' },
      { id: 'zm_p4', category: '音乐', key: '通勤音乐偏好', value: '五月天', context: '通勤' },
      { id: 'zm_p5', category: '空调', key: '温度', value: '23°C' },
      { id: 'zm_p6', category: '空调', key: '风量', value: '中风' },
      { id: 'zm_p7', category: '空调', key: '模式', value: '自动' },
      { id: 'zm_p8', category: '座椅', key: '座椅加热', value: '中档' },
      { id: 'zm_p9', category: '座椅', key: '座椅位置', value: '记忆位置 1' },
      { id: 'zm_p10', category: '导航', key: '上班地址', value: '科技园 A 座 18 楼' },
      { id: 'zm_p11', category: '导航', key: '常去超市', value: '山姆会员店（南山店）' },
      { id: 'zm_p12', category: '饮食', key: '口味偏好', value: '川菜、湘菜，偏辣' },
    ];
    zmPrefs.forEach(p => insertPref.run(p.id, 'zhangming', p.category, p.key, p.value, (p as any).context || null));

    const zmRels = [
      { person_name: '李芳', relationship: '妻子', details: { age: '33', occupation: '设计师', hobby: '瑜伽、烘焙、逛展览' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级', hobby: '画画、跳舞、看动画片' }, tags: ['家人', '孩子'] },
      { person_name: '妈妈（张母）', relationship: '母亲', details: { age: '62', health: '膝盖不好，有轻微关节炎' }, tags: ['家人', '长辈'] },
      { person_name: '老王', relationship: '同事/好友', details: { hobby: '钓鱼、露营、自驾游' }, tags: ['朋友', '同事'] },
    ];
    zmRels.forEach(r => insertRel.run('zhangming', r.person_name, r.relationship, JSON.stringify(r.details), JSON.stringify(r.tags)));

    const zmMemories = [
      { id: 'zm_e1', date: daysAgo(1), event_type: '通勤', summary: '早上 8:30 开车去公司，路上听五月天', participants: ['zhangming'], location: '家 → 科技园', details: '早高峰，路况一般，听了《倔强》《温柔》', importance: 3 },
      { id: 'zm_e2', date: daysAgo(2), event_type: '购物', summary: '周末和老婆去山姆会员店采购', participants: ['zhangming', 'lifang'], location: '山姆会员店（南山店）', details: '买了一周的食材和日用品，花费约 800 元', importance: 4 },
      { id: 'zm_e3', date: daysAgo(3), event_type: '家庭', summary: '送女儿去上兴趣班', participants: ['zhangming', 'xiaomeng'], location: '少年宫', details: '小萌上绘画课，路上聊了学校的事情', importance: 5 },
      { id: 'zm_e4', date: daysAgo(7), event_type: '探亲', summary: '去老城区看望妈妈', participants: ['zhangming', 'lifang', 'xiaomeng'], location: '翠苑小区', details: '妈妈膝盖疼痛有所缓解，带了补品和水果', importance: 5 },
      { id: 'zm_e5', date: daysAgo(14), event_type: '社交', summary: '和老王去钓鱼', participants: ['zhangming'], location: '西丽水库', details: '周末休闲活动，钓了几条小鱼，聊了工作和生活', importance: 3 },
    ];
    zmMemories.forEach(m => insertMemory.run(m.id, 'zhangming', m.date, m.event_type, m.summary, JSON.stringify(m.participants), m.location, m.details, m.importance));

    // --- 李芳 ---
    insertProfile.run('lifang', JSON.stringify({ name: '李芳', age: '33', occupation: '设计师', phone: '139****1234' }), new Date().toISOString());

    const lfPrefs = [
      { id: 'lf_p1', category: '音乐', key: '喜欢的歌手', value: '邓紫棋、Taylor Swift、Adele' },
      { id: 'lf_p2', category: '音乐', key: '喜欢的歌曲', value: '光年之外、Love Story、泡沫' },
      { id: 'lf_p3', category: '空调', key: '温度', value: '25°C' },
      { id: 'lf_p4', category: '空调', key: '风量', value: '低风' },
      { id: 'lf_p5', category: '座椅', key: '座椅通风', value: '开启' },
    ];
    lfPrefs.forEach(p => insertPref.run(p.id, 'lifang', p.category, p.key, p.value, null));

    const lfRels = [
      { person_name: '张明', relationship: '丈夫', details: { age: '35', occupation: '软件工程师' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级' }, tags: ['家人', '孩子'] },
    ];
    lfRels.forEach(r => insertRel.run('lifang', r.person_name, r.relationship, JSON.stringify(r.details), JSON.stringify(r.tags)));

    const lfMemories = [
      { id: 'lf_e1', date: daysAgo(1), event_type: '工作', summary: '去客户公司讨论设计方案', participants: ['lifang'], location: '南山科技园', details: '展示了新的 UI 设计稿，客户反馈不错', importance: 4 },
      { id: 'lf_e2', date: daysAgo(2), event_type: '购物', summary: '和老公去山姆会员店采购', participants: ['lifang', 'zhangming'], location: '山姆会员店（南山店）', details: '买了一周的食材和日用品', importance: 4 },
      { id: 'lf_e3', date: daysAgo(5), event_type: '健身', summary: '晚上去瑜伽馆上课', participants: ['lifang'], location: '悦动瑜伽馆', details: '上了一节流瑜伽课，感觉颈椎舒服多了', importance: 3 },
    ];
    lfMemories.forEach(m => insertMemory.run(m.id, 'lifang', m.date, m.event_type, m.summary, JSON.stringify(m.participants), m.location, m.details, m.importance));

    // --- 张小萌 ---
    insertProfile.run('xiaomeng', JSON.stringify({ name: '张小萌', age: '8', school: '阳光小学三年级' }), new Date().toISOString());

    const xmPrefs = [
      { id: 'xm_p1', category: '音乐', key: '喜欢的歌手', value: '儿歌、迪士尼音乐' },
      { id: 'xm_p2', category: '饮食', key: '喜欢的食物', value: '草莓蛋糕、冰淇淋' },
    ];
    xmPrefs.forEach(p => insertPref.run(p.id, 'xiaomeng', p.category, p.key, p.value, null));

    const xmRels = [
      { person_name: '张明', relationship: '爸爸', details: { age: '35' }, tags: ['家人'] },
      { person_name: '李芳', relationship: '妈妈', details: { age: '33' }, tags: ['家人'] },
    ];
    xmRels.forEach(r => insertRel.run('xiaomeng', r.person_name, r.relationship, JSON.stringify(r.details), JSON.stringify(r.tags)));

    const xmMemories = [
      { id: 'xm_e1', date: daysAgo(1), event_type: '学习', summary: '在学校上美术课', participants: ['xiaomeng'], location: '阳光小学', details: '画了一幅春天的画，老师表扬了', importance: 4 },
      { id: 'xm_e2', date: daysAgo(3), event_type: '兴趣班', summary: '爸爸送我去上绘画课', participants: ['xiaomeng', 'zhangming'], location: '少年宫', details: '学习了水彩画技巧，很开心', importance: 5 },
    ];
    xmMemories.forEach(m => insertMemory.run(m.id, 'xiaomeng', m.date, m.event_type, m.summary, JSON.stringify(m.participants), m.location, m.details, m.importance));
  });

  seedAll();
  console.log('[Storage] 种子数据初始化完成');
}

// 执行初始化
initDatabase();
seedInitialData();

// ========== 用户画像接口 ==========

export async function getUserProfile(userId: string): Promise<any> {
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!profile) return null;

  const preferences = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').all(userId) as any[];
  const relationships = db.prepare('SELECT * FROM user_relationships WHERE user_id = ?').all(userId) as any[];

  return {
    user_id: profile.user_id,
    basic_info: JSON.parse(profile.basic_info),
    preferences: preferences.map(p => ({
      id: p.id,
      category: p.category,
      key: p.key,
      value: p.value,
      ...(p.context ? { context: p.context } : {}),
    })),
    relationships: relationships.map(r => ({
      person_name: r.person_name,
      relationship: r.relationship,
      details: JSON.parse(r.details),
      tags: JSON.parse(r.tags),
    })),
    updated_at: profile.updated_at,
  };
}

export async function updateUserProfile(userId: string, data: any): Promise<any> {
  const existing = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!existing) {
    throw new Error('User not found');
  }

  const updateTransaction = db.transaction(() => {
    // 更新基本信息
    if (data.basic_info) {
      const currentBasicInfo = JSON.parse(existing.basic_info);
      const newBasicInfo = { ...currentBasicInfo, ...data.basic_info };
      db.prepare('UPDATE user_profiles SET basic_info = ?, updated_at = ? WHERE user_id = ?')
        .run(JSON.stringify(newBasicInfo), new Date().toISOString(), userId);
    }

    // 更新偏好设置（全量替换）
    if (data.preferences) {
      db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
      const insertPref = db.prepare(
        'INSERT INTO user_preferences (id, user_id, category, key, value, context) VALUES (?, ?, ?, ?, ?, ?)'
      );
      data.preferences.forEach((p: any, idx: number) => {
        insertPref.run(p.id || `${userId}_p${idx + 1}`, userId, p.category, p.key, p.value, p.context || null);
      });
    }

    // 更新关系（全量替换）
    if (data.relationships) {
      db.prepare('DELETE FROM user_relationships WHERE user_id = ?').run(userId);
      const insertRel = db.prepare(
        'INSERT INTO user_relationships (user_id, person_name, relationship, details, tags) VALUES (?, ?, ?, ?, ?)'
      );
      data.relationships.forEach((r: any) => {
        insertRel.run(userId, r.person_name, r.relationship, JSON.stringify(r.details || {}), JSON.stringify(r.tags || []));
      });
    }

    // 更新时间戳
    db.prepare('UPDATE user_profiles SET updated_at = ? WHERE user_id = ?')
      .run(new Date().toISOString(), userId);
  });

  updateTransaction();

  return getUserProfile(userId);
}

// ========== 记忆统计接口 ==========

export async function getMemoryStats(userId: string): Promise<any> {
  const memoryCount = db.prepare('SELECT COUNT(*) as cnt FROM episodic_memories WHERE user_id = ?').get(userId) as any;
  const prefCount = db.prepare('SELECT COUNT(*) as cnt FROM user_preferences WHERE user_id = ?').get(userId) as any;
  const oldest = db.prepare('SELECT date FROM episodic_memories WHERE user_id = ? ORDER BY date ASC LIMIT 1').get(userId) as any;
  const newest = db.prepare('SELECT date FROM episodic_memories WHERE user_id = ? ORDER BY date DESC LIMIT 1').get(userId) as any;

  return {
    user_id: userId,
    episodic_count: memoryCount?.cnt || 0,
    semantic_count: prefCount?.cnt || 0,
    total_memories: (memoryCount?.cnt || 0) + (prefCount?.cnt || 0),
    oldest_memory: oldest?.date || null,
    newest_memory: newest?.date || null,
  };
}

// ========== 情景记忆接口 ==========

export async function getEpisodicMemories(userId: string, limit: number = 20): Promise<any[]> {
  const memories = db.prepare(
    'SELECT * FROM episodic_memories WHERE user_id = ? ORDER BY date DESC, created_at DESC LIMIT ?'
  ).all(userId, limit) as any[];

  return memories.map(m => ({
    id: m.id,
    date: m.date,
    event_type: m.event_type,
    summary: m.summary,
    participants: JSON.parse(m.participants),
    location: m.location,
    details: m.details,
    importance: m.importance,
  }));
}

export async function addEpisodicMemory(userId: string, memory: any): Promise<void> {
  const id = memory.id || `e_${Date.now()}`;
  const date = memory.date || new Date().toISOString().slice(0, 10);

  db.prepare(
    'INSERT INTO episodic_memories (id, user_id, date, event_type, summary, participants, location, details, importance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    userId,
    date,
    memory.event_type || '',
    memory.summary || '',
    JSON.stringify(memory.participants || []),
    memory.location || '',
    memory.details || '',
    memory.importance || 3
  );

  // 保持每个用户最多 200 条记忆（比原来的 100 条更宽裕）
  const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM episodic_memories WHERE user_id = ?').get(userId) as any;
  if (totalCount.cnt > 200) {
    db.prepare(`
      DELETE FROM episodic_memories WHERE id IN (
        SELECT id FROM episodic_memories WHERE user_id = ? ORDER BY date ASC, created_at ASC LIMIT ?
      )
    `).run(userId, totalCount.cnt - 200);
  }
}

export async function deleteEpisodicMemory(memoryId: string): Promise<boolean> {
  const result = db.prepare('DELETE FROM episodic_memories WHERE id = ?').run(memoryId);
  return result.changes > 0;
}

export async function updateEpisodicMemory(memoryId: string, updates: any): Promise<boolean> {
  const existing = db.prepare('SELECT * FROM episodic_memories WHERE id = ?').get(memoryId) as any;
  if (!existing) return false;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.details !== undefined) { fields.push('details = ?'); values.push(updates.details); }
  if (updates.event_type !== undefined) { fields.push('event_type = ?'); values.push(updates.event_type); }
  if (updates.location !== undefined) { fields.push('location = ?'); values.push(updates.location); }
  if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(updates.importance); }
  if (updates.participants !== undefined) { fields.push('participants = ?'); values.push(JSON.stringify(updates.participants)); }

  if (fields.length === 0) return false;

  values.push(memoryId);
  db.prepare(`UPDATE episodic_memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return true;
}

/**
 * 获取所有记忆（用于遗忘模块扫描，不限制数量）
 */
export async function getAllEpisodicMemories(userId: string): Promise<any[]> {
  const memories = db.prepare(
    'SELECT * FROM episodic_memories WHERE user_id = ? ORDER BY date DESC, created_at DESC'
  ).all(userId) as any[];

  return memories.map(m => ({
    id: m.id,
    date: m.date,
    event_type: m.event_type,
    summary: m.summary,
    participants: JSON.parse(m.participants),
    location: m.location,
    details: m.details,
    importance: m.importance,
    created_at: m.created_at,
  }));
}

/**
 * 批量删除记忆（用于遗忘模块）
 */
export async function batchDeleteMemories(memoryIds: string[]): Promise<number> {
  if (memoryIds.length === 0) return 0;
  const placeholders = memoryIds.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM episodic_memories WHERE id IN (${placeholders})`).run(...memoryIds);
  return result.changes;
}

/**
 * 获取所有用户 ID（用于遗忘模块定时扫描）
 */
export function getAllUserIds(): string[] {
  const rows = db.prepare('SELECT user_id FROM user_profiles').all() as any[];
  return rows.map(r => r.user_id);
}

// 优雅关闭数据库连接
process.on('exit', () => {
  db.close();
});

process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
