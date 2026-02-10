/**
 * 主动服务 (Proactive Service) 模块
 * 
 * 核心功能：
 * 1. 基于规则的主动触发：根据预定义的触发规则（时间、场景、事件）主动发起服务
 * 2. 基于记忆的智能推荐：分析用户历史行为模式，预判需求并主动提供建议
 * 3. 场景感知：根据当前时间、天气、位置等上下文信息触发相应服务
 * 4. 人格化主动服务：不同 AI 人格以不同风格提供主动服务
 * 
 * 设计参考：
 * - 架构设计文档中的 ProactiveRule: trigger/condition/action/memoryQuery
 * - 人格配置中的 proactive_rules 和 scenario_handlers
 */

import { getUserProfile, getEpisodicMemories } from './storage';
import { getCharacterConfig } from './characters';

// ========== 类型定义 ==========

/** 触发条件类型 */
export type TriggerType = 
  | 'time_based'       // 基于时间（如每天早上 8:00）
  | 'event_based'      // 基于事件（如上车、到达目的地）
  | 'pattern_based'    // 基于行为模式（如每周五下午去超市）
  | 'context_based'    // 基于上下文（如天气变化、节日）
  | 'memory_based';    // 基于记忆（如纪念日提醒）

/** 主动服务规则 */
export interface ProactiveRule {
  id: string;
  name: string;
  description: string;
  trigger: TriggerType;
  /** 触发条件（JSON 表达式） */
  conditions: RuleCondition[];
  /** 触发后的动作模板 */
  action_template: string;
  /** 需要查询的记忆类型 */
  memory_query?: {
    event_types?: string[];
    keywords?: string[];
    time_range_days?: number;
  };
  /** 优先级 (1-10, 10 最高) */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
  /** 冷却时间（秒），避免重复触发 */
  cooldown_seconds: number;
}

/** 规则条件 */
export interface RuleCondition {
  field: string;       // 检查的字段（如 'time.hour', 'weather.temp', 'event.type'）
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in' | 'between';
  value: any;
}

/** 场景上下文 */
export interface SceneContext {
  time: {
    hour: number;
    minute: number;
    day_of_week: number;  // 0=周日, 1=周一, ..., 6=周六
    date: string;         // YYYY-MM-DD
    is_weekend: boolean;
    is_holiday: boolean;
  };
  weather?: {
    temp: number;
    humidity: number;
    condition: string;    // 晴/阴/雨/雪
    aqi: number;
  };
  location?: {
    type: string;         // home/office/driving/unknown
    name?: string;
  };
  event?: {
    type: string;         // boarding/arriving/parking
    data?: any;
  };
  vehicle?: {
    fuel_level?: number;  // 0-100
    mileage?: number;
    engine_status?: string;
  };
}

/** 主动服务结果 */
export interface ProactiveServiceResult {
  triggered: boolean;
  rule_id?: string;
  rule_name?: string;
  message?: string;
  priority?: number;
  related_memories?: any[];
  suggestions?: string[];
}

// ========== 预定义规则集 ==========

