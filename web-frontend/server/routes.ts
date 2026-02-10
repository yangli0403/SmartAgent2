/**
 * SmartAgent2 后端 API 路由
 * 整合对话、记忆检索/提取、画像管理等核心功能
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { chatWithLLM } from './llm';
import { 
  getUserProfile, 
  updateUserProfile, 
  getMemoryStats, 
  getEpisodicMemories,
  addEpisodicMemory,
} from './storage';
import { getCharacterList, getCharacterConfig } from './characters';
import { appendToWindow, extractMemoriesAsync, clearWindow } from './extractor';
import { retrieveMemories } from './retriever';
import { 
  upsertPreference, 
  deletePreference, 
  getPreferencesByCategory,
  getPreferencesByContext,
  upsertRelationship, 
  deleteRelationship,
  getRelationships,
  updateBasicInfo,
} from './profile-manager';
import {
  createMemoryMetadata,
  batchRecordAccess,
  scanAndForget,
  scanAllUsers,
  getForgetterStats,
  getForgetterLog,
  getRetentionRanking,
  startForgetterScheduler,
} from './forgetter';
import {
  evaluateProactiveRules,
  triggerSceneService,
  getProactiveRules,
  updateRuleStatus,
  resetRuleCooldown,
  getCurrentContext,
} from './proactive-service';
import {
  addMessage as wmAddMessage,
  getContextSnapshot,
  buildLLMMessages,
  detectTopicSwitch,
  getSessionInfo,
  getUserSessions,
  destroySession,
  extendSessionTTL,
  getWorkingMemoryStats,
} from './working-memory';
import {
  upsertEntity,
  getEntity,
  getEntitiesByType,
  searchEntities,
  deleteEntity,
  upsertRelation,
  getEntityRelations,
  deleteRelation as deleteGraphRelation,
  getGraphVisualization,
  findPath,
  getNeighbors,
  extractFromText,
  getGraphStats,
} from './graph-store';

const router = Router();

// ========== 对话接口（集成记忆检索 + 异步提取） ==========

router.post('/api/v1/chat', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id, message, options } = req.body;
    
    if (!user_id || !session_id || !message) {
      return res.status(400).json({ error: 'Missing required fields: user_id, session_id, message' });
    }

    // 获取用户画像
    const profile = options?.include_profile !== false ? await getUserProfile(user_id) : null;
    
    // 使用新的混合检索模块替代简单的 slice
    let memories: any[] = [];
    if (options?.include_memory !== false) {
      const allMemories = await getEpisodicMemories(user_id, 50); // 取最近 50 条作为候选
      if (allMemories.length > 0) {
        // 使用混合检索（关键词 + 符号 + RRF 融合）
        // 当候选记忆 > 10 条时启用 LLM 语义重排
        const enableRerank = allMemories.length > 10;
        memories = await retrieveMemories(message, allMemories, 5, enableRerank);
        // 记录被检索到的记忆的访问（强化记忆，延缓遗忘）
        if (memories.length > 0) {
          batchRecordAccess(memories.map((m: any) => m.id));
        }
      }
    }

    // 工作记忆：记录用户消息
    wmAddMessage(user_id, session_id, 'user', message);

    // 工作记忆：检测话题切换
    const topicSwitch = detectTopicSwitch(user_id, session_id, message);
    if (topicSwitch.switched) {
      console.log(`[Chat] 话题切换: ${topicSwitch.previous_topic} → ${topicSwitch.new_topic}`);
    }

    // 图谱：从对话中提取实体
    extractFromText(user_id, message);

    // 调用 LLM 生成回复（集成工作记忆的多轮上下文）
    const reply = await chatWithLLM({
      message,
      profile,
      memories,
      characterId: options?.character_id || 'default',
      userId: user_id,
      sessionId: session_id,
    });

    // 工作记忆：记录 AI 回复
    wmAddMessage(user_id, session_id, 'assistant', reply);

    // 追加到提取器滑动窗口
    const sessionKey = `${user_id}:${session_id}`;
    appendToWindow(sessionKey, message, reply);

    // 同步提取记忆和偏好（等待提取完成后再返回响应，确保前端能获取最新数据）
    const userName = profile?.basic_info?.name || user_id;
    let extractionResult = { memories: [] as any[], preferences: [] as any[], has_meaningful_content: false };
    let profile_updated = false;
    let memories_extracted = 0;
    let preferences_extracted = 0;

    try {
      extractionResult = await extractMemoriesAsync(
        user_id,
        session_id,
        userName,
        addEpisodicMemory,
        upsertPreference,
      );
      if (extractionResult.has_meaningful_content) {
        memories_extracted = extractionResult.memories.length;
        preferences_extracted = extractionResult.preferences.filter((p: any) => p.confidence >= 0.6).length;
        profile_updated = preferences_extracted > 0;
        console.log(`[Chat] 同步提取完成: ${memories_extracted} 条记忆, ${preferences_extracted} 条偏好`);
      }
    } catch (err: any) {
      console.error('[Chat] 同步提取失败:', err.message);
    }

    // 获取工作记忆上下文快照
    const contextSnapshot = getContextSnapshot(user_id, session_id);

    res.json({
      reply,
      session_id,
      user_id,
      character_id: options?.character_id,
      memories_retrieved: memories.length,
      profile_updated,
      extraction: {
        has_meaningful_content: extractionResult.has_meaningful_content,
        memories_extracted,
        preferences_extracted,
        extracted_preferences: extractionResult.preferences
          .filter((p: any) => p.confidence >= 0.6)
          .map((p: any) => ({ category: p.category, key: p.key, value: p.value })),
        extracted_memories: extractionResult.memories.map((m: any) => ({ event_type: m.event_type, summary: m.summary })),
      },
      matched_memories: memories.map((m: any) => ({
        id: m.id,
        date: m.date,
        summary: m.summary,
        score: m.score,
        match_reasons: m.match_reasons,
      })),
      working_memory: {
        current_topic: contextSnapshot.current_topic,
        active_intents: contextSnapshot.active_intents,
        total_turns: contextSnapshot.total_turns,
        topic_switched: topicSwitch.switched,
      },
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== 会话管理接口（集成工作记忆） ==========

router.delete('/api/v1/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id query parameter' });
    }
    clearWindow(`${user_id}:${sessionId}`);
    destroySession(user_id as string, sessionId);
    res.json({ success: true, message: '会话已清除' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取会话详情（工作记忆状态）
router.get('/api/v1/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id query parameter' });
    }
    const info = getSessionInfo(user_id as string, sessionId);
    if (!info) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户所有活跃会话
router.get('/api/v1/sessions', (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id query parameter' });
    }
    const sessions = getUserSessions(user_id as string);
    res.json({ items: sessions, total: sessions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 延长会话 TTL
router.post('/api/v1/session/:sessionId/extend', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id, additional_minutes = 30 } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const success = extendSessionTTL(user_id, sessionId, additional_minutes * 60 * 1000);
    res.json({ success, message: success ? `会话已延长 ${additional_minutes} 分钟` : '会话不存在' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 工作记忆全局统计
router.get('/api/v1/working-memory/stats', (_req: Request, res: Response) => {
  try {
    const stats = getWorkingMemoryStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 用户画像接口 ==========

router.get('/api/v1/profile/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profile = await getUserProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(profile);
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/v1/profile/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profileData = req.body;
    const updatedProfile = await updateUserProfile(userId, profileData);
    res.json(updatedProfile);
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新基本信息（部分更新）
router.patch('/api/v1/profile/:userId/basic', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    const newInfo = await updateBasicInfo(userId, updates);
    res.json({ success: true, basic_info: newInfo });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 偏好管理接口 (CRUD) ==========

// 获取某用户的所有偏好（支持按类别和场景过滤）
router.get('/api/v1/profile/:userId/preferences', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { category, context } = req.query;

    let prefs: any[];
    if (category) {
      prefs = await getPreferencesByCategory(userId, category as string);
    } else if (context) {
      prefs = await getPreferencesByContext(userId, context as string);
    } else {
      const profile = await getUserProfile(userId);
      prefs = profile?.preferences || [];
    }

    res.json({ items: prefs, total: prefs.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 新增或更新偏好
router.post('/api/v1/profile/:userId/preferences', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { category, key, value, context } = req.body;

    if (!category || !key || !value) {
      return res.status(400).json({ error: 'Missing required fields: category, key, value' });
    }

    await upsertPreference(userId, { category, key, value, context });
    res.json({ success: true, message: '偏好已更新' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除偏好
router.delete('/api/v1/profile/:userId/preferences/:prefId', async (req: Request, res: Response) => {
  try {
    const { userId, prefId } = req.params;
    const deleted = await deletePreference(userId, prefId);
    if (!deleted) {
      return res.status(404).json({ error: 'Preference not found' });
    }
    res.json({ success: true, message: '偏好已删除' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 关系管理接口 (CRUD) ==========

// 获取用户所有关系
router.get('/api/v1/profile/:userId/relationships', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const relationships = await getRelationships(userId);
    res.json({ items: relationships, total: relationships.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 新增或更新关系
router.post('/api/v1/profile/:userId/relationships', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { person_name, relationship, details, tags } = req.body;

    if (!person_name || !relationship) {
      return res.status(400).json({ error: 'Missing required fields: person_name, relationship' });
    }

    await upsertRelationship(userId, { person_name, relationship, details, tags });
    res.json({ success: true, message: '关系已更新' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除关系
router.delete('/api/v1/profile/:userId/relationships/:relId', async (req: Request, res: Response) => {
  try {
    const { userId, relId } = req.params;
    const deleted = await deleteRelationship(userId, parseInt(relId));
    if (!deleted) {
      return res.status(404).json({ error: 'Relationship not found' });
    }
    res.json({ success: true, message: '关系已删除' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 记忆统计接口 ==========

router.get('/api/v1/memory/stats/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const stats = await getMemoryStats(userId);
    res.json(stats);
  } catch (error: any) {
    console.error('Get memory stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== 情景记忆接口 (CRUD) ==========

// 获取记忆列表（支持分页和过滤）
router.get('/api/v1/memory/episodic', async (req: Request, res: Response) => {
  try {
    const { user_id, page = '1', page_size = '20', event_type } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    let memories = await getEpisodicMemories(user_id as string, Number(page_size) * Number(page));

    // 按事件类型过滤
    if (event_type) {
      memories = memories.filter(m => m.event_type === event_type);
    }

    // 分页
    const start = (Number(page) - 1) * Number(page_size);
    const paged = memories.slice(start, start + Number(page_size));

    res.json({ items: paged, total: memories.length, page: Number(page), page_size: Number(page_size) });
  } catch (error: any) {
    console.error('Get episodic memories error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 新增记忆
router.post('/api/v1/memory/episodic', async (req: Request, res: Response) => {
  try {
    const { user_id, event_type, summary, details, location, participants, importance } = req.body;
    if (!user_id || !summary) {
      return res.status(400).json({ error: 'Missing required fields: user_id, summary' });
    }

    const memoryId = `e_${Date.now()}`;
    await addEpisodicMemory(user_id, {
      id: memoryId,
      event_type: event_type || '',
      summary,
      details: details || '',
      location: location || '',
      participants: participants || [],
      importance: importance || 3,
    });
    // 为新记忆创建遗忘元数据
    createMemoryMetadata(memoryId, user_id, importance || 3);

    res.json({ success: true, message: '记忆已添加', memory_id: memoryId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除记忆
router.delete('/api/v1/memory/episodic/:memoryId', async (req: Request, res: Response) => {
  try {
    const { memoryId } = req.params;
    const { deleteEpisodicMemory } = await import('./storage');
    const deleted = await deleteEpisodicMemory(memoryId);
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ success: true, message: '记忆已删除' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== AI 人格接口 ==========

router.get('/api/v1/character/', (_req: Request, res: Response) => {
  res.json(getCharacterList());
});

router.get('/api/v1/character/:characterId', (req: Request, res: Response) => {
  const character = getCharacterConfig(req.params.characterId);
  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }
  res.json(character);
});

// ========== 用户角色接口 ==========

const userRoles = [
  { id: 'zhangming', name: '张明', avatar: '👨', description: '车主，35 岁，软件工程师', age: 35, role_in_family: '车主（丈夫/父亲）' },
  { id: 'lifang', name: '李芳', avatar: '👩', description: '车主老婆，33 岁，设计师', age: 33, role_in_family: '车主老婆（妻子/母亲）' },
  { id: 'xiaomeng', name: '张小萌', avatar: '👧', description: '车主女儿，8 岁，小学生', age: 8, role_in_family: '车主女儿' },
];

router.get('/api/v1/user/roles', (_req: Request, res: Response) => {
  res.json(userRoles);
});

// ========== 记忆遗忘管理接口 ==========

// 获取遗忘状态概览
router.get('/api/v1/forgetter/stats/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const stats = getForgetterStats(userId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取记忆保留分数排名
router.get('/api/v1/forgetter/ranking/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const ranking = getRetentionRanking(userId);
    res.json({ items: ranking, total: ranking.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取遗忘日志
router.get('/api/v1/forgetter/log/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { limit = '20' } = req.query;
    const log = getForgetterLog(userId, Number(limit));
    res.json({ items: log, total: log.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 手动触发遗忘扫描
router.post('/api/v1/forgetter/scan', async (req: Request, res: Response) => {
  try {
    const { user_id, threshold = 0.15, dry_run = false } = req.body;
    
    if (user_id) {
      const result = await scanAndForget(user_id, threshold, dry_run);
      res.json(result);
    } else {
      const results = await scanAllUsers(threshold, dry_run);
      res.json({ users: results, total_users: results.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 启动定时遗忘扫描（默认每 60 分钟）
startForgetterScheduler(60);

// ========== 主动服务接口 ==========

// 评估当前场景的主动服务
router.post('/api/v1/proactive/evaluate', async (req: Request, res: Response) => {
  try {
    const { user_id, character_id = 'default', context } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const results = await evaluateProactiveRules(user_id, character_id, context);
    res.json({ items: results, total: results.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 触发指定场景的主动服务
router.post('/api/v1/proactive/trigger', async (req: Request, res: Response) => {
  try {
    const { user_id, character_id = 'default', scene_type, scene_data } = req.body;
    if (!user_id || !scene_type) {
      return res.status(400).json({ error: 'Missing required fields: user_id, scene_type' });
    }
    const results = await triggerSceneService(user_id, character_id, scene_type, scene_data);
    res.json({ items: results, total: results.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有主动服务规则
router.get('/api/v1/proactive/rules', (_req: Request, res: Response) => {
  try {
    const rules = getProactiveRules();
    res.json({ items: rules, total: rules.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 更新规则启用状态
router.patch('/api/v1/proactive/rules/:ruleId', (req: Request, res: Response) => {
  try {
    const { ruleId } = req.params;
    const { enabled } = req.body;
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Missing enabled field' });
    }
    const success = updateRuleStatus(ruleId, enabled);
    res.json({ success, message: success ? '规则已更新' : '规则不存在' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 重置规则冷却时间
router.post('/api/v1/proactive/rules/:ruleId/reset-cooldown', (req: Request, res: Response) => {
  try {
    const { ruleId } = req.params;
    const success = resetRuleCooldown(ruleId);
    res.json({ success, message: success ? '冷却已重置' : '规则不存在或未触发过' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取当前场景上下文
router.get('/api/v1/proactive/context', (_req: Request, res: Response) => {
  try {
    const context = getCurrentContext();
    res.json(context);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========== 图谱接口 ==========

// 获取图谱可视化数据
router.get('/api/v1/graph/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const graph = getGraphVisualization(userId);
    res.json(graph);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取图谱统计
router.get('/api/v1/graph/:userId/stats', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const stats = getGraphStats(userId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 搜索实体
router.get('/api/v1/graph/:userId/entities', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { type, keyword } = req.query;
    let entities;
    if (keyword) {
      entities = searchEntities(userId, keyword as string);
    } else {
      entities = getEntitiesByType(userId, type as any);
    }
    res.json({ items: entities, total: entities.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 创建/更新实体
router.post('/api/v1/graph/:userId/entities', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { name, type, properties, source, confidence } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: 'Missing required fields: name, type' });
    }
    const entity = upsertEntity({ user_id: userId, name, type, properties, source, confidence });
    res.json(entity);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取实体详情
router.get('/api/v1/graph/entity/:entityId', (req: Request, res: Response) => {
  try {
    const entity = getEntity(req.params.entityId);
    if (!entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json(entity);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除实体
router.delete('/api/v1/graph/entity/:entityId', (req: Request, res: Response) => {
  try {
    const success = deleteEntity(req.params.entityId);
    res.json({ success, message: success ? '实体已删除' : '实体不存在' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取实体的关系
router.get('/api/v1/graph/entity/:entityId/relations', (req: Request, res: Response) => {
  try {
    const relations = getEntityRelations(req.params.entityId);
    res.json({ items: relations, total: relations.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 创建/更新关系
router.post('/api/v1/graph/:userId/relations', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { source_entity_id, target_entity_id, relation_type, label, properties, weight, source, confidence } = req.body;
    if (!source_entity_id || !target_entity_id || !relation_type) {
      return res.status(400).json({ error: 'Missing required fields: source_entity_id, target_entity_id, relation_type' });
    }
    const relation = upsertRelation({
      user_id: userId, source_entity_id, target_entity_id, relation_type, label, properties, weight, source, confidence,
    });
    res.json(relation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除关系
router.delete('/api/v1/graph/relation/:relationId', (req: Request, res: Response) => {
  try {
    const success = deleteGraphRelation(req.params.relationId);
    res.json({ success, message: success ? '关系已删除' : '关系不存在' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 查找两个实体之间的路径
router.get('/api/v1/graph/:userId/path', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { from, to, max_depth = '4' } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Missing required query params: from, to' });
    }
    const path = findPath(userId, from as string, to as string, Number(max_depth));
    if (!path) {
      return res.json({ found: false, path: [] });
    }
    res.json({ found: true, path, length: path.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取实体的 N 跳邻居
router.get('/api/v1/graph/entity/:entityId/neighbors', (req: Request, res: Response) => {
  try {
    const { hops = '1' } = req.query;
    const result = getNeighbors(req.params.entityId, Number(hops));
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
