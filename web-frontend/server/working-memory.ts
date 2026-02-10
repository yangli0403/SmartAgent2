/**
 * 工作记忆 (Working Memory) 模块
 * 
 * 核心功能：
 * 1. 会话级短期记忆：维护当前对话的上下文窗口，支持多轮对话理解
 * 2. TTL 自动过期：工作记忆默认 30 分钟过期，模拟人类短期记忆衰退
 * 3. 意图追踪：记录对话中的意图变化，支持话题切换检测
 * 4. 上下文摘要：当对话轮次过多时，自动压缩历史上下文为摘要
 * 5. 多会话管理：支持同一用户的多个并发会话
 * 
 * 设计参考：
 * - 架构设计文档中的 WorkingMemory：会话级短期缓存，TTL 30分钟
 * - 滑动窗口机制 + 上下文压缩
 */

// ========== 类型定义 ==========

/** 对话消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** 意图标签（由 LLM 或规则识别） */
  intent?: string;
  /** 提及的实体 */
  entities?: string[];
}

/** 意图记录 */
export interface IntentRecord {
  intent: string;
  first_seen: number;
  last_seen: number;
  count: number;
}

/** 工作记忆会话 */
export interface WorkingMemorySession {
  session_id: string;
  user_id: string;
  /** 完整的对话历史 */
  messages: ChatMessage[];
  /** 压缩后的历史摘要（当对话轮次超过阈值时生成） */
  compressed_summary: string | null;
  /** 被压缩的消息数量 */
  compressed_count: number;
  /** 当前活跃的意图 */
  active_intents: IntentRecord[];
  /** 对话中提及的关键实体 */
  mentioned_entities: Map<string, number>; // entity -> mention count
  /** 当前话题 */
  current_topic: string | null;
  /** 创建时间 */
  created_at: number;
  /** 最后活跃时间 */
  last_active_at: number;
  /** TTL（毫秒） */
  ttl_ms: number;
  /** 元数据 */
  metadata: Record<string, any>;
}

/** 工作记忆配置 */
export interface WorkingMemoryConfig {
  /** 默认 TTL（毫秒），默认 30 分钟 */
  default_ttl_ms: number;
  /** 滑动窗口大小（保留最近 N 轮对话） */
  window_size: number;
  /** 触发压缩的消息数阈值 */
  compression_threshold: number;
  /** 最大并发会话数 */
  max_sessions_per_user: number;
  /** 清理检查间隔（毫秒） */
  cleanup_interval_ms: number;
}

/** 上下文快照（用于 LLM 调用） */
export interface ContextSnapshot {
  /** 压缩的历史摘要 */
  summary: string | null;
  /** 最近的对话消息 */
  recent_messages: ChatMessage[];
  /** 当前话题 */
  current_topic: string | null;
  /** 活跃意图 */
  active_intents: string[];
  /** 高频提及实体 */
  top_entities: string[];
  /** 会话持续时间（秒） */
  session_duration_seconds: number;
  /** 总对话轮次 */
  total_turns: number;
}

// ========== 默认配置 ==========

const DEFAULT_CONFIG: WorkingMemoryConfig = {
  default_ttl_ms: 30 * 60 * 1000,       // 30 分钟
  window_size: 10,                        // 保留最近 10 轮
  compression_threshold: 15,              // 超过 15 条消息时压缩
  max_sessions_per_user: 3,               // 每用户最多 3 个并发会话
  cleanup_interval_ms: 5 * 60 * 1000,     // 5 分钟清理一次
};

// ========== 意图识别规则 ==========

const INTENT_RULES: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /导航|去|前往|到|路线|怎么走/, intent: '导航' },
  { pattern: /音乐|歌|播放|听/, intent: '音乐' },
  { pattern: /空调|温度|冷|热|风量/, intent: '环境控制' },
  { pattern: /座椅|加热|通风|位置/, intent: '座椅调节' },
  { pattern: /天气|下雨|温度|气温/, intent: '天气查询' },
  { pattern: /电话|打给|联系|发消息/, intent: '通讯' },
  { pattern: /吃|餐厅|美食|饭/, intent: '餐饮' },
  { pattern: /买|购物|超市|商场/, intent: '购物' },
  { pattern: /孩子|女儿|儿子|学校|接/, intent: '家庭事务' },
  { pattern: /妈|爸|父|母|老人|看望/, intent: '探亲' },
  { pattern: /油|充电|加油|续航/, intent: '能源管理' },
  { pattern: /保养|维修|检查|故障/, intent: '车辆维护' },
  { pattern: /你好|早上好|晚上好|嗨/, intent: '问候' },
  { pattern: /谢谢|感谢|辛苦/, intent: '致谢' },
  { pattern: /了解|记住|知道|记忆/, intent: '记忆查询' },
];

