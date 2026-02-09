/**
 * SmartAgent2 主界面
 * 功能主义设计 - 三栏布局:左侧配置、中间对话、右侧统计
 */
import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, Brain, User, MessageSquare, Settings, BarChart3, Loader2 } from "lucide-react";
import { type ChatRequest, type Character, type MemoryStats, type UserProfile } from "@/lib/api";
import { mockChatAPI as chatAPI, mockMemoryAPI as memoryAPI, mockProfileAPI as profileAPI, mockCharacterAPI as characterAPI } from "@/lib/mock-api";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function Home() {
  // 状态管理
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userId] = useState('user_001');
  const [sessionId] = useState(`sess_${Date.now()}`);
  
  // 配置状态
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState('default');
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeProfile, setIncludeProfile] = useState(true);
  
  // 统计状态
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载人格列表
  useEffect(() => {
    loadCharacters();
    loadMemoryStats();
    loadUserProfile();
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadCharacters = async () => {
    try {
      const response = await characterAPI.listCharacters();
      setCharacters(response.data);
    } catch (error) {
      console.error('加载人格列表失败:', error);
      toast.error('加载人格列表失败');
    }
  };

  const loadMemoryStats = async () => {
    try {
      const response = await memoryAPI.getStats(userId);
      setMemoryStats(response.data);
    } catch (error) {
      console.error('加载记忆统计失败:', error);
    }
  };

  const loadUserProfile = async () => {
    try {
      const response = await profileAPI.getProfile(userId);
      setUserProfile(response.data);
    } catch (error) {
      console.error('加载用户画像失败:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const request: ChatRequest = {
        user_id: userId,
        session_id: sessionId,
        message: inputMessage,
        options: {
          include_memory: includeMemory,
          include_profile: includeProfile,
          character_id: selectedCharacter,
        },
      };

      const response = await chatAPI.sendMessage(request);
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data.reply,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // 更新统计信息
      if (response.data.memories_retrieved) {
        loadMemoryStats();
      }
      if (response.data.profile_updated) {
        loadUserProfile();
      }
    } catch (error: any) {
      console.error('发送消息失败:', error);
      toast.error('发送消息失败,请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <header className="border-b border-border bg-card">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">SmartAgent2 记忆系统</h1>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline">用户: {userId}</Badge>
            <Badge variant="outline">会话: {sessionId.slice(0, 12)}...</Badge>
          </div>
        </div>
      </header>

      {/* 主内容区 - 三栏布局 */}
      <div className="container flex gap-4 py-4" style={{ maxWidth: '100%' }}>
        {/* 左侧边栏 - 配置面板 */}
        <aside className="w-80 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                记忆配置
              </CardTitle>
              <CardDescription>配置对话行为和记忆功能</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 人格选择 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">AI 人格</label>
                <Select value={selectedCharacter} onValueChange={setSelectedCharacter}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择人格" />
                  </SelectTrigger>
                  <SelectContent>
                    {characters.map(char => (
                      <SelectItem key={char.id} value={char.id}>
                        {char.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* 记忆开关 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">记忆功能</label>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">启用记忆检索</span>
                  <Button
                    variant={includeMemory ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIncludeMemory(!includeMemory)}
                  >
                    {includeMemory ? '已启用' : '已禁用'}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">启用画像更新</span>
                  <Button
                    variant={includeProfile ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIncludeProfile(!includeProfile)}
                  >
                    {includeProfile ? '已启用' : '已禁用'}
                  </Button>
                </div>
              </div>

              <Separator />

              {/* 用户画像预览 */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  用户画像
                </label>
                {userProfile ? (
                  <div className="text-xs space-y-1 p-3 bg-muted rounded-md">
                    <div><strong>基本信息:</strong> {Object.keys(userProfile.basic_info || {}).length} 项</div>
                    <div><strong>偏好设置:</strong> {Object.keys(userProfile.preferences || {}).length} 项</div>
                    <div><strong>关系网络:</strong> {Object.keys(userProfile.relationships || {}).length} 项</div>
                    {userProfile.updated_at && (
                      <div className="text-muted-foreground">
                        更新时间: {new Date(userProfile.updated_at).toLocaleString('zh-CN')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground p-3 bg-muted rounded-md">
                    暂无画像数据
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* 中间主区域 - 对话界面 */}
        <main className="flex-1 min-w-0">
          <Card className="h-[calc(100vh-8rem)] flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                对话界面
              </CardTitle>
              <CardDescription>与 AI 助手进行对话交互</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0">
              {/* 消息列表 */}
              <ScrollArea className="flex-1 px-6">
                <div className="space-y-4 py-4">
                  {messages.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>开始对话,体验智能记忆系统</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground'
                          }`}
                        >
                          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                          <div className={`text-xs mt-1 ${
                            msg.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}>
                            {msg.timestamp.toLocaleTimeString('zh-CN')}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* 输入区域 */}
              <div className="border-t border-border p-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="输入消息..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={isLoading || !inputMessage.trim()}
                    size="icon"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>

        {/* 右侧边栏 - 统计信息 */}
        <aside className="w-80 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                记忆统计
              </CardTitle>
              <CardDescription>查看记忆系统运行状态</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="stats">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="stats">统计</TabsTrigger>
                  <TabsTrigger value="info">说明</TabsTrigger>
                </TabsList>
                
                <TabsContent value="stats" className="space-y-4 mt-4">
                  {memoryStats ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">情景记忆</span>
                          <Badge variant="secondary">{memoryStats.episodic_count}</Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">语义记忆</span>
                          <Badge variant="secondary">{memoryStats.semantic_count}</Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">总记忆数</span>
                          <Badge>{memoryStats.total_memories}</Badge>
                        </div>
                      </div>
                      
                      <Separator />
                      
                      <div className="space-y-2 text-xs">
                        {memoryStats.oldest_memory && (
                          <div>
                            <span className="text-muted-foreground">最早记忆:</span>
                            <div className="mt-1">{new Date(memoryStats.oldest_memory).toLocaleString('zh-CN')}</div>
                          </div>
                        )}
                        {memoryStats.newest_memory && (
                          <div>
                            <span className="text-muted-foreground">最新记忆:</span>
                            <div className="mt-1">{new Date(memoryStats.newest_memory).toLocaleString('zh-CN')}</div>
                          </div>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          loadMemoryStats();
                          loadUserProfile();
                          toast.success('已刷新统计数据');
                        }}
                      >
                        刷新统计
                      </Button>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      <p className="text-sm">暂无统计数据</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={loadMemoryStats}
                      >
                        加载统计
                      </Button>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="info" className="space-y-3 mt-4 text-sm">
                  <div>
                    <h4 className="font-medium mb-1">记忆系统</h4>
                    <p className="text-muted-foreground text-xs">
                      SmartAgent2 实现了多层次记忆架构,包括工作记忆、情景记忆和语义记忆。
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1">情景记忆</h4>
                    <p className="text-muted-foreground text-xs">
                      记录具体的对话事件和交互场景,支持时间序列检索。
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1">语义记忆</h4>
                    <p className="text-muted-foreground text-xs">
                      提取和存储抽象知识,支持语义相似度检索。
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1">用户画像</h4>
                    <p className="text-muted-foreground text-xs">
                      自动构建和更新用户偏好、关系网络等个性化信息。
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
