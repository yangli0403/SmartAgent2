import axios from 'axios';

// SmartAgent2 后端 API 基础 URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ========== 用户角色 ==========
export interface UserRole {
  id: string;
  name: string;
  avatar: string;
  description: string;
  age: number;
  role_in_family: string;
}

// ========== 对话接口 ==========
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
  matched_memories?: EpisodicMemoryItem[];
}

// ========== 记忆统计 ==========
export interface MemoryStats {
  user_id: string;
  episodic_count: number;
  semantic_count: number;
  total_memories: number;
  oldest_memory?: string;
  newest_memory?: string;
}

// ========== 情景记忆 ==========
export interface EpisodicMemoryItem {
  id: string;
  date: string;
  event_type: string;
  summary: string;
  participants: string[];
  location?: string;
  details: string;
  importance: number;
}

// ========== 用户偏好 ==========
export interface PreferenceItem {
  id: string;
  category: string;
  key: string;
  value: string;
  context?: string;
}

// ========== 关系信息 ==========
export interface RelationshipItem {
  person_name: string;
  relationship: string;
  details: Record<string, string>;
  tags: string[];
}

// ========== 用户画像 ==========
export interface UserProfile {
  user_id: string;
  basic_info: Record<string, string>;
  preferences: PreferenceItem[];
  relationships: RelationshipItem[];
  updated_at?: string;
}

// ========== 人格配置 ==========
export interface Character {
  id: string;
  name: string;
  description?: string;
  source_format?: string;
}

// ========== API 方法 ==========
export const chatAPI = {
  sendMessage: async (data: ChatRequest) => {
    const response = await api.post<ChatResponse>('/api/v1/chat', data);
    return { data: response.data };
  },
};

export const memoryAPI = {
  getStats: async (userId: string) => {
    const response = await api.get<MemoryStats>(`/api/v1/memory/stats/${userId}`);
    return { data: response.data };
  },
  listEpisodic: async (userId: string, page = 1, pageSize = 20) => {
    const response = await api.get(`/api/v1/memory/episodic`, { params: { user_id: userId, page, page_size: pageSize } });
    return { data: response.data };
  },
  listSemantic: async (userId: string, page = 1, pageSize = 20) => {
    const response = await api.get(`/api/v1/memory/semantic`, { params: { user_id: userId, page, page_size: pageSize } });
    return { data: response.data };
  },
};

export const profileAPI = {
  getProfile: async (userId: string) => {
    const response = await api.get<UserProfile>(`/api/v1/profile/${userId}`);
    return { data: response.data };
  },
  updateProfile: async (userId: string, data: Partial<UserProfile>) => {
    const response = await api.put<UserProfile>(`/api/v1/profile/${userId}`, data);
    return { data: response.data };
  },
};

export const characterAPI = {
  listCharacters: async () => {
    const response = await api.get<Character[]>('/api/v1/character/');
    return { data: response.data };
  },
  getCharacter: async (characterId: string) => {
    const response = await api.get<Character>(`/api/v1/character/${characterId}`);
    return { data: response.data };
  },
};

export const userRoleAPI = {
  listRoles: async () => {
    const response = await api.get('/api/v1/user/roles');
    return { data: response.data };
  },
};
