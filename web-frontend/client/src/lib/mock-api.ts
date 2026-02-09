/**
 * SmartAgent2 模拟 API 服务 v2
 * 支持 3 个用户角色、完整偏好数据、情景记忆、关系网络
 */
import type {
  ChatRequest, ChatResponse, MemoryStats, UserProfile, Character,
  UserRole, EpisodicMemoryItem, PreferenceItem, RelationshipItem,
} from './api';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ================================================================
// 日期工具：生成相对于"今天"的日期字符串
// ================================================================
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ================================================================
// 1. 用户角色定义
// ================================================================
export const userRoles: UserRole[] = [
  {
    id: 'zhangming',
    name: '张明',
    avatar: '👨',
    description: '车主，35 岁，软件工程师',
    age: 35,
    role_in_family: '车主（丈夫/父亲）',
  },
  {
    id: 'lifang',
    name: '李芳',
    avatar: '👩',
    description: '车主老婆，33 岁，设计师',
    age: 33,
    role_in_family: '车主老婆（妻子/母亲）',
  },
  {
    id: 'xiaomeng',
    name: '张小萌',
    avatar: '👧',
    description: '车主女儿，8 岁，小学生',
    age: 8,
    role_in_family: '车主女儿',
  },
];

// ================================================================
// 2. AI 人格
// ================================================================
const mockCharacters: Character[] = [
  { id: 'default', name: '小智', description: '智能车载 AI 助手，温和友好，擅长导航、音乐、天气等车载场景', source_format: 'characterfile' },
  { id: 'jarvis', name: '贾维斯', description: '高效精准的 AI 助手，风格简洁专业，精通技术分析和数据驱动决策', source_format: 'characterfile' },
  { id: 'alfred', name: '阿尔弗雷德', description: '优雅绅士的管家型 AI，措辞考究，擅长生活管理和礼仪建议', source_format: 'characterfile' },
];

