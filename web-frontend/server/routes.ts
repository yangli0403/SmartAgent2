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
      }
    }

    // 调用 LLM 生成回复
    const reply = await chatWithLLM({
      message,
      profile,
      memories,
      characterId: options?.character_id || 'default',
    });

    // 追加到滑动窗口
    const sessionKey = `${user_id}:${session_id}`;
    appendToWindow(sessionKey, message, reply);

    // 异步提取记忆（不阻塞响应）
    const userName = profile?.basic_info?.name || user_id;
    extractMemoriesAsync(
      user_id,
      session_id,
      userName,
      addEpisodicMemory,
      upsertPreference,
    ).then(result => {
      if (result.has_meaningful_content) {
        console.log(`[Chat] 异步提取完成: ${result.memories.length} 条记忆, ${result.preferences.length} 条偏好`);
      }
    }).catch(err => {
      console.error('[Chat] 异步提取失败:', err.message);
    });

    res.json({
      reply,
      session_id,
      user_id,
      character_id: options?.character_id,
      memories_retrieved: memories.length,
      profile_updated: false,
      matched_memories: memories.map((m: any) => ({
        id: m.id,
        date: m.date,
        summary: m.summary,
        score: m.score,
        match_reasons: m.match_reasons,
      })),
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== 会话管理接口 ==========

router.delete('/api/v1/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id query parameter' });
    }
    clearWindow(`${user_id}:${sessionId}`);
    res.json({ success: true, message: '会话已清除' });
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

    await addEpisodicMemory(user_id, {
      event_type: event_type || '',
      summary,
      details: details || '',
      location: location || '',
      participants: participants || [],
      importance: importance || 3,
    });

    res.json({ success: true, message: '记忆已添加' });
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

export default router;
