"""
SmartAgent2 查询与结果数据模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import SmartAgent2BaseModel, ScoredMemory, EpisodicEventType
from .semantic import SemanticMemory
from .profile import ContextualProfileSnapshot


class DateRange(SmartAgent2BaseModel):
    """日期范围"""
    start: datetime = Field(..., description="起始时间")
    end: datetime = Field(..., description="结束时间")


class RetrievalQuery(SmartAgent2BaseModel):
    """检索查询"""
    user_id: str = Field(..., description="用户ID")
    query: str = Field(..., min_length=1, description="查询文本")
    intent: Optional[str] = Field(default=None, description="意图标签")
    top_k: int = Field(default=5, ge=1, le=50, description="返回数量上限")
    include_episodic: bool = Field(default=True, description="是否检索情景记忆")
    include_semantic: bool = Field(default=True, description="是否检索语义记忆")
    include_profile: bool = Field(default=True, description="是否包含画像")
    time_range: Optional[DateRange] = Field(default=None, description="时间范围")
    event_type: Optional[str] = Field(default=None, description="事件类型过滤")
    participants: Optional[list[str]] = Field(default=None, description="参与人物过滤")


class RetrievalResult(SmartAgent2BaseModel):
    """检索结果"""
    episodic_memories: list[ScoredMemory] = Field(default_factory=list, description="情景记忆结果")
    semantic_memories: list[SemanticMemory] = Field(default_factory=list, description="语义记忆结果")
    profile_context: Optional[ContextualProfileSnapshot] = Field(default=None, description="画像快照")
    retrieval_plan: str = Field(default="", description="检索策略说明")
    total_retrieval_time_ms: float = Field(default=0.0, description="检索耗时（毫秒）")


class ForgettingConfig(SmartAgent2BaseModel):
    """遗忘配置"""
    importance_threshold: float = Field(default=0.3, ge=0.0, le=1.0, description="重要性阈值")
    time_decay_factor: float = Field(default=0.95, ge=0.0, le=1.0, description="时间衰减因子")
    access_boost_factor: float = Field(default=0.1, ge=0.0, le=1.0, description="访问强化因子")
    similarity_threshold: float = Field(default=0.85, ge=0.0, le=1.0, description="相似度合并阈值")
    max_memories_per_user: int = Field(default=10000, ge=100, description="最大记忆条数")
    archive_instead_of_delete: bool = Field(default=True, description="归档而非删除")


class ForgettingResult(SmartAgent2BaseModel):
    """遗忘结果"""
    user_id: str = Field(..., description="用户ID")
    total_scanned: int = Field(default=0, description="扫描记忆数")
    memories_compressed: int = Field(default=0, description="压缩合并数")
    memories_archived: int = Field(default=0, description="归档数")
    memories_deleted: int = Field(default=0, description="删除数")
    storage_freed_bytes: int = Field(default=0, description="释放空间")
    execution_time_ms: float = Field(default=0.0, description="执行耗时")
    details: list[str] = Field(default_factory=list, description="详情描述")


class ChatOptions(SmartAgent2BaseModel):
    """对话选项"""
    include_memory: bool = Field(default=True, description="是否使用记忆")
    include_profile: bool = Field(default=True, description="是否使用画像")
    character_id: Optional[str] = Field(default=None, description="人格配置ID")
    max_memory_items: int = Field(default=5, description="最大记忆条目数")


class ChatRequest(SmartAgent2BaseModel):
    """对话请求"""
    user_id: str = Field(..., description="用户ID")
    agent_id: str = Field(default="default", description="AI 代理ID")
    session_id: str = Field(..., description="会话ID")
    message: str = Field(..., min_length=1, description="用户消息")
    options: ChatOptions = Field(default_factory=ChatOptions, description="对话选项")


class ActionItem(SmartAgent2BaseModel):
    """建议动作"""
    type: str = Field(..., description="动作类型")
    description: str = Field(default="", description="动作描述")
    parameters: dict[str, Any] = Field(default_factory=dict, description="动作参数")


class ChatResponse(SmartAgent2BaseModel):
    """对话响应"""
    response: str = Field(..., description="AI 回复文本")
    session_id: str = Field(..., description="会话ID")
    memories_used: int = Field(default=0, description="引用记忆数")
    memory_context: Optional[RetrievalResult] = Field(default=None, description="记忆上下文")
    actions: list[ActionItem] = Field(default_factory=list, description="建议动作列表")
    character_id: Optional[str] = Field(default=None, description="使用的人格ID")


class MemoryFilter(SmartAgent2BaseModel):
    """记忆过滤条件"""
    event_type: Optional[str] = Field(default=None, description="事件类型")
    date_range: Optional[DateRange] = Field(default=None, description="日期范围")
    keywords: Optional[list[str]] = Field(default=None, description="关键词")
    min_importance: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="最低重要性")


class PaginatedResult(SmartAgent2BaseModel):
    """分页结果"""
    items: list[dict[str, Any]] = Field(default_factory=list, description="数据列表")
    total: int = Field(default=0, description="总数")
    page: int = Field(default=1, description="当前页")
    page_size: int = Field(default=20, description="每页数量")
    total_pages: int = Field(default=0, description="总页数")


class KeywordCount(SmartAgent2BaseModel):
    """关键词计数"""
    keyword: str = Field(..., description="关键词")
    count: int = Field(default=0, description="出现次数")


class MemoryStats(SmartAgent2BaseModel):
    """记忆统计"""
    user_id: str = Field(..., description="用户ID")
    total_episodic: int = Field(default=0, description="情景记忆总数")
    total_semantic: int = Field(default=0, description="语义记忆总数")
    total_profile_items: int = Field(default=0, description="画像条目总数")
    active_episodic: int = Field(default=0, description="活跃情景记忆")
    archived_episodic: int = Field(default=0, description="已归档数")
    compressed_episodic: int = Field(default=0, description="压缩记忆数")
    storage_used_bytes: int = Field(default=0, description="存储占用")
    oldest_memory_at: Optional[datetime] = Field(default=None, description="最早记忆时间")
    newest_memory_at: Optional[datetime] = Field(default=None, description="最新记忆时间")
    top_keywords: list[KeywordCount] = Field(default_factory=list, description="高频关键词")
    event_type_distribution: dict[str, int] = Field(default_factory=dict, description="事件类型分布")


class ProfileUpdateResult(SmartAgent2BaseModel):
    """画像更新结果"""
    preferences_added: int = Field(default=0)
    preferences_updated: int = Field(default=0)
    relationships_added: int = Field(default=0)
    relationships_updated: int = Field(default=0)
    habits_detected: int = Field(default=0)
    details: list[str] = Field(default_factory=list)