/**
 * 基于规则的意图识别
 */
function detectIntent(message: string): string[] {
  const intents: string[] = [];
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(message)) {
      intents.push(rule.intent);
    }
  }
  return intents.length > 0 ? intents : ['通用对话'];
}

/**
 * 基于规则的实体提取
 */
function extractEntities(message: string): string[] {
  const entities: string[] = [];
  
  // 地点实体
  const locationPatterns = [
    /(?:去|到|前往|导航到)\s*(.{2,10}?)(?:\s|$|，|。|！|？)/g,
  ];
  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      entities.push(`地点:${match[1]}`);
    }
  }

  // 人名实体（基于常见称呼）
  const personPatterns = [
    /(妈妈|爸爸|老婆|老公|女儿|儿子|妈|爸)/g,
    /(?:给|找|联系|打给)\s*(.{2,4}?)(?:\s|$|，|。)/g,
  ];
  for (const pattern of personPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      entities.push(`人物:${match[1]}`);
    }
  }

  return entities;
}

// ========== 工作记忆存储 ==========

/** 内存中的工作记忆会话池 */
const sessionPool: Map<string, WorkingMemorySession> = new Map();

/** 清理定时器 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ========== 核心 API ==========

/**
 * 获取或创建工作记忆会话
 */
export function getOrCreateSession(
  userId: string, 
  sessionId: string, 
  config?: Partial<WorkingMemoryConfig>
): WorkingMemorySession {
  const key = `${userId}:${sessionId}`;
  const existing = sessionPool.get(key);

  if (existing) {
    // 检查是否过期
    if (Date.now() - existing.last_active_at > existing.ttl_ms) {
      console.log(`[WorkingMemory] 会话 ${key} 已过期，创建新会话`);
      sessionPool.delete(key);
    } else {
      return existing;
    }
  }

  // 检查用户会话数是否超限
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const userSessions = Array.from(sessionPool.entries())
    .filter(([k]) => k.startsWith(`${userId}:`));
  
  if (userSessions.length >= mergedConfig.max_sessions_per_user) {
    // 删除最旧的会话
    const oldest = userSessions.sort((a, b) => a[1].last_active_at - b[1].last_active_at)[0];
    sessionPool.delete(oldest[0]);
    console.log(`[WorkingMemory] 用户 ${userId} 会话数超限，删除最旧会话 ${oldest[0]}`);
  }

  // 创建新会话
  const session: WorkingMemorySession = {
    session_id: sessionId,
    user_id: userId,
    messages: [],
    compressed_summary: null,
    compressed_count: 0,
    active_intents: [],
    mentioned_entities: new Map(),
    current_topic: null,
    created_at: Date.now(),
    last_active_at: Date.now(),
    ttl_ms: mergedConfig.default_ttl_ms,
    metadata: {},
  };

  sessionPool.set(key, session);
  console.log(`[WorkingMemory] 创建新会话 ${key}`);
  return session;
}

/**
 * 添加消息到工作记忆
 */
export function addMessage(
  userId: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): WorkingMemorySession {
  const session = getOrCreateSession(userId, sessionId);
  
  // 意图识别和实体提取（仅对用户消息）
  let intent: string | undefined;
  let entities: string[] | undefined;
  
  if (role === 'user') {
    const detectedIntents = detectIntent(content);
    intent = detectedIntents[0];
    entities = extractEntities(content);

    // 更新活跃意图
    updateActiveIntents(session, detectedIntents);
    
    // 更新提及实体
    if (entities.length > 0) {
      for (const entity of entities) {
        const count = session.mentioned_entities.get(entity) || 0;
        session.mentioned_entities.set(entity, count + 1);
      }
    }

    // 更新当前话题（取最新的意图）
    session.current_topic = intent;
  }

  // 添加消息
  const message: ChatMessage = {
    role,
    content,
    timestamp: Date.now(),
    intent,
    entities,
  };
  session.messages.push(message);

  // 更新最后活跃时间
  session.last_active_at = Date.now();

  // 检查是否需要压缩
  if (session.messages.length > DEFAULT_CONFIG.compression_threshold) {
    compressHistory(session);
  }

  return session;
}

/**
 * 更新活跃意图列表
 */
function updateActiveIntents(session: WorkingMemorySession, intents: string[]): void {
  const now = Date.now();
  
  for (const intent of intents) {
    const existing = session.active_intents.find(i => i.intent === intent);
    if (existing) {
      existing.last_seen = now;
      existing.count++;
    } else {
      session.active_intents.push({
        intent,
        first_seen: now,
        last_seen: now,
        count: 1,
      });
    }
  }

  // 移除超过 10 分钟未出现的意图
  const cutoff = now - 10 * 60 * 1000;
  session.active_intents = session.active_intents.filter(i => i.last_seen > cutoff);
}

