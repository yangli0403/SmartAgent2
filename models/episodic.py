"""
SmartAgent2 情景记忆数据模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import MemoryBase, SmartAgent2BaseModel, EpisodicEventType, generate_id


class TemporalContext(SmartAgent2BaseModel):
    """时间上下文"""
    occurred_at: datetime = Field(..., description="事件发生时间")
    duration_minutes: Optional[int] = Field(default=None, ge=0, description="持续时长（分钟）")
    recurrence: Optional[str] = Field(default=None, description="重复模式")
    time_of_day: Optional[str] = Field(default=None, description="时段标签")


class EpisodicMemory(MemoryBase):
    """情景记忆"""
    id: str = Field(default_factory=lambda: generate_id("mem_ep_"))
    lossless_restatement: str = Field(..., min_length=1, description="无损语义重述")
    summary: str = Field(..., min_length=1, description="一句话摘要")
    keywords: list[str] = Field(default_factory=list, description="关键词列表")
    event_type: str = Field(default=EpisodicEventType.GENERAL_CONVERSATION, description="事件类型")
    participants: list[str] = Field(default_factory=list, description="参与人物")
    location: Optional[str] = Field(default=None, description="地点")
    temporal_context: Optional[TemporalContext] = Field(default=None, description="时间上下文")
    importance: float = Field(default=0.5, ge=0.0, le=1.0, description="重要性评分")
    access_count: int = Field(default=0, ge=0, description="被检索次数")
    last_accessed_at: Optional[datetime] = Field(default=None, description="最后访问时间")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="提取置信度")
    source_session_id: Optional[str] = Field(default=None, description="来源会话ID")
    embedding: Optional[list[float]] = Field(default=None, description="向量嵌入")
    is_archived: bool = Field(default=False, description="是否已归档")
    is_compressed: bool = Field(default=False, description="是否为压缩记忆")
    merged_from: list[str] = Field(default_factory=list, description="合并来源ID列表")
