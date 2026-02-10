/**
 * 画像管理模块 (Profile Manager)
 * 
 * 功能：从对话中自动提取和更新用户画像（偏好、习惯、兴趣）
 * 设计参考：SmartAgent2 架构设计文档 v2.0
 * 
 * 核心能力：
 * 1. 偏好更新：从对话中识别并更新用户偏好（音乐、空调、导航等）
 * 2. 场景化绑定：偏好与使用场景关联（通勤、周末、雨天等）
 * 3. 冲突检测：当新偏好与旧偏好冲突时，智能合并或替换
 * 4. 关系管理：从对话中识别和更新人际关系信息
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'smartagent2.db');
const db = new Database(DB_PATH);

// ========== 偏好管理 ==========

interface PreferenceUpdate {
  category: string;
  key: string;
  value: string;
  context?: string | null;
}

/**
 * 智能更新用户偏好
 * - 如果已存在相同 category + key + context 的偏好，则更新 value
 * - 如果不存在，则新增
 * - 支持场景化绑定（context）
 */
export async function upsertPreference(userId: string, pref: PreferenceUpdate): Promise<void> {
  const existing = db.prepare(
    'SELECT * FROM user_preferences WHERE user_id = ? AND category = ? AND key = ? AND (context = ? OR (context IS NULL AND ? IS NULL))'
  ).get(userId, pref.category, pref.key, pref.context || null, pref.context || null) as any;

  if (existing) {
    // 更新已有偏好
    db.prepare('UPDATE user_preferences SET value = ? WHERE id = ?')
      .run(pref.value, existing.id);
    console.log(`[ProfileManager] 更新偏好: ${pref.category}/${pref.key} = ${pref.value}`);
  } else {
    // 新增偏好
    const id = `${userId}_p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(
      'INSERT INTO user_preferences (id, user_id, category, key, value, context) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, pref.category, pref.key, pref.value, pref.context || null);
    console.log(`[ProfileManager] 新增偏好: ${pref.category}/${pref.key} = ${pref.value}`);
  }

  // 更新用户画像的时间戳
  db.prepare('UPDATE user_profiles SET updated_at = ? WHERE user_id = ?')
    .run(new Date().toISOString(), userId);
}

/**
 * 批量更新偏好
 */
export async function batchUpsertPreferences(userId: string, prefs: PreferenceUpdate[]): Promise<void> {
  const batchUpdate = db.transaction(() => {
    for (const pref of prefs) {
      const existing = db.prepare(
        'SELECT * FROM user_preferences WHERE user_id = ? AND category = ? AND key = ? AND (context = ? OR (context IS NULL AND ? IS NULL))'
      ).get(userId, pref.category, pref.key, pref.context || null, pref.context || null) as any;

      if (existing) {
        db.prepare('UPDATE user_preferences SET value = ? WHERE id = ?')
          .run(pref.value, existing.id);
      } else {
        const id = `${userId}_p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(
          'INSERT INTO user_preferences (id, user_id, category, key, value, context) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, userId, pref.category, pref.key, pref.value, pref.context || null);
      }
    }

    db.prepare('UPDATE user_profiles SET updated_at = ? WHERE user_id = ?')
      .run(new Date().toISOString(), userId);
  });

  batchUpdate();
}

/**
 * 删除指定偏好
 */
export async function deletePreference(userId: string, prefId: string): Promise<boolean> {
  const result = db.prepare('DELETE FROM user_preferences WHERE id = ? AND user_id = ?').run(prefId, userId);
  return result.changes > 0;
}

/**
 * 按类别获取偏好
 */
export async function getPreferencesByCategory(userId: string, category: string): Promise<any[]> {
  return db.prepare('SELECT * FROM user_preferences WHERE user_id = ? AND category = ?')
    .all(userId, category) as any[];
}

/**
 * 按场景获取偏好
 */
export async function getPreferencesByContext(userId: string, context: string): Promise<any[]> {
  return db.prepare('SELECT * FROM user_preferences WHERE user_id = ? AND context = ?')
    .all(userId, context) as any[];
}

