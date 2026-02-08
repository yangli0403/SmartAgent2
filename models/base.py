"""
SmartAgent2 基础数据类型与枚举定义
"""
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field
from nanoid import generate as nanoid_generate


def generate_id(prefix: str = "") -> str:
    """生成带前缀的唯一 ID"""
    return f"{prefix}{nanoid_generate(size=12)}"


# ============================================================
# 枚举类型
# ============================================================

class MemoryType(str, Enum):
    WORKING = "working"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROFILE = "profile"


class EpisodicEventType(str, Enum):
    NAVIGATION = "navigation"
    MUSIC_PLAYBACK = "music_playback"
    CLIMATE_CONTROL = "climate_control"
    PHONE_CALL = "phone_call"
    SCHEDULE_MANAGEMENT = "schedule_management"
    VEHICLE_CONTROL = "vehicle_control"
    GENERAL_CONVERSATION = "general_conversation"
    DINING = "dining"
    SHOPPING = "shopping"
    CUSTOM = "custom"


class SemanticCategory(str, Enum):
    PREFERENCE = "preference"
    FACT = "fact"
    RELATIONSHIP = "relationship"
    HABIT = "habit"
    KNOWLEDGE = "knowledge"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ExportFormat(str, Enum):
    JSON = "json"
    CSV = "csv"


# ============================================================
# 基础模型配置
# ============================================================

class SmartAgent2BaseModel(BaseModel):
    """所有数据模型的基类配置"""
    model_config = ConfigDict(
        use_enum_values=True,
        from_attributes=True,
        extra="forbid",
    )

    def to_storage(self) -> dict:
        return self.model_dump(exclude_none=True, exclude={"embedding"})

    def to_api(self) -> dict:
        return self.model_dump(exclude_none=True)

    def to_full(self) -> dict:
        return self.model_dump()


# ============================================================
# 通用基础结构
# ============================================================

class MemoryBase(SmartAgent2BaseModel):
    """记忆基类"""
    id: str = Field(default_factory=lambda: generate_id("mem_"))
    user_id: str = Field(..., description="所属用户ID")
    agent_id: str = Field(default="default", description="关联的 AI 代理ID")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class ConversationMessage(SmartAgent2BaseModel):
    """对话消息"""
    role: MessageRole = Field(..., description="消息角色")
    content: str = Field(..., min_length=1, description="消息内容")
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExtractedEntity(SmartAgent2BaseModel):
    """提取实体"""
    name: str = Field(..., min_length=1, description="实体名称")
    entity_type: str = Field(..., description="实体类型")
    value: Any = Field(default=None, description="实体值")


class ScoredMemory(SmartAgent2BaseModel):
    """带评分的记忆"""
    memory_id: str = Field(..., description="记忆ID")
    memory_type: MemoryType = Field(..., description="记忆类型")
    content: str = Field(..., description="记忆内容摘要")
    score: float = Field(..., ge=0.0, le=1.0, description="相关性评分")
    source: str = Field(default="", description="检索来源")
    raw_data: dict[str, Any] = Field(default_factory=dict)


class VectorSearchResult(SmartAgent2BaseModel):
    """向量检索结果"""
    memory_id: str = Field(..., description="记忆ID")
    score: float = Field(..., ge=0.0, le=1.0, description="余弦相似度")
    metadata: dict[str, Any] = Field(default_factory=dict)
    embedding: Optional[list[float]] = Field(default=None, description="向量")
