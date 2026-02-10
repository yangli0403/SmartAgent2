/**
 * 存储模块 - 使用内存数据库模拟持久化
 */

// 生成相对日期
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// 用户画像数据
const userProfiles: Record<string, any> = {
  zhangming: {
    user_id: 'zhangming',
    basic_info: { name: '张明', age: '35', occupation: '软件工程师', phone: '138****6789' },
    preferences: [
      { id: 'p1', category: '音乐', key: '喜欢的歌手', value: '周杰伦、五月天、林俊杰' },
      { id: 'p2', category: '音乐', key: '喜欢的歌曲', value: '晴天、倔强、江南、稻香' },
      { id: 'p3', category: '音乐', key: '音乐风格', value: '华语流行、摇滚' },
      { id: 'p4', category: '音乐', key: '通勤音乐偏好', value: '五月天', context: '通勤' },
      { id: 'p5', category: '空调', key: '温度', value: '23°C' },
      { id: 'p6', category: '空调', key: '风量', value: '中风' },
      { id: 'p7', category: '空调', key: '模式', value: '自动' },
      { id: 'p8', category: '座椅', key: '座椅加热', value: '中档' },
      { id: 'p9', category: '座椅', key: '座椅位置', value: '记忆位置 1' },
      { id: 'p10', category: '导航', key: '上班地址', value: '科技园 A 座 18 楼' },
      { id: 'p11', category: '导航', key: '常去超市', value: '山姆会员店（南山店）' },
      { id: 'p12', category: '饮食', key: '口味偏好', value: '川菜、湘菜，偏辣' },
    ],
    relationships: [
      { person_name: '李芳', relationship: '妻子', details: { age: '33', occupation: '设计师', hobby: '瑜伽、烘焙、逛展览' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级', hobby: '画画、跳舞、看动画片' }, tags: ['家人', '孩子'] },
      { person_name: '妈妈（张母）', relationship: '母亲', details: { age: '62', health: '膝盖不好，有轻微关节炎' }, tags: ['家人', '长辈'] },
      { person_name: '老王', relationship: '同事/好友', details: { hobby: '钓鱼、露营、自驾游' }, tags: ['朋友', '同事'] },
    ],
    updated_at: new Date().toISOString(),
  },
  lifang: {
    user_id: 'lifang',
    basic_info: { name: '李芳', age: '33', occupation: '设计师', phone: '139****1234' },
    preferences: [
      { id: 'p1', category: '音乐', key: '喜欢的歌手', value: '邓紫棋、Taylor Swift、Adele' },
      { id: 'p2', category: '音乐', key: '喜欢的歌曲', value: '光年之外、Love Story、泡沫' },
      { id: 'p3', category: '空调', key: '温度', value: '25°C' },
      { id: 'p4', category: '空调', key: '风量', value: '低风' },
      { id: 'p5', category: '座椅', key: '座椅通风', value: '开启' },
    ],
    relationships: [
      { person_name: '张明', relationship: '丈夫', details: { age: '35', occupation: '软件工程师' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级' }, tags: ['家人', '孩子'] },
    ],
    updated_at: new Date().toISOString(),
  },
  xiaomeng: {
    user_id: 'xiaomeng',
    basic_info: { name: '张小萌', age: '8', school: '阳光小学三年级' },
    preferences: [
      { id: 'p1', category: '音乐', key: '喜欢的歌手', value: '儿歌、迪士尼音乐' },
      { id: 'p2', category: '饮食', key: '喜欢的食物', value: '草莓蛋糕、冰淇淋' },
    ],
    relationships: [
      { person_name: '张明', relationship: '爸爸', details: { age: '35' }, tags: ['家人'] },
      { person_name: '李芳', relationship: '妈妈', details: { age: '33' }, tags: ['家人'] },
    ],
    updated_at: new Date().toISOString(),
  },
};

// 情景记忆数据
const episodicMemories: Record<string, any[]> = {
  zhangming: [
    { id: 'e1', date: daysAgo(1), event_type: '通勤', summary: '早上 8:30 开车去公司，路上听五月天', participants: ['zhangming'], location: '家 → 科技园', details: '早高峰，路况一般，听了《倔强》《温柔》', importance: 3 },
    { id: 'e2', date: daysAgo(2), event_type: '购物', summary: '周末和老婆去山姆会员店采购', participants: ['zhangming', 'lifang'], location: '山姆会员店（南山店）', details: '买了一周的食材和日用品，花费约 800 元', importance: 4 },
    { id: 'e3', date: daysAgo(3), event_type: '家庭', summary: '送女儿去上兴趣班', participants: ['zhangming', 'xiaomeng'], location: '少年宫', details: '小萌上绘画课，路上聊了学校的事情', importance: 5 },
    { id: 'e4', date: daysAgo(7), event_type: '探亲', summary: '去老城区看望妈妈', participants: ['zhangming', 'lifang', 'xiaomeng'], location: '翠苑小区', details: '妈妈膝盖疼痛有所缓解，带了补品和水果', importance: 5 },
    { id: 'e5', date: daysAgo(14), event_type: '社交', summary: '和老王去钓鱼', participants: ['zhangming'], location: '西丽水库', details: '周末休闲活动，钓了几条小鱼，聊了工作和生活', importance: 3 },
  ],
  lifang: [
    { id: 'e1', date: daysAgo(1), event_type: '工作', summary: '去客户公司讨论设计方案', participants: ['lifang'], location: '南山科技园', details: '展示了新的 UI 设计稿，客户反馈不错', importance: 4 },
    { id: 'e2', date: daysAgo(2), event_type: '购物', summary: '和老公去山姆会员店采购', participants: ['lifang', 'zhangming'], location: '山姆会员店（南山店）', details: '买了一周的食材和日用品', importance: 4 },
    { id: 'e3', date: daysAgo(5), event_type: '健身', summary: '晚上去瑜伽馆上课', participants: ['lifang'], location: '悦动瑜伽馆', details: '上了一节流瑜伽课，感觉颈椎舒服多了', importance: 3 },
  ],
  xiaomeng: [
    { id: 'e1', date: daysAgo(1), event_type: '学习', summary: '在学校上美术课', participants: ['xiaomeng'], location: '阳光小学', details: '画了一幅春天的画，老师表扬了', importance: 4 },
    { id: 'e2', date: daysAgo(3), event_type: '兴趣班', summary: '爸爸送我去上绘画课', participants: ['xiaomeng', 'zhangming'], location: '少年宫', details: '学习了水彩画技巧，很开心', importance: 5 },
  ],
};

// ========== 用户画像接口 ==========
export async function getUserProfile(userId: string): Promise<any> {
  return userProfiles[userId] || null;
}

export async function updateUserProfile(userId: string, data: any): Promise<any> {
  if (!userProfiles[userId]) {
    throw new Error('User not found');
  }
  userProfiles[userId] = { ...userProfiles[userId], ...data, updated_at: new Date().toISOString() };
  return userProfiles[userId];
}

// ========== 记忆统计接口 ==========
export async function getMemoryStats(userId: string): Promise<any> {
  const profile = userProfiles[userId];
  const memories = episodicMemories[userId] || [];
  
  return {
    user_id: userId,
    episodic_count: memories.length,
    semantic_count: profile?.preferences?.length || 0,
    total_memories: memories.length + (profile?.preferences?.length || 0),
    oldest_memory: memories.length > 0 ? memories[memories.length - 1].date : null,
    newest_memory: memories.length > 0 ? memories[0].date : null,
  };
}

// ========== 情景记忆接口 ==========
export async function getEpisodicMemories(userId: string, limit: number = 20): Promise<any[]> {
  const memories = episodicMemories[userId] || [];
  return memories.slice(0, limit);
}

export async function addEpisodicMemory(userId: string, memory: any): Promise<void> {
  if (!episodicMemories[userId]) {
    episodicMemories[userId] = [];
  }
  const newMemory = {
    id: `e_${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    ...memory,
    importance: memory.importance || 3,
  };
  episodicMemories[userId].unshift(newMemory);
  
  // 保持最多 100 条记忆
  if (episodicMemories[userId].length > 100) {
    episodicMemories[userId] = episodicMemories[userId].slice(0, 100);
  }
}