// ================================================================
// 3. 用户画像数据（偏好 + 关系）
// ================================================================
const userProfiles: Record<string, UserProfile> = {
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
      { person_name: '李芳', relationship: '妻子', details: { age: '33', occupation: '设计师', hobby: '瑜伽、烘焙、逛展览', music: '邓紫棋、Taylor Swift', health: '轻微颈椎不适' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级', hobby: '画画、跳舞、看动画片', music: '儿歌、迪士尼音乐', favorite_food: '草莓蛋糕' }, tags: ['家人', '孩子'] },
      { person_name: '妈妈（张母）', relationship: '母亲', details: { age: '62', health: '膝盖不好，有轻微关节炎', hobby: '广场舞、养花', note: '住在老城区翠苑小区' }, tags: ['家人', '长辈'] },
      { person_name: '老王', relationship: '同事/好友', details: { hobby: '钓鱼、露营、自驾游', note: '周末经常约一起活动' }, tags: ['朋友', '同事'] },
    ],
    updated_at: new Date().toISOString(),
  },
  lifang: {
    user_id: 'lifang',
    basic_info: { name: '李芳', age: '33', occupation: '设计师', phone: '139****1234' },
    preferences: [
      { id: 'p1', category: '音乐', key: '喜欢的歌手', value: '邓紫棋、Taylor Swift、Adele' },
      { id: 'p2', category: '音乐', key: '喜欢的歌曲', value: '光年之外、Love Story、泡沫' },
      { id: 'p3', category: '音乐', key: '音乐风格', value: '流行、抒情、欧美流行' },
      { id: 'p4', category: '空调', key: '温度', value: '25°C' },
      { id: 'p5', category: '空调', key: '风量', value: '低风' },
      { id: 'p6', category: '空调', key: '模式', value: '制冷' },
      { id: 'p7', category: '座椅', key: '座椅通风', value: '开启' },
      { id: 'p8', category: '座椅', key: '座椅位置', value: '记忆位置 2' },
      { id: 'p9', category: '导航', key: '公司地址', value: '创意设计中心 B 栋 5 楼' },
      { id: 'p10', category: '导航', key: '瑜伽馆', value: '静心瑜伽馆（南山店）' },
      { id: 'p11', category: '饮食', key: '口味偏好', value: '日料、轻食、甜品' },
    ],
    relationships: [
      { person_name: '张明', relationship: '丈夫', details: { age: '35', occupation: '软件工程师', hobby: '编程、打篮球', music: '周杰伦、五月天' }, tags: ['家人', '配偶'] },
      { person_name: '张小萌', relationship: '女儿', details: { age: '8', school: '阳光小学三年级', hobby: '画画、跳舞', favorite_food: '草莓蛋糕' }, tags: ['家人', '孩子'] },
      { person_name: '小雨', relationship: '闺蜜', details: { hobby: '逛街、看电影、下午茶', note: '经常周末约着一起' }, tags: ['朋友'] },
      { person_name: '婆婆（张母）', relationship: '婆婆', details: { age: '62', health: '膝盖不好', note: '住在老城区翠苑小区' }, tags: ['家人', '长辈'] },
    ],
    updated_at: new Date().toISOString(),
  },
  xiaomeng: {
    user_id: 'xiaomeng',
    basic_info: { name: '张小萌', age: '8', school: '阳光小学三年级', class: '三年二班' },
    preferences: [
      { id: 'p1', category: '音乐', key: '喜欢的歌曲', value: 'Let It Go、小星星、孤勇者、虫儿飞' },
      { id: 'p2', category: '音乐', key: '音乐风格', value: '儿歌、迪士尼音乐、动画主题曲' },
      { id: 'p3', category: '空调', key: '温度', value: '24°C' },
      { id: 'p4', category: '空调', key: '风量', value: '低风' },
      { id: 'p5', category: '空调', key: '模式', value: '自动' },
      { id: 'p6', category: '座椅', key: '儿童座椅', value: '后排右侧' },
      { id: 'p7', category: '饮食', key: '喜欢的食物', value: '草莓蛋糕、巧克力冰淇淋、鸡米花' },
      { id: 'p8', category: '饮食', key: '不喜欢的食物', value: '苦瓜、芹菜' },
    ],
    relationships: [
      { person_name: '张明', relationship: '爸爸', details: { note: '每天送我上学' }, tags: ['家人'] },
      { person_name: '李芳', relationship: '妈妈', details: { note: '周末带我去画画课' }, tags: ['家人'] },
      { person_name: '奶奶（张母）', relationship: '奶奶', details: { note: '做的红烧肉最好吃', health: '膝盖不好' }, tags: ['家人', '长辈'] },
      { person_name: '小花', relationship: '同学/好朋友', details: { note: '同桌，一起上画画课' }, tags: ['朋友', '同学'] },
    ],
    updated_at: new Date().toISOString(),
  },
};

