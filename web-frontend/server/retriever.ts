/**
 * 记忆检索模块 (Memory Retriever)
 * 
 * 功能：基于多策略混合检索，从记忆库中找到与当前对话最相关的记忆
 * 设计参考：SmartAgent2 架构设计文档 v2.0
 * 
 * 核心能力：
 * 1. 关键词检索 (Sparse)：基于 SQLite FTS 或 LIKE 的词汇匹配
 * 2. 语义检索 (Dense)：基于 LLM 的语义相关性评分
 * 3. 符号检索 (Symbolic)：基于元数据过滤（时间、事件类型、参与者）
 * 4. RRF 融合：使用 Reciprocal Rank Fusion 融合多路检索结果
 */

const ARK_API_KEY = process.env.ARK_API_KEY || '7c4d52bf-e540-4337-a9ab-1a5228acedaa';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

interface MemoryItem {
  id: string;
  date: string;
  event_type: string;
  summary: string;
  participants: string[];
  location: string;
  details: string;
  importance: number;
}

interface ScoredMemory extends MemoryItem {
  score: number;
  match_reasons: string[];
}

// ========== 1. 关键词检索 (Sparse) ==========

/**
 * 从用户消息中提取关键词
 */
function extractKeywords(message: string): string[] {
  // 去除常见停用词，提取有意义的词汇
  const stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
    '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那',
    '吗', '吧', '呢', '啊', '哦', '嗯', '把', '被', '让', '给',
    '可以', '什么', '怎么', '哪里', '哪个', '为什么', '能', '想',
    '帮', '帮我', '请', '下', '一下',
  ]);

  // 简单分词：按标点和空格分割，过滤停用词
  const words = message
    .replace(/[，。！？、；：""''（）《》【】\s]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2 && !stopWords.has(w));

  return [...new Set(words)];
}

/**
 * 关键词匹配评分
 */
function keywordSearch(memories: MemoryItem[], keywords: string[]): ScoredMemory[] {
  if (keywords.length === 0) return [];

  return memories.map(mem => {
    const searchText = `${mem.summary} ${mem.details} ${mem.location} ${mem.event_type}`.toLowerCase();
    let matchCount = 0;
    const matchedKeywords: string[] = [];

    for (const kw of keywords) {
      if (searchText.includes(kw.toLowerCase())) {
        matchCount++;
        matchedKeywords.push(kw);
      }
    }

    const score = matchCount / keywords.length;
    return {
      ...mem,
      score,
      match_reasons: matchedKeywords.length > 0 ? [`关键词匹配: ${matchedKeywords.join(', ')}`] : [],
    };
  }).filter(m => m.score > 0);
}

// ========== 2. 符号检索 (Symbolic) ==========

/**
 * 基于元数据的符号检索
 */
