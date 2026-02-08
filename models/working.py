"""
SmartAgent2 工作记忆数据模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import SmartAgent2BaseModel, ConversationMessage, ExtractedEntity


class ActiveContext(SmartAgent2BaseModel):
    """活跃上下文"""
    current_intent: str = Field(default="", description="当前用户意图")
    entities: list[ExtractedEntity] = Field(default_factory=list, description="已识别实体列表")
    referenced_memories: list[str] = Field(default_factory=list, description="已引用记忆ID列表")
    turn_count: int = Field(default=0, ge=0, description="对话轮次数")


class WorkingMemory(SmartAgent2BaseModel):
    """工作记忆"""
    session_id: str = Field(..., description="会话标识符")
    user_id: str = Field(..., description="用户ID")
    agent_id: str = Field(default="default", description="AI 代理ID")
    messages: list[ConversationMessage] = Field(default_factory=list, description="消息队列")
    active_context: ActiveContext = Field(default_factory=ActiveContext, description="活跃上下文")
    created_at: datetime = Field(default_factory=datetime.now)
    expires_at: Optional[datetime] = Field(default=None, description="过期时间")
    metadata: dict[str, Any] = Field(default_factory=dict)