// ================================================================
// 4. 情景记忆数据（每个用户关联不同记忆）
// ================================================================
const allEpisodicMemories: EpisodicMemoryItem[] = [
  {
    id: 'em01', date: daysAgo(1), event_type: '通勤',
    summary: '张明早晨送小萌上学',
    participants: ['zhangming', 'xiaomeng'],
    location: '阳光小学',
    details: '早上 7:40 出发，走滨海大道，8:05 到达阳光小学门口。小萌说今天有美术课很开心。',
    importance: 0.7,
  },
  {
    id: 'em02', date: daysAgo(3), event_type: '聚餐',
    summary: '全家去吃四川火锅',
    participants: ['zhangming', 'lifang', 'xiaomeng'],
    location: '蜀香火锅（科技园店）',
    details: '晚上 6 点全家开车去蜀香火锅，张明点了麻辣锅底，李芳点了番茄锅底，小萌最喜欢涮虾滑和鱼丸。',
    importance: 0.8,
  },
  {
    id: 'em03', date: daysAgo(5), event_type: '购物',
    summary: '张明和李芳去山姆超市采购',
    participants: ['zhangming', 'lifang'],
    location: '山姆会员店（南山店）',
    details: '周末下午去山姆采购，买了牛排、水果、小萌的零食和日用品。李芳还买了烘焙材料。',
    importance: 0.6,
  },
  {
    id: 'em04', date: daysAgo(7), event_type: '出行',
    summary: '张明和老王去钓鱼',
    participants: ['zhangming'],
    location: '松湖钓场',
    details: '周六早上和老王一起去松湖钓场钓鱼，钓了一下午，张明钓到一条 3 斤的鲈鱼。老王说下次想去露营。',
    importance: 0.7,
  },
  {
    id: 'em05', date: daysAgo(2), event_type: '通勤',
    summary: '李芳开车去瑜伽馆',
    participants: ['lifang'],
    location: '静心瑜伽馆（南山店）',
    details: '下午 2 点出发去瑜伽馆，做了 1.5 小时的热瑜伽课程。回来时顺路去面包店买了小萌喜欢的草莓蛋糕。',
    importance: 0.5,
  },
  {
    id: 'em06', date: daysAgo(4), event_type: '接送',
    summary: '李芳接小萌放学后去画画课',
    participants: ['lifang', 'xiaomeng'],
    location: '彩虹艺术中心',
    details: '下午 4 点接小萌放学，4:30 送到彩虹艺术中心上画画课。小萌画了一幅全家福，老师表扬了她。',
    importance: 0.7,
  },
  {
    id: 'em07', date: daysAgo(6), event_type: '探望',
    summary: '全家去看望奶奶',
    participants: ['zhangming', 'lifang', 'xiaomeng'],
    location: '翠苑小区（奶奶家）',
    details: '周日上午全家开车去翠苑小区看望奶奶。奶奶做了红烧肉，小萌吃了两碗饭。奶奶说最近膝盖又有点疼，张明说下周带她去医院检查。',
    importance: 0.9,
  },
  {
    id: 'em08', date: daysAgo(8), event_type: '出行',
    summary: '李芳和闺蜜小雨去看展览',
    participants: ['lifang'],
    location: '当代艺术馆',
    details: '周六下午和小雨一起去当代艺术馆看"光影之间"摄影展，之后在附近的咖啡馆喝了下午茶。',
    importance: 0.5,
  },
  {
    id: 'em09', date: daysAgo(10), event_type: '维保',
    summary: '张明去 4S 店保养车辆',
    participants: ['zhangming'],
    location: '宝马 4S 店（南山店）',
    details: '上午 10 点去 4S 店做常规保养，换了机油和空调滤芯，技师建议下次更换刹车片。等了大约 2 小时。',
    importance: 0.6,
  },
  {
    id: 'em10', date: daysAgo(9), event_type: '聚餐',
    summary: '张明和李芳的结婚纪念日晚餐',
    participants: ['zhangming', 'lifang'],
    location: '米其林法餐厅 Le Jardin',
    details: '结婚纪念日，两人去了 Le Jardin 法餐厅。张明提前预定了靠窗位置，点了红酒和牛排。李芳很开心，说明年想去巴黎。',
    importance: 0.95,
  },
  {
    id: 'em11', date: daysAgo(12), event_type: '学校',
    summary: '小萌学校运动会',
    participants: ['zhangming', 'lifang', 'xiaomeng'],
    location: '阳光小学操场',
    details: '小萌参加了 50 米跑和跳绳比赛，50 米跑得了第三名。全家都去给她加油，小萌很开心。',
    importance: 0.8,
  },
  {
    id: 'em12', date: daysAgo(14), event_type: '出行',
    summary: '全家周末自驾去海边',
    participants: ['zhangming', 'lifang', 'xiaomeng'],
    location: '大梅沙海滨公园',
    details: '周末全家自驾去大梅沙，小萌第一次玩沙子玩了一整天。李芳拍了很多照片。回来路上小萌在车上睡着了。',
    importance: 0.85,
  },
];

// ================================================================
// 5. 获取用户相关的情景记忆
// ================================================================
const getMemoriesForUser = (userId: string): EpisodicMemoryItem[] => {
  return allEpisodicMemories.filter(m => m.participants.includes(userId));
};

// ================================================================
// 6. 记忆统计（按用户）
// ================================================================
const getMemoryStats = (userId: string): MemoryStats => {
  const memories = getMemoriesForUser(userId);
  const profile = userProfiles[userId];
  const prefCount = profile?.preferences?.length || 0;
  return {
    user_id: userId,
    episodic_count: memories.length,
    semantic_count: prefCount,
    total_memories: memories.length + prefCount,
    oldest_memory: memories.length > 0 ? memories[memories.length - 1].date : undefined,
    newest_memory: memories.length > 0 ? memories[0].date : undefined,
  };
};