function symbolicSearch(memories: MemoryItem[], message: string): ScoredMemory[] {
  const results: ScoredMemory[] = [];
  const msgLower = message.toLowerCase();

  // 事件类型匹配
  const eventTypeMap: Record<string, string[]> = {
    '通勤': ['上班', '下班', '通勤', '开车去公司', '回家'],
    '购物': ['购物', '买', '超市', '商场', '山姆', '采购'],
    '家庭': ['家人', '女儿', '老婆', '妈妈', '爸爸', '孩子', '家'],
    '社交': ['朋友', '同事', '聚会', '钓鱼', '约'],
    '工作': ['工作', '公司', '项目', '会议', '客户'],
    '娱乐': ['电影', '游戏', '音乐', '唱歌', '玩'],
    '出行': ['旅行', '出去', '去', '导航', '路线'],
    '健身': ['运动', '健身', '瑜伽', '跑步', '锻炼'],
    '探亲': ['看望', '探亲', '老家', '父母'],
  };

  for (const mem of memories) {
    let score = 0;
    const reasons: string[] = [];

    // 事件类型匹配
    for (const [type, triggers] of Object.entries(eventTypeMap)) {
      if (triggers.some(t => msgLower.includes(t)) && mem.event_type === type) {
        score += 0.5;
        reasons.push(`事件类型匹配: ${type}`);
      }
    }

    // 地点匹配
    if (mem.location) {
      const locationWords = mem.location.split(/[→，,\s]+/).filter(w => w.length >= 2);
      for (const lw of locationWords) {
        if (msgLower.includes(lw.toLowerCase())) {
          score += 0.4;
          reasons.push(`地点匹配: ${lw}`);
        }
      }
    }

    // 参与者匹配
    const personMap: Record<string, string[]> = {
      'lifang': ['老婆', '李芳', '妻子'],
      'xiaomeng': ['女儿', '小萌', '孩子'],
      'zhangming': ['张明'],
    };
    for (const [pid, aliases] of Object.entries(personMap)) {
      if (aliases.some(a => msgLower.includes(a)) && mem.participants.includes(pid)) {
        score += 0.3;
        reasons.push(`参与者匹配: ${aliases[0]}`);
      }
    }

    // 时间相关性：越近的记忆越相关
    const daysDiff = Math.floor((Date.now() - new Date(mem.date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) score += 0.2;
    else if (daysDiff <= 3) score += 0.15;
    else if (daysDiff <= 7) score += 0.1;

    // 重要性加权
    score += (mem.importance / 5) * 0.1;

    if (score > 0) {
      results.push({ ...mem, score, match_reasons: reasons });
    }
  }

  return results;
}

// ========== 3. 语义检索 (Dense) ==========

/**
 * 使用 LLM 对候选记忆进行语义相关性评分
 * 只在候选记忆数量较多时使用，避免过度调用 LLM
 */
async function semanticRerank(
  message: string,
  candidates: ScoredMemory[],
  topK: number = 5
): Promise<ScoredMemory[]> {
  if (candidates.length <= topK) return candidates;

  try {
    const memorySummaries = candidates.map((m, i) => `[${i}] ${m.summary} (${m.date}, ${m.location || '未知地点'})`).join('\n');

    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'ep-20250811200411-zctsd',
        messages: [
          {
            role: 'system',
            content: '你是一个记忆相关性评估助手。请评估哪些记忆与用户当前的对话最相关。只输出 JSON。',
          },
          {
            role: 'user',
            content: `用户说："${message}"

以下是候选记忆列表：
${memorySummaries}

请从中选出最相关的 ${topK} 条记忆，按相关性从高到低排序。
返回 JSON 格式：{"ranked_indices": [索引1, 索引2, ...], "reasons": ["原因1", "原因2", ...]}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      console.error(`[Retriever] Semantic rerank API error: ${response.status}`);
      return candidates.slice(0, topK);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(content);
    const rankedIndices: number[] = result.ranked_indices || [];

    // 根据 LLM 排序结果重新评分
    const reranked: ScoredMemory[] = [];
    for (let rank = 0; rank < rankedIndices.length && rank < topK; rank++) {
      const idx = rankedIndices[rank];
      if (idx >= 0 && idx < candidates.length) {
        const mem = candidates[idx];
        mem.score += (topK - rank) * 0.1; // 语义排名加分
        if (result.reasons?.[rank]) {
          mem.match_reasons.push(`语义相关: ${result.reasons[rank]}`);
        }
        reranked.push(mem);
      }
    }

    return reranked.length > 0 ? reranked : candidates.slice(0, topK);
  } catch (error: any) {
    console.error('[Retriever] Semantic rerank failed:', error.message);
    return candidates.slice(0, topK);
  }
}

// ========== 4. RRF 融合 ==========

/**
 * Reciprocal Rank Fusion (RRF) 融合多路检索结果
 * RRF score = Σ 1 / (k + rank_i)，k = 60 是常用常数
 */
function rrfFusion(resultSets: ScoredMemory[][], k: number = 60): ScoredMemory[] {
  const scoreMap = new Map<string, { memory: ScoredMemory; rrfScore: number; reasons: string[] }>();

  for (const results of resultSets) {
    // 按 score 降序排列
    const sorted = [...results].sort((a, b) => b.score - a.score);

    for (let rank = 0; rank < sorted.length; rank++) {
      const mem = sorted[rank];
      const rrfContribution = 1 / (k + rank + 1);

      if (scoreMap.has(mem.id)) {
        const existing = scoreMap.get(mem.id)!;
        existing.rrfScore += rrfContribution;
        // 合并匹配原因
        for (const reason of mem.match_reasons) {
          if (!existing.reasons.includes(reason)) {
            existing.reasons.push(reason);
          }
        }
      } else {
        scoreMap.set(mem.id, {
          memory: mem,
          rrfScore: rrfContribution,
          reasons: [...mem.match_reasons],
        });
      }
    }
  }

  // 按 RRF 分数降序排列
  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(item => ({
      ...item.memory,
      score: item.rrfScore,
      match_reasons: item.reasons,
    }));
}

// ========== 对外接口 ==========

/**
 * 混合检索记忆
 * 
 * @param message 用户当前消息
 * @param allMemories 该用户的所有记忆
 * @param topK 返回的最大记忆数量
 * @param enableSemanticRerank 是否启用 LLM 语义重排（会增加延迟）
 */
export async function retrieveMemories(
  message: string,
  allMemories: MemoryItem[],
  topK: number = 5,
  enableSemanticRerank: boolean = true,
): Promise<ScoredMemory[]> {
  if (allMemories.length === 0) return [];

  console.log(`[Retriever] 开始检索，消息: "${message.slice(0, 30)}..."，候选记忆: ${allMemories.length} 条`);

  // 1. 关键词检索
  const keywords = extractKeywords(message);
  const keywordResults = keywordSearch(allMemories, keywords);
  console.log(`[Retriever] 关键词检索: ${keywordResults.length} 条命中 (关键词: ${keywords.join(', ')})`);

  // 2. 符号检索
  const symbolicResults = symbolicSearch(allMemories, message);
  console.log(`[Retriever] 符号检索: ${symbolicResults.length} 条命中`);

  // 3. RRF 融合
  let fused = rrfFusion([keywordResults, symbolicResults]);
  console.log(`[Retriever] RRF 融合后: ${fused.length} 条`);

  // 4. 如果候选较多且启用语义重排，使用 LLM 进行语义重排
  if (enableSemanticRerank && fused.length > topK) {
    fused = await semanticRerank(message, fused, topK);
    console.log(`[Retriever] 语义重排后: ${fused.length} 条`);
  }

  // 5. 截取 topK
  const result = fused.slice(0, topK);
  console.log(`[Retriever] 最终返回: ${result.length} 条记忆`);

  return result;
}

/**
 * 简单检索（不使用 LLM，用于低延迟场景）
 */
export function retrieveMemoriesSimple(
  message: string,
  allMemories: MemoryItem[],
  topK: number = 5,
): ScoredMemory[] {
  if (allMemories.length === 0) return [];

  const keywords = extractKeywords(message);
  const keywordResults = keywordSearch(allMemories, keywords);
  const symbolicResults = symbolicSearch(allMemories, message);
  const fused = rrfFusion([keywordResults, symbolicResults]);

  return fused.slice(0, topK);
}
