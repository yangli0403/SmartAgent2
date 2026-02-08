"""
SmartAgent2 存储层抽象接口定义
所有存储实现（本地/生产）必须实现这些接口
"""
from abc import ABC, abstractmethod
from typing import Any, Optional

from smartagent2.models import (
    WorkingMemory, ConversationMessage, VectorSearchResult,
    GraphNode, GraphEdge,
)


class IWorkingMemoryRepo(ABC):
    """工作记忆仓库接口"""

    @abstractmethod
    async def get_session(self, session_id: str) -> Optional[WorkingMemory]:
        """获取会话的工作记忆"""
        ...

    @abstractmethod
    async def save_session(self, session: WorkingMemory, ttl_seconds: int = 1800) -> None:
        """保存或更新会话工作记忆"""
        ...

    @abstractmethod
    async def append_message(self, session_id: str, message: ConversationMessage) -> None:
        """向会话追加消息"""
        ...

    @abstractmethod
    async def delete_session(self, session_id: str) -> bool:
        """删除会话"""
        ...

    @abstractmethod
    async def list_active_sessions(self, user_id: str) -> list[str]:
        """列出用户所有活跃会话ID"""
        ...


class IVectorRepo(ABC):
    """向量仓库接口"""

    @abstractmethod
    async def upsert(self, memory_id: str, embedding: list[float],
                     metadata: dict[str, Any], collection: str = "episodic") -> None:
        """插入或更新向量记录"""
        ...

    @abstractmethod
    async def search(self, query_embedding: list[float], top_k: int = 10,
                     collection: str = "episodic",
                     filters: Optional[dict[str, Any]] = None,
                     score_threshold: float = 0.0) -> list[VectorSearchResult]:
        """向量相似度检索"""
        ...

    @abstractmethod
    async def delete(self, memory_id: str, collection: str = "episodic") -> bool:
        """删除向量记录"""
        ...

    @abstractmethod
    async def batch_upsert(self, items: list[tuple[str, list[float], dict[str, Any]]],
                           collection: str = "episodic") -> int:
        """批量写入"""
        ...


class IDocumentRepo(ABC):
    """文档仓库接口"""

    @abstractmethod
    async def insert(self, collection: str, document: dict) -> str:
        """插入文档，返回文档ID"""
        ...

    @abstractmethod
    async def find_by_id(self, collection: str, doc_id: str) -> Optional[dict]:
        """根据ID查找文档"""
        ...

    @abstractmethod
    async def find(self, collection: str, query: dict[str, Any],
                   sort_by: str = "created_at", sort_order: str = "desc",
                   skip: int = 0, limit: int = 20) -> list[dict]:
        """条件查询文档列表"""
        ...

    @abstractmethod
    async def update(self, collection: str, doc_id: str, updates: dict) -> bool:
        """更新文档部分字段"""
        ...

    @abstractmethod
    async def delete(self, collection: str, doc_id: str) -> bool:
        """删除文档"""
        ...

    @abstractmethod
    async def count(self, collection: str, query: dict[str, Any]) -> int:
        """统计文档数量"""
        ...

    @abstractmethod
    async def full_text_search(self, collection: str, search_text: str,
                               fields: list[str], limit: int = 10) -> list[dict]:
        """全文搜索"""
        ...


class IGraphRepo(ABC):
    """图仓库接口"""

    @abstractmethod
    async def add_node(self, node: GraphNode) -> str:
        """添加/更新节点"""
        ...

    @abstractmethod
    async def add_edge(self, edge: GraphEdge) -> None:
        """添加/更新边"""
        ...

    @abstractmethod
    async def get_node(self, node_id: str) -> Optional[GraphNode]:
        """获取节点"""
        ...

    @abstractmethod
    async def get_neighbors(self, node_id: str,
                            relation_type: Optional[str] = None,
                            direction: str = "both",
                            max_depth: int = 1) -> list[dict]:
        """获取邻居节点"""
        ...

    @abstractmethod
    async def find_path(self, start_id: str, end_id: str,
                        max_depth: int = 5) -> Optional[list[str]]:
        """查找最短路径"""
        ...

    @abstractmethod
    async def delete_node(self, node_id: str, cascade: bool = True) -> bool:
        """删除节点"""
        ...

    @abstractmethod
    async def delete_edge(self, source_id: str, target_id: str,
                          relation_type: Optional[str] = None) -> bool:
        """删除边"""
        ...

    @abstractmethod
    async def query_subgraph(self, center_node_id: str, max_depth: int = 2,
                             relation_types: Optional[list[str]] = None
                             ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """查询子图"""
        ...