/**
 * 压缩历史对话
 * 将较早的消息压缩为摘要，保留最近的消息在窗口内
 */
function compressHistory(session: WorkingMemorySession): void {
  const windowSize = DEFAULT_CONFIG.window_size;
  
  if (session.messages.length <= windowSize) return;

  // 需要压缩的消息
  const toCompress = session.messages.slice(0, session.messages.length - windowSize);
  const toKeep = session.messages.slice(session.messages.length - windowSize);

  // 生成压缩摘要（简单实现：提取关键信息）
  const summaryParts: string[] = [];
  
  if (session.compressed_summary) {
    summaryParts.push(session.compressed_summary);
  }

  // 按意图分组压缩
  const intentGroups: Map<string, string[]> = new Map();
  for (const msg of toCompress) {
    if (msg.role === 'user') {
      const intent = msg.intent || '通用对话';
      if (!intentGroups.has(intent)) {
        intentGroups.set(intent, []);
      }
      intentGroups.get(intent)!.push(msg.content);
    }
  }

  for (const [intent, contents] of intentGroups) {
    if (contents.length === 1) {
      summaryParts.push(`用户曾询问${intent}相关：${contents[0].slice(0, 50)}`);
    } else {
      summaryParts.push(`用户多次询问${intent}相关话题（${contents.length}次）`);
    }
  }

  session.compressed_summary = summaryParts.join('；');
  session.compressed_count += toCompress.length;
  session.messages = toKeep;

  console.log(`[WorkingMemory] 压缩了 ${toCompress.length} 条消息，当前保留 ${toKeep.length} 条`);
}

/**
 * 获取上下文快照（用于 LLM 调用）
 */
export function getContextSnapshot(userId: string, sessionId: string): ContextSnapshot {
  const session = getOrCreateSession(userId, sessionId);
  
  // 获取高频实体 top 5
  const topEntities = Array.from(session.mentioned_entities.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([entity]) => entity);

  return {
    summary: session.compressed_summary,
    recent_messages: session.messages.slice(-DEFAULT_CONFIG.window_size),
    current_topic: session.current_topic,
    active_intents: session.active_intents.map(i => i.intent),
    top_entities: topEntities,
    session_duration_seconds: Math.floor((Date.now() - session.created_at) / 1000),
    total_turns: session.messages.length + session.compressed_count,
  };
}

/**
 * 构建 LLM 多轮对话的 messages 数组
 * 将工作记忆中的上下文转换为 LLM API 所需的格式
 */
