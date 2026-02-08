"""
SmartAgent2 人格配置数据模型
v2.1.0: 扩展 ElizaOS Characterfile 兼容字段
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import SmartAgent2BaseModel, generate_id


class MessageExample(SmartAgent2BaseModel):
    """对话示例"""
    role: str = Field(..., description="角色: user 或 assistant")
    content: str = Field(..., min_length=1, description="示例内容")


class VoiceConfig(SmartAgent2BaseModel):
    """语音配置"""
    model: str = Field(default="tts-1", description="TTS 模型")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速倍率")
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调倍率")
    voice_id: Optional[str] = Field(default=None, description="音色ID")


class ModelSettings(SmartAgent2BaseModel):
    """模型配置"""
    model: str = Field(default="gpt-4o", description="LLM 模型名称")
    embedding_model: str = Field(default="text-embedding-3-small", description="嵌入模型")
    voice: Optional[VoiceConfig] = Field(default=None, description="语音配置")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0, description="生成温度")
    max_tokens: int = Field(default=2048, ge=1, description="最大 token 数")
    top_p: float = Field(default=1.0, ge=0.0, le=1.0, description="Top-p 采样")


class ProactiveRule(SmartAgent2BaseModel):
    """主动服务规则"""
    trigger: str = Field(..., description="触发条件")
    condition: Optional[str] = Field(default=None, description="附加条件表达式")
    action: str = Field(..., description="执行动作")
    memory_query: Optional[str] = Field(default=None, description="记忆查询语句")
    priority: int = Field(default=0, description="优先级")


class DialogueStyle(SmartAgent2BaseModel):
    """对话风格 (兼容 ElizaOS style 三维度)"""
    all: list[str] = Field(default_factory=list, description="通用风格指令")
    chat: list[str] = Field(default_factory=list, description="文字聊天风格")
    voice: list[str] = Field(default_factory=list, description="语音交互风格")
    post: list[str] = Field(default_factory=list, description="社交媒体/帖子风格 (ElizaOS 兼容)")


class KnowledgeItem(SmartAgent2BaseModel):
    """知识条目"""
    id: str = Field(default_factory=lambda: generate_id("know_"))
    content: str = Field(..., min_length=1, description="知识内容")
    category: str = Field(default="general", description="知识分类")


class VehicleConfig(SmartAgent2BaseModel):
    """车载扩展配置"""
    greeting_templates: list[str] = Field(default_factory=list, description="问候语模板")
    proactive_service_rules: list[ProactiveRule] = Field(default_factory=list, description="主动服务规则")
    scenario_handlers: list[str] = Field(default_factory=list, description="场景处理器列表")


class AgentCharacter(SmartAgent2BaseModel):
    """
    AI 代理人格配置
    v2.1.0: 扩展 ElizaOS Characterfile 兼容字段
    支持从 ElizaOS character.json 直接导入
    """
    id: str = Field(default_factory=lambda: generate_id("char_"))
    name: str = Field(..., min_length=1, description="AI 名称")
    bio: list[str] = Field(default_factory=list, description="传记片段 (支持随机采样)")
    lore: list[str] = Field(default_factory=list, description="背景故事/历史事件片段")
    system: Optional[str] = Field(default=None, description="系统提示词 (ElizaOS 兼容，覆盖默认行为)")
    style: DialogueStyle = Field(default_factory=DialogueStyle, description="对话风格 (all/chat/voice/post)")
    message_examples: list[list[MessageExample]] = Field(default_factory=list, description="对话示例组")
    post_examples: list[str] = Field(default_factory=list, description="帖子/社交媒体示例 (ElizaOS 兼容)")
    adjectives: list[str] = Field(default_factory=list, description="描述性形容词 (可嵌入提示词)")
    topics: list[str] = Field(default_factory=list, description="感兴趣话题领域")
    knowledge: list[KnowledgeItem] = Field(default_factory=list, description="专属知识库")
    clients: list[str] = Field(default_factory=list, description="支持的客户端平台 (ElizaOS 兼容)")
    model_provider: Optional[str] = Field(default=None, description="模型提供商 (ElizaOS 兼容: openai/anthropic/groq)")
    settings: ModelSettings = Field(default_factory=ModelSettings, description="模型参数")
    vehicle_config: Optional[VehicleConfig] = Field(default=None, description="车载扩展配置")
    system_prompt_template: Optional[str] = Field(default=None, description="自定义 Prompt 模板")
    source_format: Optional[str] = Field(default=None, description="来源格式标记: native/elizaos")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
