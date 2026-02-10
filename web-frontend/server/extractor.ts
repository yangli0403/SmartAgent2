/**
 * 记忆提取模块 (Memory Extractor)
 * 
 * 功能：从对话中异步提取结构化记忆信息
 * 设计参考：SmartAgent2 架构设计文档 v2.0
 * 
 * 核心能力：
 * 1. 滑动窗口：维护最近 5 轮对话上下文
 * 2. LLM 提取：使用 LLM 从对话中提取情景记忆和用户偏好
 * 3. 双写存储：将提取结果写入情景记忆表和偏好表
 */

const ARK_API_KEY = process.env.ARK_API_KEY || '7c4d52bf-e540-4337-a9ab-1a5228acedaa';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

// ========== 滑动窗口管理 ==========

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// 每个会话维护一个滑动窗口（最近 5 轮对话 = 10 条消息）
const conversationWindows: Map<string, ConversationTurn[]> = new Map();
const WINDOW_SIZE = 5; // 5 轮对话

/**
 * 向滑动窗口追加一轮对话
 */
export function appendToWindow(sessionKey: string, userMessage: string, assistantReply: string): void {
  const window = conversationWindows.get(sessionKey) || [];
  const now = new Date().toISOString();
  
  window.push(
    { role: 'user', content: userMessage, timestamp: now },
    { role: 'assistant', content: assistantReply, timestamp: now }
  );

  // 保持窗口大小：5 轮 = 10 条消息
  while (window.length > WINDOW_SIZE * 2) {
    window.shift();
  }

  conversationWindows.set(sessionKey, window);
}

/**
 * 获取当前窗口内容
 */
export function getWindow(sessionKey: string): ConversationTurn[] {
  return conversationWindows.get(sessionKey) || [];
}

/**
 * 清除会话窗口
 */
export function clearWindow(sessionKey: string): void {
  conversationWindows.delete(sessionKey);
}

// ========== LLM 提取逻辑 ==========

interface ExtractedMemory {
  event_type: string;
  summary: string;
  keywords: string[];
  participants: string[];
  location: string;
  details: string;
  importance: number;
  lossless_restatement: string;
}

interface ExtractedPreference {
  category: string;
  key: string;
  value: string;
  context: string | null;
  confidence: number;
}

interface ExtractionResult {
  memories: ExtractedMemory[];
  preferences: ExtractedPreference[];
  has_meaningful_content: boolean;
}

/**
 * 构建提取提示词
 */
function buildExtractionPrompt(conversationText: string, userName: string): string {
  return `你是一个专业的信息提取助手。请从以下对话中提取有价值的信息。

【对话内容】
${conversationText}

【提取要求】
请从对话中提取以下两类信息，以 JSON 格式返回：

1. **情景记忆 (memories)**：用户提到的事件、经历、计划。每条记忆包含：
   - event_type: 事件类型（如：通勤、购物、家庭、社交、工作、娱乐、出行、健康等）
   - summary: 事件摘要（一句话概括）
   - keywords: 关键词数组（3-5个）
   - participants: 参与者数组
   - location: 地点（如果提到）
   - details: 详细描述
   - importance: 重要性评分（1-5，5最重要）
   - lossless_restatement: 无损复述（保留所有细节的完整复述）

2. **用户偏好 (preferences)**：用户表达的喜好、习惯、需求。每条偏好包含：
   - category: 偏好类别（如：音乐、空调、座椅、导航、饮食、运动、购物等）
   - key: 偏好项（如：喜欢的歌手、温度偏好等）
   - value: 偏好值
   - context: 适用场景（如果有，如"通勤"、"周末"等）
   - confidence: 置信度（0.0-1.0，1.0表示用户明确表达）

3. **has_meaningful_content**: 布尔值，表示对话中是否包含值得提取的有意义内容。
   - 如果对话只是简单的问候、闲聊，没有包含具体事件或偏好信息，设为 false。
   - 如果包含了具体的事件、计划、偏好表达等，设为 true。

【重要规则】
- 只提取用户（${userName}）明确表达或暗示的信息，不要臆造。
- 如果对话中没有值得提取的信息，memories 和 preferences 返回空数组，has_meaningful_content 设为 false。
- 不要将 AI 助手的回复内容当作用户的偏好或记忆。
- 偏好的 confidence 应反映用户表达的确定程度：明确说"我喜欢"=1.0，"还不错"=0.7，推测=0.5。

请严格以 JSON 格式返回，不要包含任何其他文字：
{
  "memories": [...],
  "preferences": [...],
  "has_meaningful_content": true/false
}`;
}

