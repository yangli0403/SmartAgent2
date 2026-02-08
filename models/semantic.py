"""
SmartAgent2 语义记忆数据模型
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from .base import MemoryBase, SmartAgent2BaseModel, SemanticCategory, generate_id


class SemanticMemory(MemoryBase):
    """语义记忆（知识三元组）"""
    id: str = Field(default_factory=lambda: generate_id("mem_sem_"))
    subject: str = Field(..., min_length=1, description="主体")
    predicate: str = Field(..., min_length=1, description="谓词/关系")
    object: str = Field(..., min_length=1, description="客体")
    category: str = Field(default=SemanticCategory.FACT, description="语义分类")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="知识置信度")
    source: str = Field(default="dialogue_extraction", description="知识来源")
    valid_from: Optional[datetime] = Field(default=None, description="有效期起始")
    valid_until: Optional[datetime] = Field(default=None, description="有效期截止")
    embedding: Optional[list[float]] = Field(default=None, description="向量嵌入")


class GraphNode(SmartAgent2BaseModel):
    """知识图谱节点"""
    id: str = Field(..., description="节点ID")
    label: str = Field(..., description="节点标签")
    properties: dict[str, Any] = Field(default_factory=dict, description="节点属性")


class GraphEdge(SmartAgent2BaseModel):
    """知识图谱边"""
    source_id: str = Field(..., description="源节点ID")
    target_id: str = Field(..., description="目标节点ID")
    relation_type: str = Field(..., description="关系类型")
    weight: float = Field(default=1.0, ge=0.0, description="关系权重")
    properties: dict[str, Any] = Field(default_factory=dict, description="关系属性")