const defaultRules: ProactiveRule[] = [
  // ---- 时间触发规则 ----
  {
    id: 'morning_greeting',
    name: '早间问候',
    description: '每天早上 7:00-9:00 上车时提供早间问候和通勤建议',
    trigger: 'time_based',
    conditions: [
      { field: 'time.hour', operator: 'gte', value: 7 },
      { field: 'time.hour', operator: 'lt', value: 9 },
    ],
    action_template: '早间问候：根据用户偏好和今日天气，提供通勤路线建议、音乐推荐和环境调节',
    memory_query: { event_types: ['通勤'], time_range_days: 7 },
    priority: 8,
    enabled: true,
    cooldown_seconds: 3600 * 4, // 4 小时冷却
  },
  {
    id: 'evening_commute',
    name: '晚间通勤',
    description: '每天下午 17:00-19:00 提供回家路线和家庭提醒',
    trigger: 'time_based',
    conditions: [
      { field: 'time.hour', operator: 'gte', value: 17 },
      { field: 'time.hour', operator: 'lt', value: 19 },
    ],
    action_template: '晚间通勤：提供回家路线建议，提醒家庭相关事项（如接孩子、买菜等）',
    memory_query: { event_types: ['通勤', '家庭', '购物'], time_range_days: 7 },
    priority: 7,
    enabled: true,
    cooldown_seconds: 3600 * 4,
  },

  // ---- 事件触发规则 ----
  {
    id: 'boarding_setup',
    name: '上车场景',
    description: '用户上车时自动调整车内环境',
    trigger: 'event_based',
    conditions: [
      { field: 'event.type', operator: 'eq', value: 'boarding' },
    ],
    action_template: '上车场景：根据用户偏好自动调整空调、座椅、音乐，并提供今日行程建议',
    memory_query: { event_types: ['通勤', '出行'], time_range_days: 3 },
    priority: 9,
    enabled: true,
    cooldown_seconds: 1800, // 30 分钟冷却
  },
  {
    id: 'arrival_notification',
    name: '到达提醒',
    description: '到达目的地时提供相关提醒',
    trigger: 'event_based',
    conditions: [
      { field: 'event.type', operator: 'eq', value: 'arriving' },
    ],
    action_template: '到达提醒：提醒用户到达目的地，提供停车建议和相关注意事项',
    priority: 7,
    enabled: true,
    cooldown_seconds: 600,
  },

  // ---- 行为模式触发规则 ----
  {
    id: 'weekend_shopping',
    name: '周末购物提醒',
    description: '周末时根据历史购物习惯提醒采购',
    trigger: 'pattern_based',
    conditions: [
      { field: 'time.is_weekend', operator: 'eq', value: true },
      { field: 'time.hour', operator: 'gte', value: 9 },
      { field: 'time.hour', operator: 'lt', value: 12 },
    ],
    action_template: '周末购物提醒：根据历史购物记录，提醒用户是否需要去超市采购',
    memory_query: { event_types: ['购物'], time_range_days: 14 },
    priority: 5,
    enabled: true,
    cooldown_seconds: 3600 * 24, // 24 小时冷却
  },
  {
    id: 'regular_visit',
    name: '定期探望提醒',
    description: '根据探亲记忆模式提醒用户探望家人',
    trigger: 'pattern_based',
    conditions: [
      { field: 'time.is_weekend', operator: 'eq', value: true },
    ],
    action_template: '探望提醒：根据上次探望时间，温馨提醒用户是否要去看望家人',
    memory_query: { event_types: ['探亲'], time_range_days: 30 },
    priority: 6,
    enabled: true,
    cooldown_seconds: 3600 * 24 * 3, // 3 天冷却
  },

  // ---- 上下文触发规则 ----
  {
    id: 'weather_alert',
    name: '天气变化提醒',
    description: '天气异常时主动提醒用户',
    trigger: 'context_based',
    conditions: [
      { field: 'weather.condition', operator: 'in', value: ['雨', '雪', '大风'] },
    ],
    action_template: '天气提醒：提醒用户注意天气变化，建议调整出行计划或携带雨具',
    priority: 8,
    enabled: true,
    cooldown_seconds: 3600 * 6, // 6 小时冷却
  },
  {
    id: 'air_quality_alert',
    name: '空气质量提醒',
    description: '空气质量差时提醒关闭车窗、开启内循环',
    trigger: 'context_based',
    conditions: [
      { field: 'weather.aqi', operator: 'gt', value: 150 },
    ],
    action_template: '空气质量提醒：AQI 超标，建议关闭车窗、开启空调内循环模式',
    priority: 9,
    enabled: true,
    cooldown_seconds: 3600 * 4,
  },

  // ---- 记忆触发规则 ----
  {
    id: 'anniversary_reminder',
    name: '纪念日提醒',
    description: '根据记忆中的重要日期提醒用户',
    trigger: 'memory_based',
    conditions: [],
    action_template: '纪念日提醒：提醒用户今天是重要的纪念日，建议准备礼物或安排庆祝活动',
    memory_query: { keywords: ['生日', '纪念日', '周年'], time_range_days: 365 },
    priority: 9,
    enabled: true,
    cooldown_seconds: 3600 * 24,
  },
  {
    id: 'maintenance_reminder',
    name: '保养提醒',
    description: '根据里程或时间提醒车辆保养',
    trigger: 'context_based',
    conditions: [
      { field: 'vehicle.mileage', operator: 'gte', value: 5000 },
    ],
    action_template: '保养提醒：车辆行驶里程已达到保养标准，建议预约保养服务',
    priority: 7,
    enabled: true,
    cooldown_seconds: 3600 * 24 * 7, // 7 天冷却
  },
];

