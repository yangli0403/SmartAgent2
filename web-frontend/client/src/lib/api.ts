import axios from 'axios';

// SmartAgent2 后端 API 基础 URL
// 开发环境需要配置代理或直接连接到本地运行的 SmartAgent2 服务
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 对话接口
export interface ChatRequest {
  user_id: string;
  session_id: string;
  message: string;
  options?: {
    include_memory?: boolean;
    include_profile?: boolean;
    character_id?: string;
  };
}

export interface ChatResponse {
  reply: string;
  session_id: string;
  user_id: string;
  character_id?: string;
  memories_retrieved?: number;
  profile_updated?: boolean;
}

// 记忆统计接口
export interface MemoryStats {
  user_id: string;
  episodic_count: number;
  semantic_count: number;
  total_memories: number;
  oldest_memory?: string;
  newest_memory?: string;
}

// 用户画像接口
export interface UserProfile {
  user_id: string;
  basic_info?: Record<string, any>;
  preferences?: Record<string, any>;
  relationships?: Record<string, any>;
  updated_at?: string;
}

// 人格配置接口
export interface Character {
  id: string;
  name: string;
  description?: string;
  source_format?: string;
}

// API 方法
export const chatAPI = {
  sendMessage: (data: ChatRequest) => 
    api.post<ChatResponse>('/api/v1/chat', data),
};

export const memoryAPI = {
  getStats: (userId: string) => 
    api.get<MemoryStats>(`/api/v1/memory/stats/${userId}`),
  
  listEpisodic: (userId: string, page = 1, pageSize = 20) => 
    api.get(`/api/v1/memory/episodic`, { params: { user_id: userId, page, page_size: pageSize } }),
  
  listSemantic: (userId: string, page = 1, pageSize = 20) => 
    api.get(`/api/v1/memory/semantic`, { params: { user_id: userId, page, page_size: pageSize } }),
};

export const profileAPI = {
  getProfile: (userId: string) => 
    api.get<UserProfile>(`/api/v1/profile/${userId}`),
  
  updateProfile: (userId: string, data: Partial<UserProfile>) => 
    api.put<UserProfile>(`/api/v1/profile/${userId}`, data),
};

export const characterAPI = {
  listCharacters: () => 
    api.get<Character[]>('/api/v1/character/'),
  
  getCharacter: (characterId: string) => 
    api.get<Character>(`/api/v1/character/${characterId}`),
};
