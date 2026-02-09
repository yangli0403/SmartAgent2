/**
 * SmartAgent2 主界面 v2
 * 三栏布局：左侧配置（用户角色+AI人格+记忆开关）、中间对话、右侧画像+记忆
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Send, Brain, User, MessageSquare, Settings, BarChart3, Loader2,
  Car, Heart, BookOpen, Users, MapPin, Music, Thermometer, Clock,
} from "lucide-react";
import { type ChatRequest, type Character, type MemoryStats, type UserProfile, type UserRole, type EpisodicMemoryItem } from "@/lib/api";
import {
  mockChatAPI as chatAPI, mockMemoryAPI as memoryAPI,
  mockProfileAPI as profileAPI, mockCharacterAPI as characterAPI,
  mockUserRoleAPI as userRoleAPI, userRoles,
} from "@/lib/mock-api";

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  matchedMemories?: EpisodicMemoryItem[];
}

export default function Home() {
  // 用户角色
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('zhangming');
  const [sessionId, setSessionId] = useState(`sess_${Date.now()}`);

  // 对话
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // AI 人格
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState('default');

  // 记忆开关
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeProfile, setIncludeProfile] = useState(true);

  // 右侧数据
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [episodicMemories, setEpisodicMemories] = useState<EpisodicMemoryItem[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentRole = useMemo(() => roles.find(r => r.id === selectedUserId) || userRoles[0], [roles, selectedUserId]);

  // 初始化
  useEffect(() => {
    (async () => {
      const [charRes, roleRes] = await Promise.all([
        characterAPI.listCharacters(),
        userRoleAPI.listRoles(),
      ]);
      setCharacters(charRes.data);
      setRoles(roleRes.data);
    })();
  }, []);

  // 用户切换时重新加载数据
  useEffect(() => {
    loadUserData();
  }, [selectedUserId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadUserData = async () => {
    try {
      const [statsRes, profileRes, episodicRes] = await Promise.all([
        memoryAPI.getStats(selectedUserId),
        profileAPI.getProfile(selectedUserId),
        memoryAPI.listEpisodic(selectedUserId),
      ]);
      setMemoryStats(statsRes.data);
      setUserProfile(profileRes.data);
      setEpisodicMemories(episodicRes.data.items || []);
    } catch (e) {
      console.error('加载用户数据失败:', e);
    }
  };

  const handleUserSwitch = (newUserId: string) => {
    setSelectedUserId(newUserId);
    setSessionId(`sess_${Date.now()}`);
    setMessages([]);
    const role = userRoles.find(r => r.id === newUserId);
    toast.success(`已切换到用户：${role?.name || newUserId}`);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: inputMessage, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);
    try {
      const request: ChatRequest = {
        user_id: selectedUserId,
        session_id: sessionId,
        message: inputMessage,
        options: { include_memory: includeMemory, include_profile: includeProfile, character_id: selectedCharacter },
      };
      const response = await chatAPI.sendMessage(request);
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.data.reply,
        timestamp: new Date(),
        matchedMemories: response.data.matched_memories,
      };
      setMessages(prev => [...prev, assistantMsg]);
      loadUserData();
    } catch (e: any) {
      console.error('发送消息失败:', e);
      toast.error('发送消息失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 分类偏好
  const groupedPrefs = useMemo(() => {
    const prefs = userProfile?.preferences || [];
    const groups: Record<string, typeof prefs> = {};
    prefs.forEach(p => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    });
    return groups;
  }, [userProfile]);

  const categoryIcons: Record<string, React.ReactNode> = {
    '音乐': <Music className="h-3.5 w-3.5" />,
    '空调': <Thermometer className="h-3.5 w-3.5" />,
    '座椅': <Car className="h-3.5 w-3.5" />,
    '导航': <MapPin className="h-3.5 w-3.5" />,
    '饮食': <Heart className="h-3.5 w-3.5" />,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <header className="border-b border-border bg-card">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">SmartAgent2 车载记忆系统</h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-xs">
              {currentRole?.avatar} {currentRole?.name}
            </Badge>
            <Badge variant="outline" className="text-xs">
              会话: {sessionId.slice(5, 15)}
            </Badge>
          </div>
        </div>
      </header>

      {/* 三栏布局 */}
      <div className="flex" style={{ height: 'calc(100vh - 3.5rem)' }}>

        {/* ========== 左侧：配置面板 ========== */}
        <aside className="w-72 border-r border-border overflow-y-auto p-3 flex-shrink-0 bg-card/50">
          {/* 用户角色选择 */}
          <div className="mb-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5" /> 用户角色
            </label>
            <div className="space-y-1.5">
              {userRoles.map(role => (
                <button
                  key={role.id}
                  onClick={() => handleUserSwitch(role.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                    selectedUserId === role.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:border-primary/30 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{role.avatar}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{role.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{role.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Separator className="my-3" />

          {/* AI 人格选择 */}
          <div className="mb-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Settings className="h-3.5 w-3.5" /> AI 人格
            </label>
            <Select value={selectedCharacter} onValueChange={setSelectedCharacter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="选择人格" />
              </SelectTrigger>
              <SelectContent>
                {characters.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.description?.slice(0, 20)}...</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator className="my-3" />

          {/* 记忆开关 */}
          <div className="mb-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Brain className="h-3.5 w-3.5" /> 记忆功能
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">记忆检索</span>
                <Button variant={includeMemory ? "default" : "outline"} size="sm" className="h-7 text-xs px-2.5"
                  onClick={() => setIncludeMemory(!includeMemory)}>
                  {includeMemory ? '已启用' : '已禁用'}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">画像更新</span>
                <Button variant={includeProfile ? "default" : "outline"} size="sm" className="h-7 text-xs px-2.5"
                  onClick={() => setIncludeProfile(!includeProfile)}>
                  {includeProfile ? '已启用' : '已禁用'}
                </Button>
              </div>
            </div>
          </div>

          <Separator className="my-3" />

          {/* 记忆统计 */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <BarChart3 className="h-3.5 w-3.5" /> 记忆统计
            </label>
            {memoryStats && (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">情景记忆</span>
                  <Badge variant="secondary" className="text-xs h-5">{memoryStats.episodic_count}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">偏好记录</span>
                  <Badge variant="secondary" className="text-xs h-5">{memoryStats.semantic_count}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">总记忆数</span>
                  <Badge className="text-xs h-5">{memoryStats.total_memories}</Badge>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ========== 中间：对话区域 ========== */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* 对话头部 */}
          <div className="border-b border-border px-4 py-2.5 bg-card/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">对话界面</span>
              <span className="text-xs text-muted-foreground">— 以 {currentRole?.name} 的身份与 AI 对话</span>
            </div>
          </div>

          {/* 消息列表 */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground py-16">
                  <Car className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm mb-1">当前用户：<strong>{currentRole?.name}</strong>（{currentRole?.role_in_family}）</p>
                  <p className="text-xs text-muted-foreground mb-4">试试以下对话场景：</p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                    {[
                      '模拟上车',
                      '按照我的习惯调整空调',
                      '放点我喜欢的音乐吧',
                      '导航去上班',
                      '带妈妈出门要注意些什么？',
                      '明天跟朋友出门有什么推荐？',
                      '导航到上次和老婆去过的超市',
                      '你了解我多少？',
                    ].map(hint => (
                      <button
                        key={hint}
                        onClick={() => { setInputMessage(hint); }}
                        className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx}>
                    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-lg px-3.5 py-2.5 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        <div className={`text-[10px] mt-1 ${
                          msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                        }`}>
                          {msg.role === 'user' ? currentRole?.name : characters.find(c => c.id === selectedCharacter)?.name || '小智'}
                          {' · '}
                          {msg.timestamp.toLocaleTimeString('zh-CN')}
                        </div>
                      </div>
                    </div>
                    {/* 匹配到的记忆 */}
                    {msg.matchedMemories && msg.matchedMemories.length > 0 && (
                      <div className="ml-2 mt-1.5 mb-1">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                          <BookOpen className="h-3 w-3" /> 引用了 {msg.matchedMemories.length} 条情景记忆
                        </div>
                        {msg.matchedMemories.map(m => (
                          <div key={m.id} className="text-[10px] bg-primary/5 border border-primary/10 rounded px-2 py-1 mb-0.5 text-muted-foreground">
                            📅 {m.date} · {m.summary} · 📍 {m.location}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* 输入区域 */}
          <div className="border-t border-border p-3 bg-card/30">
            <div className="flex gap-2">
              <Input
                placeholder={`以 ${currentRole?.name} 的身份输入消息...`}
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                className="flex-1 h-10"
              />
              <Button onClick={handleSendMessage} disabled={isLoading || !inputMessage.trim()} size="icon" className="h-10 w-10">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </main>

        {/* ========== 右侧：画像 + 记忆 ========== */}
        <aside className="w-80 border-l border-border overflow-y-auto flex-shrink-0 bg-card/50">
          <Tabs defaultValue="profile" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border h-10">
              <TabsTrigger value="profile" className="text-xs">用户画像</TabsTrigger>
              <TabsTrigger value="memories" className="text-xs">情景记忆</TabsTrigger>
              <TabsTrigger value="relations" className="text-xs">关系网络</TabsTrigger>
            </TabsList>

            {/* 用户画像 Tab */}
            <TabsContent value="profile" className="flex-1 overflow-y-auto p-3 mt-0">
              {userProfile && (
                <div className="space-y-3">
                  {/* 基本信息 */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                      <User className="h-3.5 w-3.5" /> 基本信息
                    </h4>
                    <div className="bg-muted/50 rounded-lg p-2.5 space-y-1">
                      {Object.entries(userProfile.basic_info || {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 偏好设置（按分类） */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5" /> 偏好设置
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(groupedPrefs).map(([category, prefs]) => (
                        <div key={category} className="bg-muted/50 rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            {categoryIcons[category] || <Settings className="h-3.5 w-3.5" />}
                            <span className="text-xs font-medium">{category}</span>
                            <Badge variant="outline" className="text-[10px] h-4 ml-auto">{prefs.length}</Badge>
                          </div>
                          <div className="space-y-0.5">
                            {prefs.map(p => (
                              <div key={p.id} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{p.key}</span>
                                <span className="font-medium text-right max-w-[55%] truncate" title={p.value}>{p.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* 情景记忆 Tab */}
            <TabsContent value="memories" className="flex-1 overflow-y-auto p-3 mt-0">
              <div className="space-y-2">
                {episodicMemories.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">暂无情景记忆</p>
                ) : (
                  episodicMemories.map(m => (
                    <div key={m.id} className="bg-muted/50 rounded-lg p-2.5 border border-border/50">
                      <div className="flex items-start justify-between mb-1">
                        <Badge variant="outline" className="text-[10px] h-4">{m.event_type}</Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-3 w-3" /> {m.date}
                        </span>
                      </div>
                      <div className="text-xs font-medium mb-1">{m.summary}</div>
                      {m.location && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-0.5 mb-1">
                          <MapPin className="h-3 w-3" /> {m.location}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground leading-relaxed">{m.details}</div>
                      <div className="flex items-center gap-1 mt-1.5">
                        {m.participants.map(pid => {
                          const role = userRoles.find(r => r.id === pid);
                          return role ? (
                            <Badge key={pid} variant="secondary" className="text-[10px] h-4">
                              {role.avatar} {role.name}
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            {/* 关系网络 Tab */}
            <TabsContent value="relations" className="flex-1 overflow-y-auto p-3 mt-0">
              <div className="space-y-2">
                {(userProfile?.relationships || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">暂无关系数据</p>
                ) : (
                  (userProfile?.relationships || []).map((rel, idx) => (
                    <div key={idx} className="bg-muted/50 rounded-lg p-2.5 border border-border/50">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">{rel.person_name}</span>
                        <Badge variant="outline" className="text-[10px] h-4">{rel.relationship}</Badge>
                      </div>
                      <div className="space-y-0.5">
                        {Object.entries(rel.details || {}).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-medium text-right max-w-[60%]">{v}</span>
                          </div>
                        ))}
                      </div>
                      {rel.tags && rel.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {rel.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-[10px] h-4">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