// ========== 冷却时间管理 ==========

/** 记录每条规则的上次触发时间 */
const cooldownMap: Map<string, number> = new Map();

function isCoolingDown(ruleId: string, cooldownSeconds: number): boolean {
  const lastTriggered = cooldownMap.get(ruleId);
  if (!lastTriggered) return false;
  return (Date.now() - lastTriggered) < cooldownSeconds * 1000;
}

function recordTrigger(ruleId: string): void {
  cooldownMap.set(ruleId, Date.now());
}

// ========== 条件评估引擎 ==========

/**
 * 评估单个条件是否满足
 */
function evaluateCondition(condition: RuleCondition, context: SceneContext): boolean {
  const value = getNestedValue(context, condition.field);
  if (value === undefined || value === null) return false;

  switch (condition.operator) {
    case 'eq': return value === condition.value;
    case 'neq': return value !== condition.value;
    case 'gt': return value > condition.value;
    case 'lt': return value < condition.value;
    case 'gte': return value >= condition.value;
    case 'lte': return value <= condition.value;
    case 'contains': return String(value).includes(String(condition.value));
    case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
    case 'between': 
      return Array.isArray(condition.value) && condition.value.length === 2 
        && value >= condition.value[0] && value <= condition.value[1];
    default: return false;
  }
}

/**
 * 获取嵌套对象的值（支持 'time.hour' 这样的路径）
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * 评估所有条件（AND 逻辑）
 */
function evaluateAllConditions(conditions: RuleCondition[], context: SceneContext): boolean {
  if (conditions.length === 0) return true; // 无条件则默认通过
  return conditions.every(c => evaluateCondition(c, context));
}

// ========== 记忆查询 ==========

/**
 * 根据规则的 memory_query 配置查询相关记忆
 */
async function queryRelatedMemories(
  userId: string, 
  memoryQuery?: ProactiveRule['memory_query']
): Promise<any[]> {
  if (!memoryQuery) return [];

  const allMemories = await getEpisodicMemories(userId, 50);
  let filtered = allMemories;

  // 按事件类型过滤
  if (memoryQuery.event_types && memoryQuery.event_types.length > 0) {
    filtered = filtered.filter(m => 
      memoryQuery.event_types!.some(t => 
        m.event_type.includes(t) || m.summary.includes(t)
      )
    );
  }

  // 按关键词过滤
  if (memoryQuery.keywords && memoryQuery.keywords.length > 0) {
    filtered = filtered.filter(m =>
      memoryQuery.keywords!.some(k =>
        m.summary.includes(k) || m.details.includes(k)
      )
    );
  }

  // 按时间范围过滤
  if (memoryQuery.time_range_days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - memoryQuery.time_range_days);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    filtered = filtered.filter(m => m.date >= cutoffStr);
  }

  return filtered.slice(0, 5); // 最多返回 5 条
}

// ========== 主动服务消息生成 ==========

/**
 * 根据人格风格生成主动服务消息
 */
function generateProactiveMessage(
  rule: ProactiveRule,
  characterId: string,
  profile: any,
  memories: any[],
  context: SceneContext
): string {
  const character = getCharacterConfig(characterId);
  const userName = profile?.basic_info?.name || '您';

  // 根据规则类型和人格风格生成消息
  switch (rule.id) {
    case 'morning_greeting':
      return generateMorningGreeting(character, userName, profile, memories, context);
    case 'evening_commute':
      return generateEveningCommute(character, userName, profile, memories, context);
    case 'boarding_setup':
      return generateBoardingSetup(character, userName, profile, memories, context);
    case 'arrival_notification':
      return generateArrivalNotification(character, userName, context);
    case 'weekend_shopping':
      return generateWeekendShopping(character, userName, memories);
    case 'regular_visit':
      return generateRegularVisit(character, userName, memories, profile);
    case 'weather_alert':
      return generateWeatherAlert(character, userName, context);
    case 'air_quality_alert':
      return generateAirQualityAlert(character, userName, context);
    case 'anniversary_reminder':
      return generateAnniversaryReminder(character, userName, memories);
    case 'maintenance_reminder':
      return generateMaintenanceReminder(character, userName, context);
    default:
      return `${userName}，有一条提醒给您：${rule.description}`;
  }
}

// ---- 各场景消息生成器 ----