/**
 * 调用 LLM 进行信息提取
 */
async function callLLMForExtraction(prompt: string): Promise<ExtractionResult> {
  try {
    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'ep-20250811200411-zctsd',
        messages: [
          { role: 'system', content: '你是一个精确的信息提取助手，只输出 JSON 格式的结果。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1, // 低温度保证提取的稳定性
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error(`[Extractor] LLM API error: ${response.status}`);
      return { memories: [], preferences: [], has_meaningful_content: false };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 解析 JSON（兼容 markdown 代码块包裹的情况）
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(jsonStr);
    return {
      memories: result.memories || [],
      preferences: result.preferences || [],
      has_meaningful_content: result.has_meaningful_content || false,
    };
  } catch (error: any) {
    console.error('[Extractor] Extraction failed:', error.message);
    return { memories: [], preferences: [], has_meaningful_content: false };
  }
}

// ========== 对外接口 ==========

/**
 * 异步提取记忆（在对话完成后调用，不阻塞主流程）
 * 
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 * @param userName 用户名称
 * @param addMemoryFn 添加记忆的回调函数
 * @param updatePreferenceFn 更新偏好的回调函数
 */
export async function extractMemoriesAsync(
  userId: string,
  sessionId: string,
  userName: string,
  addMemoryFn: (userId: string, memory: any) => Promise<void>,
  updatePreferenceFn: (userId: string, pref: any) => Promise<void>,
): Promise<ExtractionResult> {
  const sessionKey = `${userId}:${sessionId}`;
  const window = getWindow(sessionKey);

  if (window.length < 2) {
    // 至少需要一轮完整对话才进行提取
    return { memories: [], preferences: [], has_meaningful_content: false };
  }

  // 构建对话文本
  const conversationText = window.map(turn => {
    const speaker = turn.role === 'user' ? userName : 'AI助手';
    return `${speaker}：${turn.content}`;
  }).join('\n');

  // 调用 LLM 提取
  const prompt = buildExtractionPrompt(conversationText, userName);
  const result = await callLLMForExtraction(prompt);

  if (!result.has_meaningful_content) {
    console.log(`[Extractor] 对话无有意义内容，跳过存储`);
    return result;
  }

  // 双写存储：情景记忆
  for (const mem of result.memories) {
    try {
      await addMemoryFn(userId, {
        event_type: mem.event_type,
        summary: mem.summary,
        participants: mem.participants,
        location: mem.location,
        details: mem.lossless_restatement || mem.details,
        importance: mem.importance,
      });
      console.log(`[Extractor] 提取记忆: ${mem.summary}`);
    } catch (err: any) {
      console.error(`[Extractor] 记忆存储失败:`, err.message);
    }
  }

  // 双写存储：用户偏好（仅高置信度）
  for (const pref of result.preferences) {
    if (pref.confidence >= 0.6) {
      try {
        await updatePreferenceFn(userId, {
          category: pref.category,
          key: pref.key,
          value: pref.value,
          context: pref.context,
        });
        console.log(`[Extractor] 提取偏好: ${pref.category}/${pref.key} = ${pref.value} (置信度: ${pref.confidence})`);
      } catch (err: any) {
        console.error(`[Extractor] 偏好存储失败:`, err.message);
      }
    }
  }

  return result;
}