// ================================================================
// 7. 智能对话回复引擎
// ================================================================
const generateReply = (message: string, userId: string, characterId: string): { reply: string; matched: EpisodicMemoryItem[] } => {
  const character = mockCharacters.find(c => c.id === characterId);
  const charName = character?.name || '小智';
  const profile = userProfiles[userId];
  const userName = profile?.basic_info?.name || '用户';
  const memories = getMemoriesForUser(userId);
  const prefs = profile?.preferences || [];
  const rels = profile?.relationships || [];
  const matched: EpisodicMemoryItem[] = [];

  // 人格语气前缀
  const tone = characterId === 'jarvis'
    ? `${userName}，`
    : characterId === 'alfred'
    ? `${userName}先生/女士，`
    : `${userName}，`;

  // ---------- 上车问候 ----------
  if (message.includes('上车') || message.includes('欢迎') || message.includes('开始')) {
    const tempPref = prefs.find(p => p.category === '空调' && p.key === '温度');
    const windPref = prefs.find(p => p.category === '空调' && p.key === '风量');
    const seatPref = prefs.find(p => p.category === '座椅');
    const temp = tempPref?.value || '23°C';
    const wind = windPref?.value || '中风';
    const seat = seatPref?.value || '';
    return {
      reply: `${tone}欢迎乘车！我是${charName}。已根据您的偏好自动设置：空调温度 ${temp}，风量 ${wind}${seat ? `，${seatPref?.key} ${seat}` : ''}。今天有什么我可以帮您的吗？`,
      matched,
    };
  }

  // ---------- 按习惯调整空调 ----------
  if ((message.includes('习惯') || message.includes('偏好')) && (message.includes('空调') || message.includes('调整'))) {
    const acPrefs = prefs.filter(p => p.category === '空调');
    if (acPrefs.length > 0) {
      const details = acPrefs.map(p => `${p.key}: ${p.value}`).join('，');
      return {
        reply: `${tone}好的，已按照您的习惯调整空调设置：${details}。如果需要微调，随时告诉我。`,
        matched,
      };
    }
  }

  // ---------- 记住偏好 ----------
  if (message.includes('记住') || message.includes('保存')) {
    return {
      reply: `${tone}好的，我已经记住了您当前的设置。下次会自动为您应用这些偏好。目前已为您保存了 ${prefs.length} 项个人偏好。`,
      matched,
    };
  }

  // ---------- 删除偏好 ----------
  if (message.includes('不要播放') || message.includes('不要放') || message.includes('不再') || message.includes('删除偏好')) {
    const songMatch = message.match(/不要播放(.+?)了|不要放(.+?)了|不再播(.+?)了/);
    const song = songMatch ? (songMatch[1] || songMatch[2] || songMatch[3]) : '';
    if (song) {
      return {
        reply: `${tone}好的，我已将「${song}」从您的音乐偏好中移除，以后不会再为您播放这首歌了。`,
        matched,
      };
    }
    return {
      reply: `${tone}好的，我已更新您的偏好设置，移除了相关项目。`,
      matched,
    };
  }

  // ---------- 场景化偏好 ----------
  if (message.includes('通勤') || message.includes('上班的时候') || message.includes('回家的时候')) {
    const contextMatch = message.match(/(通勤|上班|回家)/);
    const ctx = contextMatch ? contextMatch[1] : '通勤';
    const artistMatch = message.match(/多放(.+?)吧|播放(.+?)的|听(.+?)的/);
    const artist = artistMatch ? (artistMatch[1] || artistMatch[2] || artistMatch[3]) : '';
    if (artist) {
      return {
        reply: `${tone}好的，我已记录您的场景化偏好：${ctx}时优先播放「${artist}」的音乐。下次${ctx}时我会自动为您安排。`,
        matched,
      };
    }
    // 已有通勤偏好
    const commutePref = prefs.find(p => p.context === '通勤' || p.key?.includes('通勤'));
    if (commutePref) {
      return {
        reply: `${tone}您${ctx}时的音乐偏好是「${commutePref.value}」，需要我现在播放吗？`,
        matched,
      };
    }
  }

  // ---------- 音乐 ----------
  if (message.includes('音乐') || message.includes('歌') || message.includes('播放')) {
    const musicPrefs = prefs.filter(p => p.category === '音乐');
    if (musicPrefs.length > 0) {
      const artists = musicPrefs.find(p => p.key === '喜欢的歌手')?.value || '';
      const songs = musicPrefs.find(p => p.key === '喜欢的歌曲')?.value || '';
      return {
        reply: `${tone}根据您的音乐偏好，您喜欢${artists ? `「${artists}」` : '的音乐'}。${songs ? `为您推荐：${songs}。` : ''}正在为您播放，享受旅途吧！`,
        matched,
      };
    }
    return { reply: `${tone}正在为您播放推荐音乐，如果有特别想听的歌手或歌曲，告诉我就好。`, matched };
  }

  // ---------- 天气 ----------
  if (message.includes('天气')) {
    return {
      reply: `${tone}今天天气晴朗，温度 22°C，空气质量良好，非常适合出行。您需要我调整空调温度吗？`,
      matched,
    };
  }

  // ---------- 导航：基于事件 ----------
  if (message.includes('导航') || message.includes('去') || message.includes('路线')) {
    // 场景 13：基于事件的导航（"上周和老婆去过的超市"）
    if ((message.includes('上周') || message.includes('上次') || message.includes('之前')) &&
        (message.includes('超市') || message.includes('餐厅') || message.includes('去过'))) {
      const personHint = message.includes('老婆') || message.includes('李芳') ? 'lifang'
        : message.includes('女儿') || message.includes('小萌') ? 'xiaomeng' : '';
      const placeHint = message.includes('超市') ? '购物' : message.includes('餐厅') || message.includes('吃') ? '聚餐' : '';
      const found = memories.find(m => {
        const matchPerson = personHint ? m.participants.includes(personHint) : true;
        const matchType = placeHint ? m.event_type === placeHint || m.details.includes(placeHint === '购物' ? '超市' : '餐') : true;
        return matchPerson && matchType;
      });
      if (found) {
        matched.push(found);
        return {
          reply: `${tone}我找到了！${found.date} ${found.summary}，地点是「${found.location}」。${found.details} 正在为您导航到${found.location}，预计 20 分钟到达。`,
          matched,
        };
      }
    }

    // 场景 12：基于习惯的导航（"导航去上班"）
    if (message.includes('上班') || message.includes('公司')) {
      const workAddr = prefs.find(p => p.key === '上班地址' || p.key === '公司地址');
      if (workAddr) {
        return {
          reply: `${tone}好的，正在为您导航到「${workAddr.value}」。根据实时路况，推荐走滨海大道，预计 25 分钟到达。`,
          matched,
        };
      }
    }

    // 导航到奶奶家
    if (message.includes('奶奶') || message.includes('妈妈家') || message.includes('母亲')) {
      const grandmaMemory = memories.find(m => m.location?.includes('翠苑'));
      if (grandmaMemory) matched.push(grandmaMemory);
      const grandmaRel = rels.find(r => r.relationship === '母亲' || r.relationship === '奶奶' || r.person_name.includes('张母'));
      const addr = grandmaRel?.details?.note || '翠苑小区';
      return {
        reply: `${tone}好的，正在为您导航到${grandmaRel?.person_name || '奶奶'}家——「${addr}」。预计 30 分钟到达。${grandmaRel?.details?.health ? `提醒您：${grandmaRel.person_name}${grandmaRel.details.health}，出行时请多关照。` : ''}`,
        matched,
      };
    }

    // 通用导航
    const navPref = prefs.find(p => p.category === '导航');
    return {
      reply: `${tone}好的，正在为您规划路线。${navPref ? `您常去的地点包括「${navPref.value}」。` : ''}请告诉我具体目的地，我来为您导航。`,
      matched,
    };
  }

  // ---------- 日程查询 ----------
  if (message.includes('安排') || message.includes('日程') || message.includes('计划')) {
    const recentMemories = memories.slice(0, 3);
    recentMemories.forEach(m => matched.push(m));
    const schedule = recentMemories.map(m => `• ${m.date} ${m.summary}（${m.location || ''}）`).join('\n');
    return {
      reply: `${tone}根据您最近的活动记录，以下是近期安排：\n${schedule}\n\n需要我帮您添加新的日程吗？`,
      matched,
    };
  }

  // ---------- 妈妈/家人关怀 ----------
  if (message.includes('妈妈') || message.includes('母亲') || message.includes('奶奶')) {
    const momRel = rels.find(r =>
      r.relationship === '母亲' || r.relationship === '奶奶' || r.person_name.includes('张母') || r.person_name.includes('妈妈')
    );
    const momMemory = memories.find(m => m.details.includes('奶奶') || m.details.includes('膝盖') || m.location?.includes('翠苑'));
    if (momMemory) matched.push(momMemory);
    if (momRel) {
      const health = momRel.details?.health || '';
      return {
        reply: `${tone}关于${momRel.person_name}，我记得以下信息：\n• 关系：${momRel.relationship}\n${health ? `• 健康状况：${health}\n` : ''}${momRel.details?.hobby ? `• 爱好：${momRel.details.hobby}\n` : ''}${momRel.details?.note ? `• 备注：${momRel.details.note}\n` : ''}\n${message.includes('注意') || message.includes('出门') ? `建议：${health ? `由于${momRel.person_name}${health}，出行时建议选择平坦路线，避免长时间步行，准备好护膝。` : '多关心长辈的身体状况。'}` : '需要我帮您做些什么吗？'}`,
        matched,
      };
    }
  }

  // ---------- 朋友推荐 ----------
  if (message.includes('朋友') || message.includes('老王') || message.includes('闺蜜') || message.includes('小雨')) {
    const friendName = message.includes('老王') ? '老王' : message.includes('小雨') ? '小雨' : '';
    const friendRel = friendName
      ? rels.find(r => r.person_name === friendName)
      : rels.find(r => r.tags?.includes('朋友'));
    const friendMemory = memories.find(m =>
      m.details.includes(friendRel?.person_name || '') || m.details.includes('钓鱼') || m.details.includes('展览')
    );
    if (friendMemory) matched.push(friendMemory);
    if (friendRel) {
      const hobby = friendRel.details?.hobby || '';
      return {
        reply: `${tone}您的${friendRel.relationship}「${friendRel.person_name}」${hobby ? `最近喜欢${hobby}` : ''}。${message.includes('推荐') || message.includes('出门') ? `根据 TA 的兴趣，我推荐：\n• ${hobby.split('、').map((h: string) => `${h}相关活动`).join('\n• ')}\n要我帮您搜索附近的相关场所吗？` : `${friendRel.details?.note || ''}`}`,
        matched,
      };
    }
  }

  // ---------- 女儿/孩子 ----------
  if (message.includes('女儿') || message.includes('小萌') || message.includes('孩子')) {
    const childRel = rels.find(r => r.relationship === '女儿' || r.person_name === '张小萌');
    const childMemory = memories.find(m => m.participants.includes('xiaomeng'));
    if (childMemory) matched.push(childMemory);
    if (childRel) {
      return {
        reply: `${tone}关于${childRel.person_name}：\n• ${childRel.details?.school || ''}\n• 爱好：${childRel.details?.hobby || ''}\n• 喜欢的食物：${childRel.details?.favorite_food || ''}\n${childMemory ? `\n最近的相关记忆：${childMemory.date} ${childMemory.summary}` : ''}`,
        matched,
      };
    }
  }

  // ---------- 老婆/丈夫 ----------
  if (message.includes('老婆') || message.includes('丈夫') || message.includes('李芳') || message.includes('张明')) {
    const spouseRel = rels.find(r => r.relationship === '妻子' || r.relationship === '丈夫');
    const spouseMemory = memories.find(m =>
      m.participants.includes(spouseRel?.person_name === '李芳' ? 'lifang' : 'zhangming')
    );
    if (spouseMemory) matched.push(spouseMemory);
    if (spouseRel) {
      return {
        reply: `${tone}关于${spouseRel.person_name}：\n• 关系：${spouseRel.relationship}\n• 爱好：${spouseRel.details?.hobby || ''}\n• 音乐偏好：${spouseRel.details?.music || ''}\n${spouseMemory ? `\n最近的相关记忆：${spouseMemory.date} ${spouseMemory.summary}（${spouseMemory.location}）` : ''}`,
        matched,
      };
    }
  }

  // ---------- 画像/了解我 ----------
  if (message.includes('画像') || message.includes('了解') || message.includes('你知道我')) {
    const prefCount = prefs.length;
    const relCount = rels.length;
    const memCount = memories.length;
    return {
      reply: `${tone}我对您的了解如下：\n• 基本信息：${Object.entries(profile?.basic_info || {}).map(([k, v]) => `${k}: ${v}`).join('，')}\n• 已记录 ${prefCount} 项偏好设置\n• 已记录 ${relCount} 位关系人\n• 已保存 ${memCount} 条情景记忆\n\n我会持续学习，为您提供更个性化的服务。`,
      matched,
    };
  }

  // ---------- 记忆系统说明 ----------
  if (message.includes('记忆')) {
    return {
      reply: `${tone}我的记忆系统包含三层架构：\n1. **工作记忆**：当前对话的上下文\n2. **情景记忆**：记录具体事件（目前已为您保存 ${memories.length} 条）\n3. **语义记忆**：存储偏好和知识（目前已记录 ${prefs.length} 项）\n\n这些记忆帮助我更好地理解您的需求，提供个性化服务。`,
      matched,
    };
  }

  // ---------- 默认回复 ----------
  const defaults = [
    `${tone}明白了，我已记录这条信息。有什么我可以帮您的吗？`,
    `${tone}收到！这些信息会帮助我更好地了解您的需求。`,
    `${tone}好的，我理解了。需要我做些什么吗？`,
    `${tone}感谢您的反馈！我会持续学习，为您提供更好的服务。`,
  ];
  return { reply: defaults[Math.floor(Math.random() * defaults.length)], matched };
};