// ========== 关系管理 ==========

interface RelationshipUpdate {
  person_name: string;
  relationship: string;
  details?: Record<string, any>;
  tags?: string[];
}

/**
 * 智能更新用户关系
 * - 如果已存在相同 person_name 的关系，则更新
 * - 如果不存在，则新增
 */
export async function upsertRelationship(userId: string, rel: RelationshipUpdate): Promise<void> {
  const existing = db.prepare(
    'SELECT * FROM user_relationships WHERE user_id = ? AND person_name = ?'
  ).get(userId, rel.person_name) as any;

  if (existing) {
    // 合并 details：保留旧信息，用新信息覆盖
    const oldDetails = JSON.parse(existing.details || '{}');
    const newDetails = { ...oldDetails, ...(rel.details || {}) };
    
    // 合并 tags：取并集
    const oldTags = JSON.parse(existing.tags || '[]');
    const newTags = [...new Set([...oldTags, ...(rel.tags || [])])];

    db.prepare(
      'UPDATE user_relationships SET relationship = ?, details = ?, tags = ? WHERE id = ?'
    ).run(rel.relationship, JSON.stringify(newDetails), JSON.stringify(newTags), existing.id);
    
    console.log(`[ProfileManager] 更新关系: ${rel.person_name} (${rel.relationship})`);
  } else {
    db.prepare(
      'INSERT INTO user_relationships (user_id, person_name, relationship, details, tags) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, rel.person_name, rel.relationship, JSON.stringify(rel.details || {}), JSON.stringify(rel.tags || []));
    
    console.log(`[ProfileManager] 新增关系: ${rel.person_name} (${rel.relationship})`);
  }
}

/**
 * 删除关系
 */
export async function deleteRelationship(userId: string, relationshipId: number): Promise<boolean> {
  const result = db.prepare('DELETE FROM user_relationships WHERE id = ? AND user_id = ?').run(relationshipId, userId);
  return result.changes > 0;
}

/**
 * 获取用户所有关系
 */
export async function getRelationships(userId: string): Promise<any[]> {
  const rows = db.prepare('SELECT * FROM user_relationships WHERE user_id = ?').all(userId) as any[];
  return rows.map(r => ({
    id: r.id,
    person_name: r.person_name,
    relationship: r.relationship,
    details: JSON.parse(r.details),
    tags: JSON.parse(r.tags),
  }));
}

// ========== 基本信息管理 ==========

/**
 * 更新用户基本信息（部分更新）
 */
export async function updateBasicInfo(userId: string, updates: Record<string, any>): Promise<any> {
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!profile) throw new Error('User not found');

  const currentInfo = JSON.parse(profile.basic_info);
  const newInfo = { ...currentInfo, ...updates };

  db.prepare('UPDATE user_profiles SET basic_info = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(newInfo), new Date().toISOString(), userId);

  return newInfo;
}

// ========== 画像快照 ==========

/**
 * 获取用户画像的完整快照（用于 LLM 上下文）
 */
export async function getProfileSnapshot(userId: string): Promise<any> {
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  if (!profile) return null;

  const preferences = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').all(userId) as any[];
  const relationships = db.prepare('SELECT * FROM user_relationships WHERE user_id = ?').all(userId) as any[];

  // 按类别组织偏好
  const prefsByCategory: Record<string, any[]> = {};
  for (const p of preferences) {
    if (!prefsByCategory[p.category]) {
      prefsByCategory[p.category] = [];
    }
    prefsByCategory[p.category].push({
      key: p.key,
      value: p.value,
      context: p.context,
    });
  }

  return {
    user_id: userId,
    basic_info: JSON.parse(profile.basic_info),
    preferences_by_category: prefsByCategory,
    preferences_count: preferences.length,
    relationships: relationships.map(r => ({
      person_name: r.person_name,
      relationship: r.relationship,
      details: JSON.parse(r.details),
      tags: JSON.parse(r.tags),
    })),
    updated_at: profile.updated_at,
  };
}
