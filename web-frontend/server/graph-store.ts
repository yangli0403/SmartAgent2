/**
 * 图谱构建 (Graph Store) 模块
 * 
 * 核心功能：
 * 1. 实体-关系图谱：从对话和记忆中提取实体及其关系，构建知识图谱
 * 2. 实体管理：支持实体的 CRUD 操作，包括属性更新和合并
 * 3. 关系推理：基于已有关系进行简单推理（如传递性关系）
 * 4. 图谱查询：支持按实体、关系类型、路径等方式查询
 * 5. 图谱可视化数据：提供前端可视化所需的节点和边数据
 * 
 * 设计参考：
 * - 架构设计文档中的 GraphStore：实体-关系图谱
 * - 生产环境使用 Neo4j，当前使用 SQLite 表模拟
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 使用与 storage 相同的数据库文件
const DB_PATH = path.join(__dirname, '..', 'data', 'smartagent2.db');

import fs from 'fs';
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// ========== 类型定义 ==========

/** 实体类型 */
export type EntityType = 
  | 'person'       // 人物
  | 'location'     // 地点
  | 'organization' // 组织/机构
  | 'vehicle'      // 车辆
  | 'event'        // 事件
  | 'preference'   // 偏好
  | 'time'         // 时间点/时间段
  | 'item';        // 物品

/** 关系类型 */
export type RelationType = 
  | 'family'       // 家庭关系（父子、夫妻等）
  | 'friend'       // 朋友关系
  | 'colleague'    // 同事关系
  | 'lives_at'     // 居住在
  | 'works_at'     // 工作在
  | 'visits'       // 经常去
  | 'likes'        // 喜欢
  | 'dislikes'     // 不喜欢
  | 'owns'         // 拥有
  | 'participates' // 参与
  | 'related_to';  // 通用关联

/** 图谱实体 */
export interface GraphEntity {
  id: string;
  user_id: string;
  name: string;
  type: EntityType;
  properties: Record<string, any>;
  /** 来源（对话/记忆/手动） */
  source: 'conversation' | 'memory' | 'manual' | 'seed';
  /** 置信度 (0-1) */
  confidence: number;
  /** 提及次数 */
  mention_count: number;
  created_at: string;
  updated_at: string;
}

/** 图谱关系（边） */
export interface GraphRelation {
  id: string;
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  /** 关系描述 */
  label: string;
  /** 关系属性 */
  properties: Record<string, any>;
  /** 关系强度 (0-1) */
  weight: number;
  /** 来源 */
  source: 'conversation' | 'memory' | 'manual' | 'seed';
  confidence: number;
  created_at: string;
  updated_at: string;
}

/** 图谱可视化数据 */
export interface GraphVisualization {
  nodes: Array<{
    id: string;
    label: string;
    type: EntityType;
    properties: Record<string, any>;
    size: number; // 基于 mention_count
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    type: RelationType;
    weight: number;
  }>;
  stats: {
    total_nodes: number;
    total_edges: number;
    entity_types: Record<string, number>;
    relation_types: Record<string, number>;
  };
}

// ========== 数据库初始化 ==========

