"""
SmartAgent2 用户画像数据模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import SmartAgent2BaseModel, generate_id


class UserPreference(SmartAgent2BaseModel):
    """用户偏好"""
    id: str = Field(default_factory=lambda: generate_id("pref_"))
    category: str = Field(..., description="偏好分类")
    key: str = Field(..., description="偏好键名")
    value: Any = Field(..., description="偏好值")
    context: Optional[str] = Field(default=None, description="场景绑定标签")
    priority: int = Field(default=0, ge=0, description="优先级")
    is_active: bool = Field(default=True, description="是否启用")
    source: str = Field(default="user_edit", description="来源")
    updated_at: datetime = Field(default_factory=datetime.now)


class PersonRelationship(SmartAgent2BaseModel):
    """人际关系"""
    person_name: str = Field(..., min_length=1, description="人物名称")
    relationship: str = Field(..., description="关系类型")
    aliases: list[str] = Field(default_factory=list, description="别名列表")
    attributes: dict[str, Any] = Field(default_factory=dict, description="人物属性")


class InterestTag(SmartAgent2BaseModel):
    """兴趣标签"""
    tag: str = Field(..., min_length=1, description="兴趣标签")
    weight: float = Field(default=0.5, ge=0.0, le=1.0, description="兴趣权重")
    source: str = Field(default="auto_extract", description="来源")


class HabitPattern(SmartAgent2BaseModel):
    """习惯行为模式"""
    id: str = Field(default_factory=lambda: generate_id("habit_"))
    action: str = Field(..., min_length=1, description="行为描述")
    pattern: str = Field(..., min_length=1, description="行为模式描述")
    associated_preferences: list[str] = Field(default_factory=list, description="关联偏好ID")
    frequency: int = Field(default=0, ge=0, description="触发频率")
    last_triggered_at: Optional[datetime] = Field(default=None, description="最后触发时间")
    is_active: bool = Field(default=True, description="是否启用")


class UserProfile(SmartAgent2BaseModel):
    """用户画像"""
    user_id: str = Field(..., description="用户ID")
    basic_info: dict[str, Any] = Field(default_factory=dict, description="基本信息")
    preferences: list[UserPreference] = Field(default_factory=list, description="偏好列表")
    relationships: list[PersonRelationship] = Field(default_factory=list, description="关系列表")
    interests: list[InterestTag] = Field(default_factory=list, description="兴趣列表")
    habits: list[HabitPattern] = Field(default_factory=list, description="习惯列表")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class ContextualProfileSnapshot(SmartAgent2BaseModel):
    """上下文化画像快照"""
    user_id: str = Field(..., description="用户ID")
    display_name: str = Field(default="", description="用户称呼")
    active_preferences: list[UserPreference] = Field(default_factory=list, description="当前场景生效偏好")
    relevant_relationships: list[PersonRelationship] = Field(default_factory=list, description="相关人际关系")
    active_habits: list[HabitPattern] = Field(default_factory=list, description="可能触发的习惯")
    context: str = Field(default="", description="场景描述")