function generateMorningGreeting(character: any, userName: string, profile: any, memories: any[], context: SceneContext): string {
  const hour = context.time.hour;
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayName = dayNames[context.time.day_of_week];

  if (character.id === 'jarvis') {
    let msg = `早安，${userName}。今天${dayName}，`;
    if (context.weather) {
      msg += `当前气温${context.weather.temp}°C，${context.weather.condition}。`;
    }
    if (memories.length > 0) {
      msg += `检测到您近期通勤路线为${memories[0].location || '常规路线'}，正在分析实时路况。`;
    }
    msg += '已根据偏好预设车内环境。';
    return msg;
  } else if (character.id === 'alfred') {
    let msg = `${userName}，早上好。新的一天开始了，`;
    if (context.weather) {
      msg += `今天天气${context.weather.condition}，气温${context.weather.temp}°C，`;
      if (context.weather.temp < 15) {
        msg += '天气偏凉，出门记得添件外套。';
      } else if (context.weather.temp > 30) {
        msg += '天气较热，车内已为您提前降温。';
      } else {
        msg += '是个舒适的好天气。';
      }
    }
    msg += '已为您准备好一切，祝您今天一切顺利。';
    return msg;
  } else {
    let msg = `早上好，${userName}！今天${dayName}，`;
    if (context.weather) {
      msg += `天气${context.weather.condition}，${context.weather.temp}°C。`;
    }
    msg += '车内环境已为您调好，准备出发吧！';
    return msg;
  }
}

function generateEveningCommute(character: any, userName: string, profile: any, memories: any[], context: SceneContext): string {
  if (character.id === 'jarvis') {
    let msg = `${userName}，检测到下班时段。`;
    msg += '已规划回家路线，正在分析晚高峰路况。';
    if (memories.some(m => m.event_type === '购物')) {
      msg += '提示：根据历史记录，您可能需要顺路采购。';
    }
    return msg;
  } else if (character.id === 'alfred') {
    let msg = `${userName}，辛苦了一天。已为您规划回家的路线，`;
    msg += '希望您能顺利到家，享受一个温馨的晚上。';
    if (memories.some(m => m.summary.includes('孩子') || m.summary.includes('女儿'))) {
      msg += '小萌可能在等您回家呢。';
    }
    return msg;
  } else {
    return `${userName}，下班了！已为您规划回家路线，路上注意安全哦。`;
  }
}

function generateBoardingSetup(character: any, userName: string, profile: any, memories: any[], context: SceneContext): string {
  const prefs = profile?.preferences || [];
  const tempPref = prefs.find((p: any) => p.category === '空调' && p.key === '温度');
  const musicPref = prefs.find((p: any) => p.category === '音乐' && p.key === '通勤音乐偏好');
  const seatPref = prefs.find((p: any) => p.category === '座椅' && p.key === '座椅加热');

  if (character.id === 'jarvis') {
    let msg = `欢迎回来，${userName}。系统已就绪：`;
    const settings: string[] = [];
    if (tempPref) settings.push(`空调 ${tempPref.value}`);
    if (seatPref) settings.push(`座椅加热 ${seatPref.value}`);
    if (musicPref) settings.push(`音乐 ${musicPref.value}`);
    if (settings.length > 0) msg += settings.join('，') + '。';
    msg += '请指示目的地。';
    return msg;
  } else if (character.id === 'alfred') {
    let msg = `${userName}，欢迎上车。已为您准备好一切：`;
    if (tempPref) msg += `空调已调至您习惯的${tempPref.value}，`;
    if (seatPref) msg += `座椅加热已开到${seatPref.value}，`;
    if (musicPref) msg += `正在为您播放${musicPref.value}的音乐。`;
    msg += '请问今天要去哪里呢？';
    return msg;
  } else {
    let msg = `${userName}，欢迎上车！`;
    if (tempPref) msg += `空调已调到${tempPref.value}，`;
    if (musicPref) msg += `音乐已准备好${musicPref.value}。`;
    msg += '今天想去哪里？';
    return msg;
  }
}

function generateArrivalNotification(character: any, userName: string, context: SceneContext): string {
  const locationName = context.location?.name || '目的地';
  if (character.id === 'jarvis') {
    return `已到达${locationName}。导航结束，请注意安全下车。`;
  } else if (character.id === 'alfred') {
    return `${userName}，我们已经到达${locationName}了。请注意随身物品，祝您一切顺利。`;
  } else {
    return `${userName}，到达${locationName}啦！注意带好随身物品哦。`;
  }
}