// ================================================================
// 8. 导出 API
// ================================================================
export const mockChatAPI = {
  sendMessage: async (data: ChatRequest): Promise<{ data: ChatResponse }> => {
    await delay(600 + Math.random() * 400);
    const { reply, matched } = generateReply(
      data.message,
      data.user_id,
      data.options?.character_id || 'default',
    );
    return {
      data: {
        reply,
        session_id: data.session_id,
        user_id: data.user_id,
        character_id: data.options?.character_id,
        memories_retrieved: matched.length,
        profile_updated: data.options?.include_profile,
        matched_memories: matched,
      },
    };
  },
};

export const mockMemoryAPI = {
  getStats: async (userId: string): Promise<{ data: MemoryStats }> => {
    await delay(150);
    return { data: getMemoryStats(userId) };
  },
  listEpisodic: async (userId: string, _page = 1, _pageSize = 20) => {
    await delay(200);
    const items = getMemoriesForUser(userId);
    return { data: { items, total: items.length, page: 1, page_size: 20 } };
  },
  listSemantic: async (userId: string, _page = 1, _pageSize = 20) => {
    await delay(200);
    const prefs = userProfiles[userId]?.preferences || [];
    return { data: { items: prefs, total: prefs.length, page: 1, page_size: 20 } };
  },
};

export const mockProfileAPI = {
  getProfile: async (userId: string): Promise<{ data: UserProfile }> => {
    await delay(150);
    const profile = userProfiles[userId] || {
      user_id: userId, basic_info: {}, preferences: [], relationships: [], updated_at: new Date().toISOString(),
    };
    return { data: { ...profile } };
  },
  updateProfile: async (userId: string, data: Partial<UserProfile>): Promise<{ data: UserProfile }> => {
    await delay(200);
    if (userProfiles[userId]) {
      userProfiles[userId] = { ...userProfiles[userId], ...data, updated_at: new Date().toISOString() };
    }
    return { data: userProfiles[userId] };
  },
};

export const mockCharacterAPI = {
  listCharacters: async (): Promise<{ data: Character[] }> => {
    await delay(100);
    return { data: mockCharacters };
  },
  getCharacter: async (characterId: string): Promise<{ data: Character }> => {
    await delay(100);
    const c = mockCharacters.find(ch => ch.id === characterId);
    if (!c) throw new Error('Character not found');
    return { data: c };
  },
};

export const mockUserRoleAPI = {
  listRoles: async (): Promise<{ data: UserRole[] }> => {
    await delay(100);
    return { data: userRoles };
  },
};
