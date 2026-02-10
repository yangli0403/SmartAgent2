/**
 * LLM 调用模块 - 接入字节跳动 Ark API
 * 支持 ElizaOS Characterfile 风格的丰富人格数据
 */

import { getCharacterConfig, type CharacterConfig } from './characters';

const ARK_API_KEY = process.env.ARK_API_KEY || '7c4d52bf-e540-4337-a9ab-1a5228acedaa';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

interface ChatContext {
  message: string;
  profile?: any;
  memories?: any[];
  characterId: string;
}

/**
 * 从人格配置中随机选取部分 bio 和 lore 条目
 * 参照 ElizaOS 的做法，通过随机采样增加对话的多样性
 */
function sampleArray(arr: string[], count: number): string[] {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= count) return arr;
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * 构建基于 ElizaOS Characterfile 的人格提示词
 * 将 bio、lore、adjectives、topics、style、messageExamples、knowledge、system 等字段
 * 有机整合到 LLM 的 system prompt 中
 */
function buildCharacterPrompt(character: CharacterConfig): string {
  let prompt = '';

  // 1. 系统提示词（核心行为准则）
  if (character.system) {
    prompt += character.system;
  }

  // 2. 背景描述（bio）- 随机采样 3-4 条
  if (character.bio && character.bio.length > 0) {
    const sampledBio = sampleArray(character.bio, 4);
    prompt += '\n\n【角色背景】\n';
    sampledBio.forEach(b => { prompt += `- ${b}\n`; });
  }

  // 3. 传说/历史（lore）- 随机采样 2-3 条
  if (character.lore && character.lore.length > 0) {
    const sampledLore = sampleArray(character.lore, 3);
    prompt += '\n【角色故事】\n';
    sampledLore.forEach(l => { prompt += `- ${l}\n`; });
  }

  // 4. 性格特质（adjectives）
  if (character.adjectives && character.adjectives.length > 0) {
    const sampledAdj = sampleArray(character.adjectives, 6);
    prompt += `\n【性格特质】\n你的核心性格特质是：${sampledAdj.join('、')}。\n`;
  }

  // 5. 擅长话题（topics）
  if (character.topics && character.topics.length > 0) {
    prompt += `\n【擅长领域】\n你特别擅长以下话题：${character.topics.join('、')}。\n`;
  }

  // 6. 风格指令（style）
  if (character.style) {
    if (character.style.all && character.style.all.length > 0) {
      prompt += '\n【通用风格】\n';
      character.style.all.forEach(s => { prompt += `- ${s}\n`; });
    }
    if (character.style.chat && character.style.chat.length > 0) {
      prompt += '\n【对话风格】\n';
      character.style.chat.forEach(s => { prompt += `- ${s}\n`; });
    }
  }

  // 7. 对话示例（messageExamples）- 随机选取 2 组
  if (character.messageExamples && character.messageExamples.length > 0) {
    const sampledExamples = sampleArray(
      character.messageExamples.map((ex, i) => JSON.stringify({ idx: i, ex })),
      2
    ).map(s => JSON.parse(s));

    prompt += '\n【对话风格示例】\n以下是你的典型对话风格，请参考但不要机械模仿：\n';
    sampledExamples.forEach(({ ex }: any) => {
      ex.forEach((msg: any) => {
        const role = msg.user === '{{user}}' ? '用户' : character.name;
        prompt += `${role}：${msg.content}\n`;
      });
      prompt += '---\n';
    });
  }

  // 8. 知识库（knowledge）
  if (character.knowledge && character.knowledge.length > 0) {
    prompt += '\n【专业知识】\n';
    character.knowledge.forEach(k => { prompt += `- ${k}\n`; });
  }

  return prompt;
}

/**
 * 构建完整的上下文提示词
 * 整合人格数据 + 用户画像 + 情景记忆 + 行为准则
 */
function buildContextPrompt(context: ChatContext): string {
  // 获取完整的人格配置
  const character = getCharacterConfig(context.characterId);
  
  // 构建人格提示词
  let prompt = buildCharacterPrompt(character);

  // 核心行为指引：聚焦用户意图
  prompt += `

【重要行为准则】
1. 你必须根据用户的当前消息意图来回复，只提供与用户意图直接相关的信息。
2. 以下提供的用户画像和记忆仅作为背景知识参考，帮助你更好地理解用户。
3. 不要在回复中主动提及与用户当前意图无关的偏好设置。例如：用户问导航相关问题时，不要主动提及空调、音乐、座椅等设置；用户问音乐相关问题时，不要主动提及导航、空调等设置。
4. 只有当用户明确要求（如"模拟上车"、"帮我全部调好"等综合性请求）时，才可以综合多个偏好进行回复。
5. 回复要符合你的人格风格和性格特质，保持一致的语气和表达方式。`;

  // 添加用户画像信息（作为背景知识）
  if (context.profile) {
    prompt += '\n\n【用户画像（背景知识，仅在相关时引用）】\n';
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

  // 添加情景记忆（作为背景知识）
  if (context.memories && context.memories.length > 0) {
    prompt += '\n\n【相关记忆（背景知识，仅在相关时引用）】\n';
    context.memories.forEach((mem: any, idx: number) => {
      prompt += `${idx + 1}. [${mem.date}] ${mem.summary}\n`;
      if (mem.location) prompt += `   地点：${mem.location}\n`;
    });
  }

  prompt += '\n\n请严格按照你的人格风格和性格特质，根据用户的当前消息意图，提供精准、相关的回复。';
  
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
    
    // 降级到简单回复（保持人格风格）
    const character = getCharacterConfig(context.characterId);
    const name = character.name;
    
    if (context.message.includes('音乐') || context.message.includes('歌')) {
      if (context.characterId === 'jarvis') {
        return '已为您启动音乐播放。根据偏好数据，推荐播放周杰伦的歌曲。';
      } else if (context.characterId === 'alfred') {
        return '当然，这就为您播放音乐。根据您平日的喜好，为您选了周杰伦的歌曲，希望能为您的旅途增添一份好心情。';
      }
      return '好的，我来为您播放音乐。根据您的偏好，推荐播放周杰伦的歌曲。';
    } else if (context.message.includes('空调') || context.message.includes('温度')) {
      if (context.characterId === 'jarvis') {
        return '已执行：空调温度23°C，中风模式，自动运行。预计2分钟内达到目标温度。';
      } else if (context.characterId === 'alfred') {
        return '已为您将空调调至23°C，中档风量。这是您最习惯的设定，若觉得不合适，随时告诉我调整。';
      }
      return '好的，我已将空调调整到您习惯的 23°C，中风模式。';
    } else if (context.message.includes('导航') || context.message.includes('去')) {
      if (context.characterId === 'jarvis') {
        return '已规划路线。正在分析实时路况，请稍候。';
      } else if (context.characterId === 'alfred') {
        return '好的，这就为您规划路线。请稍等片刻，我来看看哪条路最顺畅。';
      }
      return '好的，正在为您规划路线。';
    } else {
      if (context.characterId === 'jarvis') {
        return '收到指令，正在处理。';
      } else if (context.characterId === 'alfred') {
        return '好的，我来为您处理这件事。';
      }
      return '我明白了，让我来帮您处理。';
    }
  }
}