function generateWeekendShopping(character: any, userName: string, memories: any[]): string {
  const lastShopping = memories.find(m => m.event_type === '购物');
  const daysSinceLastShopping = lastShopping 
    ? Math.floor((Date.now() - new Date(lastShopping.date).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  if (character.id === 'jarvis') {
    let msg = `${userName}，周末提醒：`;
    if (daysSinceLastShopping > 7) {
      msg += `距上次采购已${daysSinceLastShopping}天，建议安排补给。需要导航到常去的超市吗？`;
    } else {
      msg += `上次采购在${daysSinceLastShopping}天前，库存应该充足。`;
    }
    return msg;
  } else if (character.id === 'alfred') {
    let msg = '';
    if (daysSinceLastShopping > 7) {
      msg = `${userName}，周末好。距离上次采购已经${daysSinceLastShopping}天了，家里的食材可能需要补充了。要不要趁今天去一趟超市？我可以为您规划路线。`;
    } else {
      msg = `${userName}，周末愉快。上次采购还不久，不过如果有需要，随时告诉我。`;
    }
    return msg;
  } else {
    if (daysSinceLastShopping > 7) {
      return `${userName}，周末好！好像有一阵子没去超市了，要不要去采购一下？`;
    }
    return `${userName}，周末愉快！有什么需要帮忙的吗？`;
  }
}

function generateRegularVisit(character: any, userName: string, memories: any[], profile: any): string {
  const lastVisit = memories.find(m => m.event_type === '探亲');
  const daysSinceLastVisit = lastVisit
    ? Math.floor((Date.now() - new Date(lastVisit.date).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  // 查找关系中的长辈
  const elderRelation = profile?.relationships?.find((r: any) => 
    r.tags?.includes('长辈') || r.relationship.includes('母亲') || r.relationship.includes('父亲')
  );
  const elderName = elderRelation?.person_name || '家人';

  if (daysSinceLastVisit < 14) return ''; // 最近探望过，不提醒

  if (character.id === 'jarvis') {
    return `${userName}，数据显示距上次探望${elderName}已${daysSinceLastVisit}天。建议安排探望行程。`;
  } else if (character.id === 'alfred') {
    return `${userName}，距离上次去看望${elderName}已经有${daysSinceLastVisit}天了。老人家一定很想念您，周末不妨抽空去看看？`;
  } else {
    return `${userName}，好久没去看${elderName}了呢，有空的话去看看吧！`;
  }
}

function generateWeatherAlert(character: any, userName: string, context: SceneContext): string {
  const weather = context.weather;
  if (!weather) return '';

  if (character.id === 'jarvis') {
    return `天气预警：当前${weather.condition}，气温${weather.temp}°C。建议调整出行计划，注意行车安全。`;
  } else if (character.id === 'alfred') {
    return `${userName}，外面${weather.condition}了，气温${weather.temp}°C。出行时请多加小心，如果不急的话，或许可以稍等天气好转再出发。`;
  } else {
    return `${userName}，外面${weather.condition}了，出门注意安全哦！`;
  }
}

function generateAirQualityAlert(character: any, userName: string, context: SceneContext): string {
  const aqi = context.weather?.aqi || 0;
  if (character.id === 'jarvis') {
    return `空气质量预警：AQI ${aqi}，已超标。已自动切换空调至内循环模式，建议关闭车窗。`;
  } else if (character.id === 'alfred') {
    return `${userName}，今天空气质量不太好（AQI ${aqi}），已为您开启空调内循环。建议关好车窗，保护好呼吸健康。`;
  } else {
    return `${userName}，空气质量不太好（AQI ${aqi}），已帮您开启内循环，记得关好车窗哦。`;
  }
}

function generateAnniversaryReminder(character: any, userName: string, memories: any[]): string {
  if (memories.length === 0) return '';
  const memory = memories[0];
  if (character.id === 'jarvis') {
    return `${userName}，提醒：今天是一个重要的日子——${memory.summary}。建议提前做好安排。`;
  } else if (character.id === 'alfred') {
    return `${userName}，今天是个特别的日子呢——${memory.summary}。或许可以准备一份小惊喜，让这一天更加难忘。`;
  } else {
    return `${userName}，今天是个特别的日子——${memory.summary}！别忘了哦！`;
  }
}

function generateMaintenanceReminder(character: any, userName: string, context: SceneContext): string {
  const mileage = context.vehicle?.mileage || 0;
  if (character.id === 'jarvis') {
    return `车辆保养提醒：当前里程${mileage}km，已达到保养标准。建议预约最近的4S店进行常规保养。`;
  } else if (character.id === 'alfred') {
    return `${userName}，爱车的里程已经到${mileage}公里了，是时候做一次保养了。需要我帮您查找附近的4S店吗？`;
  } else {
    return `${userName}，车子该保养啦！里程已经${mileage}公里了，记得预约保养哦。`;
  }
}

// ========== 核心 API ==========

/**
 * 获取当前场景上下文
 * 在真实环境中，这些数据来自传感器和外部 API
 * 当前为模拟实现
 */
export function getCurrentContext(overrides?: Partial<SceneContext>): SceneContext {
  const now = new Date();
  const defaultContext: SceneContext = {
    time: {
      hour: now.getHours(),
      minute: now.getMinutes(),
      day_of_week: now.getDay(),
      date: now.toISOString().slice(0, 10),
      is_weekend: now.getDay() === 0 || now.getDay() === 6,
      is_holiday: false,
    },
    weather: {
      temp: 24,
      humidity: 65,
      condition: '晴',
      aqi: 72,
    },
    location: {
      type: 'unknown',
    },
  };

  // 合并覆盖值
  if (overrides) {
    if (overrides.time) defaultContext.time = { ...defaultContext.time, ...overrides.time };
    if (overrides.weather) defaultContext.weather = { ...defaultContext.weather, ...overrides.weather };
    if (overrides.location) defaultContext.location = { ...defaultContext.location, ...overrides.location };
    if (overrides.event) defaultContext.event = overrides.event;
    if (overrides.vehicle) defaultContext.vehicle = overrides.vehicle;
  }

  return defaultContext;
}

/**
 * 扫描所有规则，返回当前应触发的主动服务
 */
export async function evaluateProactiveRules(
  userId: string,
  characterId: string = 'default',
  contextOverrides?: Partial<SceneContext>
): Promise<ProactiveServiceResult[]> {
  const context = getCurrentContext(contextOverrides);
  const profile = await getUserProfile(userId);
  const results: ProactiveServiceResult[] = [];

  for (const rule of defaultRules) {
    if (!rule.enabled) continue;
    if (isCoolingDown(rule.id, rule.cooldown_seconds)) continue;

    // 评估条件
    if (!evaluateAllConditions(rule.conditions, context)) continue;

    // 查询相关记忆
    const memories = await queryRelatedMemories(userId, rule.memory_query);

    // 生成主动服务消息
    const message = generateProactiveMessage(rule, characterId, profile, memories, context);
    if (!message) continue;

    // 记录触发
    recordTrigger(rule.id);

    results.push({
      triggered: true,
      rule_id: rule.id,
      rule_name: rule.name,
      message,
      priority: rule.priority,
      related_memories: memories.map(m => ({
        id: m.id,
        date: m.date,
        summary: m.summary,
      })),
      suggestions: [],
    });
  }

  // 按优先级排序
  results.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return results;
}

/**
 * 触发指定场景的主动服务（如上车、到达等事件）
 */
export async function triggerSceneService(
  userId: string,
  characterId: string,
  sceneType: string,
  sceneData?: any
): Promise<ProactiveServiceResult[]> {
  return evaluateProactiveRules(userId, characterId, {
    event: {
      type: sceneType,
      data: sceneData,
    },
  });
}

/**
 * 获取所有规则列表
 */
export function getProactiveRules(): ProactiveRule[] {
  return defaultRules.map(r => ({
    ...r,
    _is_cooling_down: isCoolingDown(r.id, r.cooldown_seconds),
  })) as any;
}

/**
 * 更新规则启用状态
 */
export function updateRuleStatus(ruleId: string, enabled: boolean): boolean {
  const rule = defaultRules.find(r => r.id === ruleId);
  if (!rule) return false;
  rule.enabled = enabled;
  return true;
}

/**
 * 重置规则冷却时间
 */
export function resetRuleCooldown(ruleId: string): boolean {
  if (!cooldownMap.has(ruleId)) return false;
  cooldownMap.delete(ruleId);
  return true;
}

console.log(`[ProactiveService] 主动服务模块已加载，共 ${defaultRules.length} 条规则`);
