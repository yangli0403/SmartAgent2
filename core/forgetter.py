"""
SmartAgent2 记忆遗忘器 (MemoryForgetter)
实现基于有效重要性的记忆压缩、归档与删除
"""
import logging
import time
from datetime import datetime
from typing import Any

from smartagent2.config import get_config
from smartagent2.models import (
    ForgettingConfig, ForgettingResult, EpisodicMemory, generate_id,
)
from smartagent2.services import EmbeddingService
from smartagent2.storage.interfaces import IVectorRepo, IDocumentRepo

logger = logging.getLogger(__name__)


class MemoryForgetter:
    """记忆遗忘器"""

    def __init__(self, embedding: EmbeddingService,
                 vector_repo: IVectorRepo, doc_repo: IDocumentRepo):
        self.embedding = embedding
        self.vector_repo = vector_repo
        self.doc_repo = doc_repo
        self.config = get_config().memory

    async def run_forgetting_cycle(
        self, user_id: str,
        forgetting_config: ForgettingConfig | None = None
    ) -> ForgettingResult:
        """执行一次遗忘周期"""
        start_time = time.time()
        cfg = forgetting_config or ForgettingConfig(
            importance_threshold=self.config.forgetting_importance_threshold,
            time_decay_factor=self.config.forgetting_time_decay_factor,
            access_boost_factor=self.config.forgetting_access_boost_factor,
            similarity_threshold=self.config.forgetting_similarity_threshold,
            max_memories_per_user=self.config.forgetting_max_memories_per_user,
        )

        result = ForgettingResult(user_id=user_id)

        # 1. 获取所有活跃情景记忆
        memories = await self.doc_repo.find(
            "episodic_memories",
            {"user_id": user_id, "is_archived": 0},
            sort_by="created_at", sort_order="asc",
            skip=0, limit=cfg.max_memories_per_user * 2,
        )
        result.total_scanned = len(memories)

        if not memories:
            return result

        # 2. 计算有效重要性
        scored_memories = []
        for mem in memories:
            effective_importance = self._calculate_effective_importance(mem, cfg)
            scored_memories.append((mem, effective_importance))

        # 3. 压缩相似记忆
        compressed = await self._compress_similar(scored_memories, cfg)
        result.memories_compressed = compressed
        result.details.append(f"压缩合并了 {compressed} 组相似记忆")

        # 4. 归档低重要性记忆
        archived = 0
        deleted = 0
        for mem, score in scored_memories:
            if score < cfg.importance_threshold:
                if cfg.archive_instead_of_delete:
                    await self.doc_repo.update(
                        "episodic_memories", mem["id"],
                        {"is_archived": True}
                    )
                    archived += 1
                else:
                    await self.doc_repo.delete("episodic_memories", mem["id"])
                    await self.vector_repo.delete(mem["id"], "episodic")
                    deleted += 1

        result.memories_archived = archived
        result.memories_deleted = deleted

        # 5. 超限处理
        total_active = await self.doc_repo.count(
            "episodic_memories",
            {"user_id": user_id, "is_archived": 0}
        )
        if total_active > cfg.max_memories_per_user:
            overflow = total_active - cfg.max_memories_per_user
            # 获取最不重要的记忆进行归档
            oldest = await self.doc_repo.find(
                "episodic_memories",
                {"user_id": user_id, "is_archived": 0},
                sort_by="importance", sort_order="asc",
                skip=0, limit=overflow,
            )
            for mem in oldest:
                await self.doc_repo.update(
                    "episodic_memories", mem["id"],
                    {"is_archived": True}
                )
                result.memories_archived += 1
            result.details.append(f"超限归档 {len(oldest)} 条")

        elapsed = (time.time() - start_time) * 1000
        result.execution_time_ms = elapsed
        result.details.append(f"总耗时: {elapsed:.1f}ms")

        logger.info(
            f"遗忘周期完成 [user={user_id}]: 扫描={result.total_scanned}, "
            f"压缩={result.memories_compressed}, 归档={result.memories_archived}, "
            f"删除={result.memories_deleted}"
        )
        return result

    def _calculate_effective_importance(
        self, memory: dict, cfg: ForgettingConfig
    ) -> float:
        """
        计算有效重要性:
        effective = base_importance * time_decay + access_boost
        """
        base_importance = memory.get("importance", 0.5)

        # 时间衰减
        created_str = memory.get("created_at", "")
        try:
            if isinstance(created_str, str):
                created_at = datetime.fromisoformat(created_str)
            else:
                created_at = created_str
            days_old = (datetime.now() - created_at).days
        except Exception:
            days_old = 0

        time_decay = cfg.time_decay_factor ** days_old

        # 访问强化
        access_count = memory.get("access_count", 0)
        access_boost = min(cfg.access_boost_factor * access_count, 0.3)

        effective = base_importance * time_decay + access_boost
        return min(effective, 1.0)

    async def _compress_similar(
        self, scored_memories: list[tuple[dict, float]],
        cfg: ForgettingConfig
    ) -> int:
        """压缩合并相似记忆"""
        compressed_count = 0

        # 简化版：对低重要性记忆进行两两比较
        low_importance = [
            (mem, score) for mem, score in scored_memories
            if score < cfg.importance_threshold * 2
        ]

        if len(low_importance) < 2:
            return 0

        merged_ids = set()
        for i in range(len(low_importance)):
            if low_importance[i][0]["id"] in merged_ids:
                continue
            for j in range(i + 1, len(low_importance)):
                if low_importance[j][0]["id"] in merged_ids:
                    continue
                try:
                    sim = await self.embedding.similarity(
                        low_importance[i][0].get("lossless_restatement", ""),
                        low_importance[j][0].get("lossless_restatement", ""),
                    )
                    if sim > cfg.similarity_threshold:
                        # 合并：保留重要性更高的，标记另一个为已压缩
                        keep, discard = (i, j) if low_importance[i][1] >= low_importance[j][1] else (j, i)
                        keep_mem = low_importance[keep][0]
                        discard_mem = low_importance[discard][0]

                        # 更新保留的记忆
                        merged_from = keep_mem.get("merged_from", [])
                        if isinstance(merged_from, str):
                            import json
                            merged_from = json.loads(merged_from)
                        merged_from.append(discard_mem["id"])

                        await self.doc_repo.update(
                            "episodic_memories", keep_mem["id"],
                            {
                                "merged_from": merged_from,
                                "is_compressed": True,
                            }
                        )
                        # 归档被合并的记忆
                        await self.doc_repo.update(
                            "episodic_memories", discard_mem["id"],
                            {"is_archived": True}
                        )
                        merged_ids.add(discard_mem["id"])
                        compressed_count += 1
                except Exception as e:
                    logger.warning(f"压缩比较失败: {e}")
                    continue

        return compressed_count
