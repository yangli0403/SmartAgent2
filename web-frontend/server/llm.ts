/**
 * LLM 调用模块 - 接入字节跳动 Ark API
 */

const ARK_API_KEY = process.env.ARK_API_KEY || '7c4d52bf-e540-4337-a9ab-1a5228acedaa';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

interface ChatContext {
  message: string;
  profile?: any;
  memories?: any[];
  characterId: string;
}

// 人格系统提示词
const CHARACTER_PROMPTS: Record<string, string> = {
  default: '你是小智，一个智能车载 AI 助手。你温和友好，擅长处理导航、音乐、天气等车载场景。请用简洁、自然的语言回复用户。',
  jarvis: '你是贾维斯，一个高效精准的 AI 助手。你的风格简洁专业，精通技术分析和数据驱动决策。请用专业、高效的语言回复用户。',
  alfred: '你是阿尔弗雷德，一个优雅绅士的管家型 AI。你措辞考究，擅长生活管理和礼仪建议。请用优雅、得体的语言回复用户。',
};

/**
 * 构建上下文提示词
 */
function buildContextPrompt(context: ChatContext): string {
  let prompt = CHARACTER_PROMPTS[context.characterId] || CHARACTER_PROMPTS.default;

  // 添加用户画像信息
  if (context.profile) {
    prompt += '\n\n【用户画像】\n';
    prompt += `姓名：${context.profile.basic_info?.name || '未知'}\n`;
    
    if (context.profile.preferences && context.profile.preferences.length > 0) {
      prompt += '用户偏好：\n';
      context.profile.preferences.forEach((pref: any) => {
        prompt += `- ${pref.category}/${pref.key}: ${pref.value}\n`;
      });
    }

    if (context.profile.relationships && context.profile.relationships.length > 0) {
      prompt += '家庭关系：\n';
      context.profile.relationships.forEach((rel: any) => {
        prompt += `- ${rel.person_name}（${rel.relationship}）\n`;
      });
    }
  }

  // 添加情景记忆
  if (context.memories && context.memories.length > 0) {
    prompt += '\n\n【相关记忆】\n';
    context.memories.forEach((mem: any, idx: number) => {
      prompt += `${idx + 1}. [${mem.date}] ${mem.summary}\n`;
      if (mem.location) prompt += `   地点：${mem.location}\n`;
    });
  }

  prompt += '\n\n请基于以上用户画像和记忆，为用户提供个性化、贴心的回复。';
  
  return prompt;
}

/**
 * 调用 LLM 生成回复
 */
export async function chatWithLLM(context: ChatContext): Promise<string> {
  try {
    const systemPrompt = buildContextPrompt(context);

    // 调用字节跳动 Ark API
    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'ep-20250811200411-zctsd', // DeepSeek 模型
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context.message },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '抱歉，我现在无法回复。';
    return reply.trim();
  } catch (error: any) {
    console.error('LLM API error:', error);
    
    // 降级到简单回复
    if (context.message.includes('音乐') || context.message.includes('歌')) {
      return '好的，我来为您播放音乐。根据您的偏好，推荐播放周杰伦的歌曲。';
    } else if (context.message.includes('空调') || context.message.includes('温度')) {
      return '好的，我已将空调调整到您习惯的 23°C，中风模式。';
    } else if (context.message.includes('导航') || context.message.includes('去')) {
      return '好的，正在为您规划路线。';
    } else {
      return '我明白了，让我来帮您处理。';
    }
  }
}