function initGraphTables() {
  // 实体表
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_entities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      source TEXT DEFAULT 'manual',
      confidence REAL DEFAULT 1.0,
      mention_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_user ON graph_entities(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_type ON graph_entities(user_id, type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_name ON graph_entities(user_id, name)`);

  // 关系表
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_relations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      label TEXT DEFAULT '',
      properties TEXT DEFAULT '{}',
      weight REAL DEFAULT 1.0,
      source TEXT DEFAULT 'manual',
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_entity_id) REFERENCES graph_entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES graph_entities(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gr_user ON graph_relations(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gr_source ON graph_relations(source_entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gr_target ON graph_relations(target_entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gr_type ON graph_relations(user_id, relation_type)`);
}

// ========== 种子数据 ==========

function seedGraphData() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM graph_entities').get() as any;
  if (count.cnt > 0) {
    console.log('[GraphStore] 图谱数据已存在，跳过种子初始化');
    return;
  }

  console.log('[GraphStore] 初始化图谱种子数据...');

  const insertEntity = db.prepare(`
    INSERT INTO graph_entities (id, user_id, name, type, properties, source, confidence, mention_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRelation = db.prepare(`
    INSERT INTO graph_relations (id, user_id, source_entity_id, target_entity_id, relation_type, label, properties, weight, source, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedAll = db.transaction(() => {
    // ===== 张明的图谱 =====
    // 人物实体
    insertEntity.run('e_zm', 'zhangming', '张明', 'person', JSON.stringify({ age: 35, occupation: '软件工程师', phone: '138****6789' }), 'seed', 1.0, 10);
    insertEntity.run('e_lf', 'zhangming', '李芳', 'person', JSON.stringify({ age: 33, occupation: '设计师', hobby: '瑜伽、烘焙' }), 'seed', 1.0, 8);
    insertEntity.run('e_xm', 'zhangming', '张小萌', 'person', JSON.stringify({ age: 8, school: '阳光小学三年级', hobby: '画画、跳舞' }), 'seed', 1.0, 7);
    insertEntity.run('e_mom', 'zhangming', '张母', 'person', JSON.stringify({ age: 62, health: '膝盖关节炎' }), 'seed', 1.0, 4);
    insertEntity.run('e_lw', 'zhangming', '老王', 'person', JSON.stringify({ hobby: '钓鱼、露营、自驾游' }), 'seed', 1.0, 3);

    // 地点实体
    insertEntity.run('e_home', 'zhangming', '家', 'location', JSON.stringify({ type: '住所' }), 'seed', 1.0, 10);
    insertEntity.run('e_office', 'zhangming', '科技园A座', 'location', JSON.stringify({ type: '办公地点', floor: 18 }), 'seed', 1.0, 8);
    insertEntity.run('e_sam', 'zhangming', '山姆会员店（南山店）', 'location', JSON.stringify({ type: '超市' }), 'seed', 1.0, 5);
    insertEntity.run('e_school', 'zhangming', '阳光小学', 'location', JSON.stringify({ type: '学校' }), 'seed', 1.0, 4);
    insertEntity.run('e_youth', 'zhangming', '少年宫', 'location', JSON.stringify({ type: '兴趣班' }), 'seed', 1.0, 3);
    insertEntity.run('e_cuiyuan', 'zhangming', '翠苑小区', 'location', JSON.stringify({ type: '住所', resident: '张母' }), 'seed', 1.0, 2);
    insertEntity.run('e_xili', 'zhangming', '西丽水库', 'location', JSON.stringify({ type: '休闲场所' }), 'seed', 1.0, 2);

    // 偏好实体
    insertEntity.run('e_music_zjl', 'zhangming', '周杰伦', 'preference', JSON.stringify({ category: '音乐', type: '歌手' }), 'seed', 1.0, 6);
    insertEntity.run('e_music_wyt', 'zhangming', '五月天', 'preference', JSON.stringify({ category: '音乐', type: '歌手', context: '通勤' }), 'seed', 1.0, 8);
    insertEntity.run('e_music_ljj', 'zhangming', '林俊杰', 'preference', JSON.stringify({ category: '音乐', type: '歌手' }), 'seed', 1.0, 3);
    insertEntity.run('e_food_sichuan', 'zhangming', '川菜', 'preference', JSON.stringify({ category: '饮食', type: '菜系' }), 'seed', 1.0, 3);

    // 家庭关系
    insertRelation.run('r_zm_lf', 'zhangming', 'e_zm', 'e_lf', 'family', '妻子', JSON.stringify({ marriage_years: 10 }), 1.0, 'seed', 1.0);
    insertRelation.run('r_zm_xm', 'zhangming', 'e_zm', 'e_xm', 'family', '女儿', JSON.stringify({}), 1.0, 'seed', 1.0);
    insertRelation.run('r_zm_mom', 'zhangming', 'e_zm', 'e_mom', 'family', '母亲', JSON.stringify({}), 1.0, 'seed', 1.0);
    insertRelation.run('r_zm_lw', 'zhangming', 'e_zm', 'e_lw', 'colleague', '同事/好友', JSON.stringify({}), 0.8, 'seed', 1.0);

    // 地点关系
    insertRelation.run('r_zm_home', 'zhangming', 'e_zm', 'e_home', 'lives_at', '居住', JSON.stringify({}), 1.0, 'seed', 1.0);
    insertRelation.run('r_zm_office', 'zhangming', 'e_zm', 'e_office', 'works_at', '工作', JSON.stringify({ floor: 18 }), 1.0, 'seed', 1.0);
    insertRelation.run('r_zm_sam', 'zhangming', 'e_zm', 'e_sam', 'visits', '常去购物', JSON.stringify({ frequency: '每周' }), 0.8, 'seed', 1.0);
    insertRelation.run('r_xm_school', 'zhangming', 'e_xm', 'e_school', 'related_to', '就读', JSON.stringify({}), 1.0, 'seed', 1.0);
    insertRelation.run('r_xm_youth', 'zhangming', 'e_xm', 'e_youth', 'visits', '上兴趣班', JSON.stringify({ subject: '绘画' }), 0.8, 'seed', 1.0);
    insertRelation.run('r_mom_cuiyuan', 'zhangming', 'e_mom', 'e_cuiyuan', 'lives_at', '居住', JSON.stringify({}), 1.0, 'seed', 1.0);

    // 偏好关系
    insertRelation.run('r_zm_zjl', 'zhangming', 'e_zm', 'e_music_zjl', 'likes', '喜欢听', JSON.stringify({}), 0.9, 'seed', 1.0);
    insertRelation.run('r_zm_wyt', 'zhangming', 'e_zm', 'e_music_wyt', 'likes', '通勤时听', JSON.stringify({ context: '通勤' }), 0.95, 'seed', 1.0);
    insertRelation.run('r_zm_ljj', 'zhangming', 'e_zm', 'e_music_ljj', 'likes', '喜欢听', JSON.stringify({}), 0.7, 'seed', 1.0);
    insertRelation.run('r_zm_sichuan', 'zhangming', 'e_zm', 'e_food_sichuan', 'likes', '偏好', JSON.stringify({}), 0.8, 'seed', 1.0);

    // 人物之间的关系
    insertRelation.run('r_lf_xm', 'zhangming', 'e_lf', 'e_xm', 'family', '母女', JSON.stringify({}), 1.0, 'seed', 1.0);
    insertRelation.run('r_lw_xili', 'zhangming', 'e_lw', 'e_xili', 'visits', '钓鱼', JSON.stringify({}), 0.6, 'seed', 1.0);
  });

  seedAll();
  console.log('[GraphStore] 图谱种子数据初始化完成');
}

// 执行初始化
initGraphTables();
seedGraphData();

// ========== 实体 CRUD ==========

/**
 * 创建或更新实体（Upsert）
 */
export function upsertEntity(entity: {
  user_id: string;
  name: string;
  type: EntityType;
  properties?: Record<string, any>;
  source?: string;
  confidence?: number;
}): GraphEntity {
  const now = new Date().toISOString();

  // 检查是否已存在同名同类型实体
  const existing = db.prepare(
    'SELECT * FROM graph_entities WHERE user_id = ? AND name = ? AND type = ?'
  ).get(entity.user_id, entity.name, entity.type) as any;

  if (existing) {
    // 合并属性
    const existingProps = JSON.parse(existing.properties);
    const mergedProps = { ...existingProps, ...(entity.properties || {}) };
    const newConfidence = Math.min(1.0, Math.max(existing.confidence, entity.confidence || 0.8));

    db.prepare(`
      UPDATE graph_entities 
      SET properties = ?, confidence = ?, mention_count = mention_count + 1, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(mergedProps), newConfidence, now, existing.id);

    return {
      ...existing,
      properties: mergedProps,
      confidence: newConfidence,
      mention_count: existing.mention_count + 1,
      updated_at: now,
    };
  }

  // 创建新实体
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO graph_entities (id, user_id, name, type, properties, source, confidence, mention_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    entity.user_id,
    entity.name,
    entity.type,
    JSON.stringify(entity.properties || {}),
    entity.source || 'manual',
    entity.confidence || 1.0,
    now,
    now
  );

  return {
    id,
    user_id: entity.user_id,
    name: entity.name,
    type: entity.type as EntityType,
    properties: entity.properties || {},
    source: (entity.source || 'manual') as any,
    confidence: entity.confidence || 1.0,
    mention_count: 1,
    created_at: now,
    updated_at: now,
  };
}

/**
 * 获取实体
 */
export function getEntity(entityId: string): GraphEntity | null {
  const row = db.prepare('SELECT * FROM graph_entities WHERE id = ?').get(entityId) as any;
  if (!row) return null;
  return {
    ...row,
    properties: JSON.parse(row.properties),
  };
}

/**
 * 按类型查询实体
 */
export function getEntitiesByType(userId: string, type?: EntityType): GraphEntity[] {
  let rows: any[];
  if (type) {
    rows = db.prepare('SELECT * FROM graph_entities WHERE user_id = ? AND type = ? ORDER BY mention_count DESC').all(userId, type) as any[];
  } else {
    rows = db.prepare('SELECT * FROM graph_entities WHERE user_id = ? ORDER BY mention_count DESC').all(userId) as any[];
  }
  return rows.map(r => ({ ...r, properties: JSON.parse(r.properties) }));
}

/**
 * 搜索实体（按名称模糊匹配）
 */
export function searchEntities(userId: string, keyword: string): GraphEntity[] {
  const rows = db.prepare(
    'SELECT * FROM graph_entities WHERE user_id = ? AND name LIKE ? ORDER BY mention_count DESC'
  ).all(userId, `%${keyword}%`) as any[];
  return rows.map(r => ({ ...r, properties: JSON.parse(r.properties) }));
}

/**
 * 删除实体（同时删除相关关系）
 */
export function deleteEntity(entityId: string): boolean {
  const deleteTransaction = db.transaction(() => {
    db.prepare('DELETE FROM graph_relations WHERE source_entity_id = ? OR target_entity_id = ?').run(entityId, entityId);
    const result = db.prepare('DELETE FROM graph_entities WHERE id = ?').run(entityId);
    return result.changes > 0;
  });
  return deleteTransaction();
}

// ========== 关系 CRUD ==========

/**
 * 创建或更新关系
 */
export function upsertRelation(relation: {
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  label?: string;
  properties?: Record<string, any>;
  weight?: number;
  source?: string;
  confidence?: number;
}): GraphRelation {
  const now = new Date().toISOString();

  // 检查是否已存在相同的关系
  const existing = db.prepare(
    'SELECT * FROM graph_relations WHERE user_id = ? AND source_entity_id = ? AND target_entity_id = ? AND relation_type = ?'
  ).get(relation.user_id, relation.source_entity_id, relation.target_entity_id, relation.relation_type) as any;

  if (existing) {
    // 更新关系
    const existingProps = JSON.parse(existing.properties);
    const mergedProps = { ...existingProps, ...(relation.properties || {}) };
    const newWeight = Math.min(1.0, Math.max(existing.weight, relation.weight || 0.8));

    db.prepare(`
      UPDATE graph_relations 
      SET label = ?, properties = ?, weight = ?, confidence = ?, updated_at = ?
      WHERE id = ?
    `).run(
      relation.label || existing.label,
      JSON.stringify(mergedProps),
      newWeight,
      Math.max(existing.confidence, relation.confidence || 0.8),
      now,
      existing.id
    );

    return {
      ...existing,
      label: relation.label || existing.label,
      properties: mergedProps,
      weight: newWeight,
      updated_at: now,
    };
  }

  // 创建新关系
  const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO graph_relations (id, user_id, source_entity_id, target_entity_id, relation_type, label, properties, weight, source, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    relation.user_id,
    relation.source_entity_id,
    relation.target_entity_id,
    relation.relation_type,
    relation.label || '',
    JSON.stringify(relation.properties || {}),
    relation.weight || 1.0,
    relation.source || 'manual',
    relation.confidence || 1.0,
    now,
    now
  );

  return {
    id,
    user_id: relation.user_id,
    source_entity_id: relation.source_entity_id,
    target_entity_id: relation.target_entity_id,
    relation_type: relation.relation_type as RelationType,
    label: relation.label || '',
    properties: relation.properties || {},
    weight: relation.weight || 1.0,
    source: (relation.source || 'manual') as any,
    confidence: relation.confidence || 1.0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * 获取实体的所有关系
 */
export function getEntityRelations(entityId: string): Array<GraphRelation & { source_entity: GraphEntity; target_entity: GraphEntity }> {
  const rows = db.prepare(`
    SELECT r.*, 
      se.name as source_name, se.type as source_type, se.properties as source_props,
      te.name as target_name, te.type as target_type, te.properties as target_props
    FROM graph_relations r
    JOIN graph_entities se ON r.source_entity_id = se.id
    JOIN graph_entities te ON r.target_entity_id = te.id
    WHERE r.source_entity_id = ? OR r.target_entity_id = ?
    ORDER BY r.weight DESC
  `).all(entityId, entityId) as any[];

  return rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    source_entity_id: r.source_entity_id,
    target_entity_id: r.target_entity_id,
    relation_type: r.relation_type,
    label: r.label,
    properties: JSON.parse(r.properties),
    weight: r.weight,
    source: r.source,
    confidence: r.confidence,
    created_at: r.created_at,
    updated_at: r.updated_at,
    source_entity: { id: r.source_entity_id, name: r.source_name, type: r.source_type, properties: JSON.parse(r.source_props) } as any,
    target_entity: { id: r.target_entity_id, name: r.target_name, type: r.target_type, properties: JSON.parse(r.target_props) } as any,
  }));
}

/**
 * 删除关系
 */
export function deleteRelation(relationId: string): boolean {
  const result = db.prepare('DELETE FROM graph_relations WHERE id = ?').run(relationId);
  return result.changes > 0;
}

// ========== 图谱查询 ==========

/**
 * 获取完整图谱可视化数据
 */
export function getGraphVisualization(userId: string): GraphVisualization {
  const entities = db.prepare('SELECT * FROM graph_entities WHERE user_id = ?').all(userId) as any[];
  const relations = db.prepare('SELECT * FROM graph_relations WHERE user_id = ?').all(userId) as any[];

  // 统计实体类型
  const entityTypes: Record<string, number> = {};
  for (const e of entities) {
    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
  }

  // 统计关系类型
  const relationTypes: Record<string, number> = {};
  for (const r of relations) {
    relationTypes[r.relation_type] = (relationTypes[r.relation_type] || 0) + 1;
  }

  // 计算节点大小（基于 mention_count）
  const maxMention = Math.max(...entities.map((e: any) => e.mention_count), 1);

  return {
    nodes: entities.map((e: any) => ({
      id: e.id,
      label: e.name,
      type: e.type,
      properties: JSON.parse(e.properties),
      size: Math.max(10, Math.round((e.mention_count / maxMention) * 50)),
    })),
    edges: relations.map((r: any) => ({
      id: r.id,
      source: r.source_entity_id,
      target: r.target_entity_id,
      label: r.label,
      type: r.relation_type,
      weight: r.weight,
    })),
    stats: {
      total_nodes: entities.length,
      total_edges: relations.length,
      entity_types: entityTypes,
      relation_types: relationTypes,
    },
  };
}

/**
 * 查找两个实体之间的路径（BFS 最短路径）
 */
export function findPath(userId: string, startEntityId: string, endEntityId: string, maxDepth: number = 4): Array<{
  entity: GraphEntity;
  relation?: GraphRelation;
}> | null {
  if (startEntityId === endEntityId) {
    const entity = getEntity(startEntityId);
    return entity ? [{ entity }] : null;
  }

  // BFS
  const relations = db.prepare('SELECT * FROM graph_relations WHERE user_id = ?').all(userId) as any[];
  
  // 构建邻接表
  const adjacency: Map<string, Array<{ neighborId: string; relation: any }>> = new Map();
  for (const r of relations) {
    if (!adjacency.has(r.source_entity_id)) adjacency.set(r.source_entity_id, []);
    if (!adjacency.has(r.target_entity_id)) adjacency.set(r.target_entity_id, []);
    adjacency.get(r.source_entity_id)!.push({ neighborId: r.target_entity_id, relation: r });
    adjacency.get(r.target_entity_id)!.push({ neighborId: r.source_entity_id, relation: r });
  }

  // BFS 搜索
  const visited = new Set<string>();
  const queue: Array<{ entityId: string; path: Array<{ entityId: string; relation?: any }> }> = [
    { entityId: startEntityId, path: [{ entityId: startEntityId }] }
  ];
  visited.add(startEntityId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.path.length > maxDepth) continue;

    const neighbors = adjacency.get(current.entityId) || [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.neighborId)) continue;
      
      const newPath = [...current.path, { entityId: neighbor.neighborId, relation: neighbor.relation }];
      
      if (neighbor.neighborId === endEntityId) {
        // 找到路径，填充实体信息
        return newPath.map(step => {
          const entity = getEntity(step.entityId);
          return {
            entity: entity!,
            relation: step.relation ? {
              ...step.relation,
              properties: JSON.parse(step.relation.properties),
            } : undefined,
          };
        });
      }

      visited.add(neighbor.neighborId);
      queue.push({ entityId: neighbor.neighborId, path: newPath });
    }
  }

  return null; // 未找到路径
}

/**
 * 获取实体的 N 跳邻居
 */
export function getNeighbors(entityId: string, hops: number = 1): {
  entities: GraphEntity[];
  relations: GraphRelation[];
} {
  const visitedEntities = new Set<string>();
  const allRelations: GraphRelation[] = [];
  let currentLevel = [entityId];
  visitedEntities.add(entityId);

  for (let i = 0; i < hops; i++) {
    const nextLevel: string[] = [];
    
    for (const eid of currentLevel) {
      const rels = getEntityRelations(eid);
      for (const rel of rels) {
        allRelations.push(rel);
        
        const neighborId = rel.source_entity_id === eid ? rel.target_entity_id : rel.source_entity_id;
        if (!visitedEntities.has(neighborId)) {
          visitedEntities.add(neighborId);
          nextLevel.push(neighborId);
        }
      }
    }

    currentLevel = nextLevel;
  }

  const entities = Array.from(visitedEntities)
    .map(id => getEntity(id))
    .filter(Boolean) as GraphEntity[];

  // 去重关系
  const uniqueRelations = new Map<string, GraphRelation>();
  for (const r of allRelations) {
    uniqueRelations.set(r.id, r);
  }

  return {
    entities,
    relations: Array.from(uniqueRelations.values()),
  };
}

/**
 * 从对话文本中提取实体和关系（基于规则）
 */
export function extractFromText(userId: string, text: string): {
  entities: GraphEntity[];
  relations: GraphRelation[];
} {
  const extractedEntities: GraphEntity[] = [];
  const extractedRelations: GraphRelation[] = [];

  // 地点提取
  const locationPatterns = [
    /(?:去|到|前往|导航到|在)\s*(.{2,15}?)(?:\s|$|，|。|！|？|吧|呢)/g,
  ];
  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length >= 2 && name.length <= 15) {
        const entity = upsertEntity({
          user_id: userId,
          name,
          type: 'location',
          source: 'conversation',
          confidence: 0.7,
        });
        extractedEntities.push(entity);
      }
    }
  }

  // 人物提取
  const personPatterns = [
    /(妈妈|爸爸|老婆|老公|女儿|儿子|妈|爸|老王|李芳|张小萌|张明)/g,
  ];
  for (const pattern of personPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      // 查找已有实体，增加提及次数
      const existing = db.prepare(
        'SELECT * FROM graph_entities WHERE user_id = ? AND name LIKE ?'
      ).get(userId, `%${name}%`) as any;
      
      if (existing) {
        db.prepare('UPDATE graph_entities SET mention_count = mention_count + 1, updated_at = ? WHERE id = ?')
          .run(new Date().toISOString(), existing.id);
        extractedEntities.push({ ...existing, properties: JSON.parse(existing.properties) });
      }
    }
  }

  return { entities: extractedEntities, relations: extractedRelations };
}

/**
 * 获取图谱统计信息
 */
export function getGraphStats(userId: string): {
  total_entities: number;
  total_relations: number;
  entity_types: Record<string, number>;
  relation_types: Record<string, number>;
  most_connected_entities: Array<{ name: string; connections: number }>;
} {
  const entities = db.prepare('SELECT * FROM graph_entities WHERE user_id = ?').all(userId) as any[];
  const relations = db.prepare('SELECT * FROM graph_relations WHERE user_id = ?').all(userId) as any[];

  const entityTypes: Record<string, number> = {};
  for (const e of entities) {
    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
  }

  const relationTypes: Record<string, number> = {};
  for (const r of relations) {
    relationTypes[r.relation_type] = (relationTypes[r.relation_type] || 0) + 1;
  }

  // 计算连接度
  const connectionCount: Map<string, number> = new Map();
  for (const r of relations) {
    connectionCount.set(r.source_entity_id, (connectionCount.get(r.source_entity_id) || 0) + 1);
    connectionCount.set(r.target_entity_id, (connectionCount.get(r.target_entity_id) || 0) + 1);
  }

  const mostConnected = Array.from(connectionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([entityId, connections]) => {
      const entity = entities.find((e: any) => e.id === entityId);
      return { name: entity?.name || entityId, connections };
    });

  return {
    total_entities: entities.length,
    total_relations: relations.length,
    entity_types: entityTypes,
    relation_types: relationTypes,
    most_connected_entities: mostConnected,
  };
}

console.log('[GraphStore] 图谱构建模块已加载');
