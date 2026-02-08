"""
SmartAgent2 记忆检索器 (MemoryRetriever)
实现三层混合检索（语义、词汇、符号）+ RRF 融合排序
"""
import logging
import time
from datetime import datetime
from typing import Any, Optional

from smartagent2.config import get_config
from smartagent2.models import (
    RetrievalQuery, RetrievalResult, ScoredMemory, MemoryType,
    SemanticMemory, ContextualProfileSnapshot,
)
from smartagent2.services import LLMService, EmbeddingService
from smartagent2.storage.interfaces import IVectorRepo, IDocumentRepo, IGraphRepo

logger = logging.getLogger(__name__)

INTENT_ANALYSIS_PROMPT = """分析以下用户查询的意图，返回 JSON 格式：
{
  "intent": "查询意图分类",
  "search_keywords": ["关键词1", "关键词2"],
  "time_hint": "时间相关提示(如有)",
  "entity_hint": "实体相关提示(如有)"
}

用户查询: """


class MemoryRetriever:
    """记忆检索器"""

    def __init__(self, llm: LLMService, embedding: EmbeddingService,
                 vector_repo: IVectorRepo, doc_repo: IDocumentRepo,
                 graph_repo: IGraphRepo):
        self.llm = llm
        self.embedding = embedding
        self.vector_repo = vector_repo
        self.doc_repo = doc_repo
        self.graph_repo = graph_repo
        self.config = get_config().memory

    async def retrieve(self, query: RetrievalQuery) -> RetrievalResult:
        """执行混合检索"""
        start_time = time.time()
        plan_parts = []

        # 1. 意图分析
        intent_info = await self._analyze_intent(query.query)
        plan_parts.append(f"意图: {intent_info.get('intent', 'unknown')}")

        episodic_results: list[ScoredMemory] = []
        semantic_results: list[SemanticMemory] = []

        # 2. 情景记忆检索
        if query.include_episodic:
            episodic_results = await self._retrieve_episodic(
                query, intent_info
            )
            plan_parts.append(f"情景记忆: {len(episodic_results)} 条")

        # 3. 语义记忆检索
        if query.include_semantic:
            semantic_results = await self._retrieve_semantic(
                query, intent_info
            )
            plan_parts.append(f"语义记忆: {len(semantic_results)} 条")

        # 4. 更新访问计数
        for mem in episodic_results:
            await self._update_access_count(mem.memory_id)

        elapsed = (time.time() - start_time) * 1000
        plan_parts.append(f"耗时: {elapsed:.1f}ms")

        return RetrievalResult(
            episodic_memories=episodic_results,
            semantic_memories=semantic_results,
            retrieval_plan=" | ".join(plan_parts),
            total_retrieval_time_ms=elapsed,
        )

    async def _analyze_intent(self, query: str) -> dict:
        """分析查询意图"""
        try:
            return await self.llm.generate_json(
                prompt=INTENT_ANALYSIS_PROMPT + query,
                temperature=0.2,
            )
        except Exception as e:
            logger.warning(f"意图分析失败: {e}")
            return {"intent": "unknown", "search_keywords": []}

    async def _retrieve_episodic(
        self, query: RetrievalQuery, intent_info: dict
    ) -> list[ScoredMemory]:
        """情景记忆检索：语义 + 词汇 + 图谱 + RRF 融合"""
        all_candidates: dict[str, list[tuple[float, str]]] = {}

        # Layer 1: 语义检索（向量）
        try:
            query_embedding = await self.embedding.embed(query.query)
            vec_filters = {"user_id": query.user_id}
            if query.event_type:
                vec_filters["event_type"] = query.event_type

            vec_results = await self.vector_repo.search(
                query_embedding=query_embedding,
                top_k=query.top_k * 3,
                collection="episodic",
                filters=vec_filters,
                score_threshold=self.config.retrieval_score_threshold * 0.5,
            )
            for r in vec_results:
                mid = r.memory_id
                if mid not in all_candidates:
                    all_candidates[mid] = []
                all_candidates[mid].append((r.score, "semantic"))
        except Exception as e:
            logger.warning(f"语义检索失败: {e}")

        # Layer 2: 词汇检索（FTS）
        try:
            keywords = intent_info.get("search_keywords", [])
            search_text = " ".join(keywords) if keywords else query.query
            fts_results = await self.doc_repo.full_text_search(
                "episodic_memories", search_text,
                fields=["lossless_restatement", "summary", "keywords"],
                limit=query.top_k * 2,
            )
            for i, doc in enumerate(fts_results):
                if doc.get("user_id") != query.user_id:
                    continue
                mid = doc["id"]
                # FTS 结果按位置给分
                score = max(0.3, 1.0 - i * 0.1)
                if mid not in all_candidates:
                    all_candidates[mid] = []
                all_candidates[mid].append((score, "lexical"))
        except Exception as e:
            logger.warning(f"词汇检索失败: {e}")

        # Layer 3: 图谱检索（符号）
        try:
            user_node_id = f"user_{query.user_id}"
            neighbors = await self.graph_repo.get_neighbors(
                user_node_id, direction="outgoing", max_depth=2
            )
            # 对图谱邻居进行关键词匹配
            query_lower = query.query.lower()
            for nb in neighbors:
                node = nb.get("node", {})
                props = node.get("properties", {})
                summary = props.get("summary", "").lower()
                name = props.get("name", "").lower()
                if any(kw.lower() in summary or kw.lower() in name
                       for kw in intent_info.get("search_keywords", [query.query])):
                    mid = node.get("id", "")
                    if mid.startswith("mem_ep_"):
                        score = 0.6 * nb.get("weight", 1.0)
                        if mid not in all_candidates:
                            all_candidates[mid] = []
                        all_candidates[mid].append((score, "graph"))
        except Exception as e:
            logger.warning(f"图谱检索失败: {e}")

        # RRF 融合排序
        rrf_scores = self._rrf_fusion(all_candidates)

        # 获取完整文档并构建结果
        results = []
        for mid, score in sorted(rrf_scores.items(), key=lambda x: -x[1])[:query.top_k]:
            doc = await self.doc_repo.find_by_id("episodic_memories", mid)
            if doc and not doc.get("is_archived"):
                sources = [s for _, s in all_candidates.get(mid, [])]
                results.append(ScoredMemory(
                    memory_id=mid,
                    memory_type=MemoryType.EPISODIC,
                    content=doc.get("summary", doc.get("lossless_restatement", "")),
                    score=min(score, 1.0),
                    source="+".join(set(sources)),
                    raw_data=doc,
                ))
        return results

    async def _retrieve_semantic(
        self, query: RetrievalQuery, intent_info: dict
    ) -> list[SemanticMemory]:
        """语义记忆检索"""
        results = []

        # 向量检索
        try:
            query_embedding = await self.embedding.embed(query.query)
            vec_results = await self.vector_repo.search(
                query_embedding=query_embedding,
                top_k=query.top_k * 2,
                collection="semantic",
                filters={"user_id": query.user_id},
            )
            seen_ids = set()
            for r in vec_results:
                if r.memory_id in seen_ids:
                    continue
                seen_ids.add(r.memory_id)
                doc = await self.doc_repo.find_by_id("semantic_memories", r.memory_id)
                if doc:
                    results.append(SemanticMemory(
                        id=doc["id"],
                        user_id=doc["user_id"],
                        agent_id=doc.get("agent_id", "default"),
                        subject=doc["subject"],
                        predicate=doc["predicate"],
                        object=doc["object"],
                        category=doc.get("category", "fact"),
                        confidence=doc.get("confidence", 0.8),
                    ))
        except Exception as e:
            logger.warning(f"语义记忆向量检索失败: {e}")

        # 图谱补充检索
        try:
            keywords = intent_info.get("search_keywords", [])
            for kw in keywords[:3]:
                entity_id = f"entity_{kw}"
                neighbors = await self.graph_repo.get_neighbors(
                    entity_id, direction="both", max_depth=1
                )
                for nb in neighbors:
                    edge_props = nb.get("node", {}).get("properties", {})
                    mem_id = edge_props.get("memory_id")
                    if mem_id and not any(r.id == mem_id for r in results):
                        doc = await self.doc_repo.find_by_id("semantic_memories", mem_id)
                        if doc:
                            results.append(SemanticMemory(
                                id=doc["id"],
                                user_id=doc["user_id"],
                                subject=doc["subject"],
                                predicate=doc["predicate"],
                                object=doc["object"],
                                category=doc.get("category", "fact"),
                                confidence=doc.get("confidence", 0.8),
                            ))
        except Exception as e:
            logger.warning(f"语义记忆图谱检索失败: {e}")

        return results[:query.top_k]

    def _rrf_fusion(self, candidates: dict[str, list[tuple[float, str]]]) -> dict[str, float]:
        """
        Reciprocal Rank Fusion (RRF) 融合排序
        对每个来源的结果按分数排序，然后用 RRF 公式合并
        """
        k = self.config.rrf_k

        # 按来源分组排序
        source_rankings: dict[str, list[tuple[str, float]]] = {}
        for mid, scores in candidates.items():
            for score, source in scores:
                if source not in source_rankings:
                    source_rankings[source] = []
                source_rankings[source].append((mid, score))

        # 对每个来源按分数降序排序
        for source in source_rankings:
            source_rankings[source].sort(key=lambda x: -x[1])

        # RRF 计算
        rrf_scores: dict[str, float] = {}
        for source, ranking in source_rankings.items():
            for rank, (mid, _) in enumerate(ranking, start=1):
                if mid not in rrf_scores:
                    rrf_scores[mid] = 0.0
                rrf_scores[mid] += 1.0 / (k + rank)

        return rrf_scores

    async def _update_access_count(self, memory_id: str) -> None:
        """更新记忆的访问计数"""
        try:
            doc = await self.doc_repo.find_by_id("episodic_memories", memory_id)
            if doc:
                await self.doc_repo.update("episodic_memories", memory_id, {
                    "access_count": doc.get("access_count", 0) + 1,
                    "last_accessed_at": datetime.now().isoformat(),
                })
        except Exception as e:
            logger.warning(f"更新访问计数失败 [{memory_id}]: {e}")
