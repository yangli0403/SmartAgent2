/**
 * 模拟 SmartAgent2 API 服务
 * 用于演示功能,无需真实后端
 */

import type { ChatRequest, ChatResponse, MemoryStats, UserProfile, Character } from './api';

// 模拟延迟
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 预设人格数据
const mockCharacters: Character[] = [
  {
    id: 'default',
    name: '小智',
    description: '智能车载 AI 助手,中文对话,擅长导航、音乐、天气等车载场景',
    source_format: 'characterfile',
  },
  {
    id: 'jarvis',
    name: '贾维斯',
    description: '钢铁侠 AI 助手,精通技术分析、数据驱动决策',
    source_format: 'characterfile',
  },
  {
    id: 'alfred',
    name: '阿尔弗雷德',
    description: '蝙蝠侠管家,擅长战术支援、医疗急救、礼仪文化',
    source_format: 'characterfile',
  },
];

// 模拟记忆数据
let mockMemoryStats: MemoryStats = {
  user_id: 'user_001',
  episodic_count: 0,
  semantic_count: 0,
  total_memories: 0,
};

// 模拟用户画像
let mockUserProfile: UserProfile = {
  user_id: 'user_001',
  basic_info: {},
  preferences: {},
  relationships: {},
};

// 对话历史记录
const conversationHistory: Array<{ role: string; content: string }> = [];

// 模拟智能回复生成
const generateMockReply = (message: string, characterId: string): string => {
  const character = mockCharacters.find(c => c.id === characterId);
  const characterName = character?.name || '小智';
  
  // 根据消息内容生成相应回复
  if (message.includes('你好') || message.includes('hi') || message.includes('hello')) {
    return `您好!我是 ${characterName},很高兴为您服务。我已经记住了我们的对话,可以为您提供个性化的帮助。`;
  }
  
  if (message.includes('天气')) {
    mockUserProfile.preferences = { ...mockUserProfile.preferences, weather_interest: true };
    return `根据您的位置,今天天气晴朗,温度 22°C,适合出行。我注意到您关心天气信息,已经更新到您的偏好设置中。`;
  }
  
  if (message.includes('导航') || message.includes('路线')) {
    mockUserProfile.preferences = { ...mockUserProfile.preferences, navigation_usage: true };
    return `好的,正在为您规划路线。根据实时路况,推荐走高速公路,预计 25 分钟到达。我已记录您的导航习惯。`;
  }
  
  if (message.includes('音乐') || message.includes('歌')) {
    mockUserProfile.preferences = { ...mockUserProfile.preferences, music_preference: 'pop' };
    return `为您播放推荐歌曲。根据您之前的收听记录,我为您准备了流行音乐播放列表。`;
  }
  
  if (message.includes('记忆') || message.includes('记住')) {
    return `我的记忆系统包含三层架构:工作记忆用于当前对话,情景记忆记录具体事件,语义记忆存储抽象知识。目前已为您保存了 ${mockMemoryStats.total_memories} 条记忆。`;
  }
  
  if (message.includes('画像') || message.includes('了解')) {
    const prefCount = Object.keys(mockUserProfile.preferences || {}).length;
    return `我正在不断学习了解您。目前已记录您的 ${prefCount} 项偏好设置,包括您的兴趣爱好和使用习惯,以便为您提供更个性化的服务。`;
  }
  
  // 默认回复
  const replies = [
    `明白了,我会记住这次对话内容。有什么我可以帮助您的吗?`,
    `收到!我已经将这条信息记录到记忆系统中,方便日后为您提供更好的服务。`,
    `好的,我理解您的意思。这些信息将帮助我更好地了解您的需求。`,
    `感谢您的反馈!我会持续学习,为您提供更智能的服务。`,
  ];
  
  return replies[Math.floor(Math.random() * replies.length)];
};

// 模拟 API 实现
export const mockChatAPI = {
  sendMessage: async (data: ChatRequest): Promise<{ data: ChatResponse }> => {
    await delay(800 + Math.random() * 400); // 模拟网络延迟
    
    conversationHistory.push({ role: 'user', content: data.message });
    
    const reply = generateMockReply(data.message, data.options?.character_id || 'default');
    conversationHistory.push({ role: 'assistant', content: reply });
    
    // 更新记忆统计
    if (data.options?.include_memory) {
      mockMemoryStats.episodic_count += 1;
      if (Math.random() > 0.7) {
        mockMemoryStats.semantic_count += 1;
      }
      mockMemoryStats.total_memories = mockMemoryStats.episodic_count + mockMemoryStats.semantic_count;
      mockMemoryStats.newest_memory = new Date().toISOString();
      if (!mockMemoryStats.oldest_memory) {
        mockMemoryStats.oldest_memory = new Date().toISOString();
      }
    }
    
    // 更新用户画像
    if (data.options?.include_profile) {
      mockUserProfile.updated_at = new Date().toISOString();
      
      // 模拟基本信息提取
      if (data.message.includes('我叫') || data.message.includes('我是')) {
        mockUserProfile.basic_info = { ...mockUserProfile.basic_info, name_mentioned: true };
      }
    }
    
    return {
      data: {
        reply,
        session_id: data.session_id,
        user_id: data.user_id,
        character_id: data.options?.character_id,
        memories_retrieved: data.options?.include_memory ? Math.floor(Math.random() * 5) : 0,
        profile_updated: data.options?.include_profile,
      },
    };
  },
};

export const mockMemoryAPI = {
  getStats: async (userId: string): Promise<{ data: MemoryStats }> => {
    await delay(200);
    return { data: { ...mockMemoryStats, user_id: userId } };
  },
  
  listEpisodic: async (userId: string, page = 1, pageSize = 20) => {
    await delay(300);
    return { data: { items: [], total: mockMemoryStats.episodic_count, page, page_size: pageSize } };
  },
  
  listSemantic: async (userId: string, page = 1, pageSize = 20) => {
    await delay(300);
    return { data: { items: [], total: mockMemoryStats.semantic_count, page, page_size: pageSize } };
  },
};

export const mockProfileAPI = {
  getProfile: async (userId: string): Promise<{ data: UserProfile }> => {
    await delay(200);
    return { data: { ...mockUserProfile, user_id: userId } };
  },
  
  updateProfile: async (userId: string, data: Partial<UserProfile>): Promise<{ data: UserProfile }> => {
    await delay(300);
    mockUserProfile = { ...mockUserProfile, ...data, user_id: userId, updated_at: new Date().toISOString() };
    return { data: mockUserProfile };
  },
};

export const mockCharacterAPI = {
  listCharacters: async (): Promise<{ data: Character[] }> => {
    await delay(200);
    return { data: mockCharacters };
  },
  
  getCharacter: async (characterId: string): Promise<{ data: Character }> => {
    await delay(200);
    const character = mockCharacters.find(c => c.id === characterId);
    if (!character) {
      throw new Error('Character not found');
    }
    return { data: character };
  },
};