export function buildLLMMessages(
  userId: string,
  sessionId: string,
  systemPrompt: string,
  currentMessage: string
): Array<{ role: string; content: string }> {
  const snapshot = getContextSnapshot(userId, sessionId);
  const messages: Array<{ role: string; content: string }> = [];

  // 1. System prompt
  let enhancedSystemPrompt = systemPrompt;

  // 添加压缩的历史摘要
  if (snapshot.summary) {
    enhancedSystemPrompt += `\n\n【对话历史摘要】\n${snapshot.summary}`;
  }

  // 添加当前话题和意图
  if (snapshot.current_topic) {
    enhancedSystemPrompt += `\n\n【当前话题】${snapshot.current_topic}`;
  }
  if (snapshot.active_intents.length > 0) {
    enhancedSystemPrompt += `\n【活跃意图】${snapshot.active_intents.join('、')}`;
  }

  // 添加高频实体
  if (snapshot.top_entities.length > 0) {
    enhancedSystemPrompt += `\n【对话中提及的关键实体】${snapshot.top_entities.join('、')}`;
  }

  messages.push({ role: 'system', content: enhancedSystemPrompt });

  // 2. 历史对话消息（滑动窗口内的）
  for (const msg of snapshot.recent_messages) {
    // 排除当前消息（会在最后单独添加）
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // 3. 当前用户消息
  messages.push({ role: 'user', content: currentMessage });

  return messages;
}

/**
 * 检测话题是否发生切换
 */
export function detectTopicSwitch(userId: string, sessionId: string, newMessage: string): {
  switched: boolean;
  previous_topic: string | null;
  new_topic: string;
} {
  const session = getOrCreateSession(userId, sessionId);
  const newIntents = detectIntent(newMessage);
  const newTopic = newIntents[0] || '通用对话';
  const previousTopic = session.current_topic;

  const switched = previousTopic !== null 
    && previousTopic !== newTopic 
    && previousTopic !== '通用对话'
    && newTopic !== '通用对话'
    && newTopic !== '问候'
    && newTopic !== '致谢';

  return {
    switched,
    previous_topic: previousTopic,
    new_topic: newTopic,
  };
}

/**
 * 获取会话信息
 */
export function getSessionInfo(userId: string, sessionId: string): any {
  const key = `${userId}:${sessionId}`;
  const session = sessionPool.get(key);
  
  if (!session) return null;

  return {
    session_id: session.session_id,
    user_id: session.user_id,
    message_count: session.messages.length,
    compressed_count: session.compressed_count,
    total_turns: session.messages.length + session.compressed_count,
    current_topic: session.current_topic,
    active_intents: session.active_intents.map(i => ({
      intent: i.intent,
      count: i.count,
    })),
    mentioned_entities: Object.fromEntries(session.mentioned_entities),
    has_summary: !!session.compressed_summary,
    summary: session.compressed_summary,
    created_at: new Date(session.created_at).toISOString(),
    last_active_at: new Date(session.last_active_at).toISOString(),
    ttl_remaining_seconds: Math.max(0, Math.floor(
      (session.ttl_ms - (Date.now() - session.last_active_at)) / 1000
    )),
    metadata: session.metadata,
  };
}

/**
 * 获取用户所有活跃会话
 */
export function getUserSessions(userId: string): any[] {
  const sessions: any[] = [];
  
  for (const [key, session] of sessionPool.entries()) {
    if (!key.startsWith(`${userId}:`)) continue;
    
    // 跳过已过期的
    if (Date.now() - session.last_active_at > session.ttl_ms) continue;

    sessions.push({
      session_id: session.session_id,
      message_count: session.messages.length + session.compressed_count,
      current_topic: session.current_topic,
      last_active_at: new Date(session.last_active_at).toISOString(),
      ttl_remaining_seconds: Math.max(0, Math.floor(
        (session.ttl_ms - (Date.now() - session.last_active_at)) / 1000
      )),
    });
  }

  return sessions;
}

/**
 * 销毁会话
 */
export function destroySession(userId: string, sessionId: string): boolean {
  const key = `${userId}:${sessionId}`;
  return sessionPool.delete(key);
}

/**
 * 延长会话 TTL
 */
export function extendSessionTTL(userId: string, sessionId: string, additionalMs: number): boolean {
  const key = `${userId}:${sessionId}`;
  const session = sessionPool.get(key);
  if (!session) return false;
  
  session.ttl_ms += additionalMs;
  session.last_active_at = Date.now();
  return true;
}

/**
 * 设置会话元数据
 */
export function setSessionMetadata(userId: string, sessionId: string, key: string, value: any): boolean {
  const sessionKey = `${userId}:${sessionId}`;
  const session = sessionPool.get(sessionKey);
  if (!session) return false;
  
  session.metadata[key] = value;
  return true;
}

/**
 * 获取全局工作记忆统计
 */
export function getWorkingMemoryStats(): {
  total_sessions: number;
  active_sessions: number;
  expired_sessions: number;
  total_messages: number;
  total_compressed: number;
} {
  let active = 0;
  let expired = 0;
  let totalMessages = 0;
  let totalCompressed = 0;

  for (const session of sessionPool.values()) {
    if (Date.now() - session.last_active_at > session.ttl_ms) {
      expired++;
    } else {
      active++;
    }
    totalMessages += session.messages.length;
    totalCompressed += session.compressed_count;
  }

  return {
    total_sessions: sessionPool.size,
    active_sessions: active,
    expired_sessions: expired,
    total_messages: totalMessages,
    total_compressed: totalCompressed,
  };
}

// ========== 定时清理 ==========

/**
 * 清理过期会话
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, session] of sessionPool.entries()) {
    if (now - session.last_active_at > session.ttl_ms) {
      sessionPool.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[WorkingMemory] 清理了 ${cleaned} 个过期会话，剩余 ${sessionPool.size} 个`);
  }
}

/**
 * 启动定时清理
 */
export function startCleanupScheduler(intervalMs?: number): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  const interval = intervalMs || DEFAULT_CONFIG.cleanup_interval_ms;
  cleanupTimer = setInterval(cleanupExpiredSessions, interval);
  console.log(`[WorkingMemory] 定时清理已启动，间隔 ${interval / 1000} 秒`);
}

/**
 * 停止定时清理
 */
export function stopCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[WorkingMemory] 定时清理已停止');
  }
}

// 启动清理调度器
startCleanupScheduler();

console.log('[WorkingMemory] 工作记忆模块已加载');
