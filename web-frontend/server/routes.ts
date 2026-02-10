/**
 * SmartAgent2 后端 API 路由
 * 实现对话、记忆、画像等核心功能
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

const router = Router();

// ========== 对话接口 ==========
router.post('/api/v1/chat', async (req: Request, res: Response) => {
  try {
    const { user_id, session_id, message, options } = req.body;
    
    if (!user_id || !session_id || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 获取用户画像和记忆
    const profile = options?.include_profile ? await getUserProfile(user_id) : null;
    const memories = options?.include_memory ? await getEpisodicMemories(user_id, 5) : [];

    // 调用 LLM 生成回复
    const reply = await chatWithLLM({
      message,
      profile,
      memories,
      characterId: options?.character_id || 'default',
    });

    // 记录对话到情景记忆
    if (options?.include_memory) {
      await addEpisodicMemory(user_id, {
        event_type: '对话',
        summary: `用户说：${message.slice(0, 30)}...`,
        details: `用户：${message}\nAI：${reply.slice(0, 50)}...`,
        participants: [user_id],
      });
    }

    res.json({
      reply,
      session_id,
      user_id,
      character_id: options?.character_id,
      memories_retrieved: memories.length,
      profile_updated: false,
      matched_memories: memories,
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== 用户画像接口 ==========
router.get('/api/v1/profile/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profile = await getUserProfile(userId);
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

// ========== 情景记忆接口 ==========
router.get('/api/v1/memory/episodic', async (req: Request, res: Response) => {
  try {
    const { user_id, page = 1, page_size = 20 } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const memories = await getEpisodicMemories(user_id as string, Number(page_size));
    res.json({ items: memories, total: memories.length, page, page_size });
  } catch (error: any) {
    console.error('Get episodic memories error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== AI 人格接口（使用 ElizaOS Characterfile 风格的丰富数据） ==========
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
