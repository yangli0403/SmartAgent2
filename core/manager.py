"""
SmartAgent2 记忆管理器 (MemoryManager)
提供面向前端的记忆 CRUD、统计、导出等管理接口
"""
import csv
import io
import json
import logging
from datetime import datetime
from typing import Any, Optional

from smartagent2.models import (
    EpisodicMemory, SemanticMemory,
    MemoryFilter, PaginatedResult, MemoryStats, KeywordCount,
    ExportFormat,
)
from smartagent2.storage.interfaces import IVectorRepo, IDocumentRepo

logger = logging.getLogger(__name__)


class MemoryManager:
    """记忆管理器"""

    def __init__(self, vector_repo: IVectorRepo, doc_repo: IDocumentRepo):
        self.vector_repo = vector_repo
        self.doc_repo = doc_repo

    # ============================================================
    # 情景记忆 CRUD
    # ============================================================

    async def get_episodic_memory(self, memory_id: str) -> Optional[dict]:
        """获取单条情景记忆"""
        return await self.doc_repo.find_by_id("episodic_memories", memory_id)

    async def list_episodic_memories(
        self, user_id: str,
        page: int = 1, page_size: int = 20,
        filters: Optional[MemoryFilter] = None,
    ) -> PaginatedResult:
        """分页列出情景记忆"""
        query: dict[str, Any] = {"user_id": user_id}
        if filters:
            if filters.event_type:
                query["event_type"] = filters.event_type
            if filters.min_importance is not None:
                pass  # SQLite 不支持 > 过滤，后续在代码中过滤

        skip = (page - 1) * page_size
        items = await self.doc_repo.find(
            "episodic_memories", query,
            sort_by="created_at", sort_order="desc",
            skip=skip, limit=page_size,
        )

        # 应用额外过滤
        if filters and filters.min_importance is not None:
            items = [i for i in items if i.get("importance", 0) >= filters.min_importance]
        if filters and filters.keywords:
            items = [
                i for i in items
                if any(kw.lower() in json.dumps(i.get("keywords", []), ensure_ascii=False).lower()
                       for kw in filters.keywords)
            ]

        total = await self.doc_repo.count("episodic_memories", {"user_id": user_id})
        total_pages = (total + page_size - 1) // page_size

        return PaginatedResult(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def update_episodic_memory(self, memory_id: str, updates: dict) -> bool:
        """更新情景记忆"""
        allowed_fields = {"summary", "keywords", "importance", "event_type",
                          "participants", "location", "is_archived"}
        filtered = {k: v for k, v in updates.items() if k in allowed_fields}
        if not filtered:
            return False
        return await self.doc_repo.update("episodic_memories", memory_id, filtered)

    async def delete_episodic_memory(self, memory_id: str) -> bool:
        """删除情景记忆"""
        await self.vector_repo.delete(memory_id, "episodic")
        return await self.doc_repo.delete("episodic_memories", memory_id)

    # ============================================================
    # 语义记忆 CRUD
    # ============================================================

    async def get_semantic_memory(self, memory_id: str) -> Optional[dict]:
        """获取单条语义记忆"""
        return await self.doc_repo.find_by_id("semantic_memories", memory_id)

    async def list_semantic_memories(
        self, user_id: str,
        page: int = 1, page_size: int = 20,
        category: Optional[str] = None,
    ) -> PaginatedResult:
        """分页列出语义记忆"""
        query: dict[str, Any] = {"user_id": user_id}
        if category:
            query["category"] = category

        skip = (page - 1) * page_size
        items = await self.doc_repo.find(
            "semantic_memories", query,
            sort_by="created_at", sort_order="desc",
            skip=skip, limit=page_size,
        )
        total = await self.doc_repo.count("semantic_memories", query)
        total_pages = (total + page_size - 1) // page_size

        return PaginatedResult(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def delete_semantic_memory(self, memory_id: str) -> bool:
        """删除语义记忆"""
        await self.vector_repo.delete(memory_id, "semantic")
        return await self.doc_repo.delete("semantic_memories", memory_id)

    # ============================================================
    # 统计
    # ============================================================

    async def get_stats(self, user_id: str) -> MemoryStats:
        """获取记忆统计"""
        total_episodic = await self.doc_repo.count(
            "episodic_memories", {"user_id": user_id})
        active_episodic = await self.doc_repo.count(
            "episodic_memories", {"user_id": user_id, "is_archived": 0})
        archived_episodic = await self.doc_repo.count(
            "episodic_memories", {"user_id": user_id, "is_archived": 1})
        total_semantic = await self.doc_repo.count(
            "semantic_memories", {"user_id": user_id})

        # 获取关键词统计
        all_memories = await self.doc_repo.find(
            "episodic_memories", {"user_id": user_id},
            sort_by="created_at", sort_order="desc",
            skip=0, limit=500,
        )

        keyword_counts: dict[str, int] = {}
        event_type_dist: dict[str, int] = {}
        compressed_count = 0
        oldest_at = None
        newest_at = None

        for mem in all_memories:
            # 关键词统计
            keywords = mem.get("keywords", [])
            if isinstance(keywords, str):
                keywords = json.loads(keywords)
            for kw in keywords:
                keyword_counts[kw] = keyword_counts.get(kw, 0) + 1

            # 事件类型分布
            et = mem.get("event_type", "unknown")
            event_type_dist[et] = event_type_dist.get(et, 0) + 1

            # 压缩计数
            if mem.get("is_compressed"):
                compressed_count += 1

            # 时间范围
            created = mem.get("created_at")
            if created:
                if oldest_at is None or created < oldest_at:
                    oldest_at = created
                if newest_at is None or created > newest_at:
                    newest_at = created

        top_keywords = sorted(keyword_counts.items(), key=lambda x: -x[1])[:20]

        return MemoryStats(
            user_id=user_id,
            total_episodic=total_episodic,
            total_semantic=total_semantic,
            active_episodic=active_episodic,
            archived_episodic=archived_episodic,
            compressed_episodic=compressed_count,
            top_keywords=[KeywordCount(keyword=k, count=c) for k, c in top_keywords],
            event_type_distribution=event_type_dist,
        )

    # ============================================================
    # 导出
    # ============================================================

    async def export_memories(
        self, user_id: str, format: ExportFormat = ExportFormat.JSON
    ) -> str:
        """导出用户所有记忆"""
        episodic = await self.doc_repo.find(
            "episodic_memories", {"user_id": user_id},
            sort_by="created_at", sort_order="desc",
            skip=0, limit=10000,
        )
        semantic = await self.doc_repo.find(
            "semantic_memories", {"user_id": user_id},
            sort_by="created_at", sort_order="desc",
            skip=0, limit=10000,
        )

        if format == ExportFormat.JSON:
            data = {
                "user_id": user_id,
                "exported_at": datetime.now().isoformat(),
                "episodic_memories": episodic,
                "semantic_memories": semantic,
            }
            return json.dumps(data, ensure_ascii=False, indent=2, default=str)

        elif format == ExportFormat.CSV:
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["type", "id", "content", "importance", "created_at"])
            for mem in episodic:
                writer.writerow([
                    "episodic", mem.get("id"), mem.get("summary"),
                    mem.get("importance"), mem.get("created_at"),
                ])
            for mem in semantic:
                writer.writerow([
                    "semantic", mem.get("id"),
                    f"{mem.get('subject')} {mem.get('predicate')} {mem.get('object')}",
                    mem.get("confidence"), mem.get("created_at"),
                ])
            return output.getvalue()

        return ""

    # ============================================================
    # 批量操作
    # ============================================================

    async def clear_all_memories(self, user_id: str) -> dict:
        """清除用户所有记忆"""
        episodic = await self.doc_repo.find(
            "episodic_memories", {"user_id": user_id},
            skip=0, limit=10000,
        )
        semantic = await self.doc_repo.find(
            "semantic_memories", {"user_id": user_id},
            skip=0, limit=10000,
        )

        ep_count = 0
        for mem in episodic:
            await self.doc_repo.delete("episodic_memories", mem["id"])
            await self.vector_repo.delete(mem["id"], "episodic")
            ep_count += 1

        sem_count = 0
        for mem in semantic:
            await self.doc_repo.delete("semantic_memories", mem["id"])
            await self.vector_repo.delete(mem["id"], "semantic")
            sem_count += 1

        return {
            "episodic_deleted": ep_count,
            "semantic_deleted": sem_count,
        }
