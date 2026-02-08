"""
SmartAgent2 记忆提取器 (MemoryExtractor)
实现滑动窗口 + LLM 结构化提取 + 去重 + 持久化
"""
import logging
from datetime import datetime
from typing import Any, Optional

from smartagent2.config import get_config
from smartagent2.models import (
    ConversationMessage, EpisodicMemory, SemanticMemory,
    TemporalContext, generate_id,
)
from smartagent2.services import LLMService, EmbeddingService
from smartagent2.storage.interfaces import IVectorRepo, IDocumentRepo, IGraphRepo
from smartagent2.models import GraphNode, GraphEdge

logger = logging.getLogger(__name__)

EXTRACTION_SYSTEM_PROMPT = """你是一个专业的记忆提取系统。请从以下对话片段中提取有价值的记忆信息。

请以 JSON 格式返回，包含以下两个数组：

{
  "episodic_memories": [
    {
      "lossless_restatement": "完整的无损语义重述",
      "summary": "一句话摘要",
      "keywords": ["关键词1", "关键词2"],
      "event_type": "事件类型(navigation/music_playback/climate_control/phone_call/schedule_management/vehicle_control/general_conversation/dining/shopping/custom)",
      "participants": ["参与人物"],
      "location": "地点(如有)",
      "importance": 0.5,
      "confidence": 0.8
    }
  ],
  "semantic_memories": [
    {
      "subject": "主体",
      "predicate": "谓词/关系",
      "object": "客体",
      "category": "分类(preference/fact/relationship/habit/knowledge)",
      "confidence": 0.8
    }
  ]
}

提取规则：
1. 情景记忆：记录具体发生的事件、对话、行为
2. 语义记忆：提取知识性信息，如用户偏好、事实、人际关系、习惯
3. lossless_restatement 必须完整保留原始语义，不能丢失信息
4. importance 根据信息的长期价值评估（0-1）
5. 如果对话内容没有值得记忆的信息，返回空数组
6. 不要编造对话中没有提到的信息"""


class MemoryExtractor:
    """记忆提取器"""

    def __init__(self, llm: LLMService, embedding: EmbeddingService,
                 vector_repo: IVectorRepo, doc_repo: IDocumentRepo,
                 graph_repo: IGraphRepo):
        self.llm = llm
        self.embedding = embedding
        self.vector_repo = vector_repo
        self.doc_repo = doc_repo
        self.graph_repo = graph_repo
        self.config = get_config().memory

    async def extract_from_conversation(
        self, messages: list[ConversationMessage],
        user_id: str, agent_id: str = "default",
        session_id: str = ""
    ) -> dict[str, list]:
        """
        从对话消息中提取记忆
        使用滑动窗口分批处理长对话
        """
        if not messages:
            return {"episodic": [], "semantic": []}

        all_episodic = []
        all_semantic = []

        # 滑动窗口分批处理
        window_size = self.config.extraction_window_size
        overlap = self.config.extraction_overlap
        step = max(1, window_size - overlap)

        for start in range(0, len(messages), step):
            window = messages[start:start + window_size]
            if len(window) < 2:
                continue

            try:
                result = await self._extract_window(
                    window, user_id, agent_id, session_id
                )
                all_episodic.extend(result.get("episodic", []))
                all_semantic.extend(result.get("semantic", []))
            except Exception as e:
                logger.error(f"窗口提取失败 (start={start}): {e}")
                continue

        # 去重
        all_episodic = await self._deduplicate_episodic(all_episodic)
        all_semantic = self._deduplicate_semantic(all_semantic)

        # 持久化
        for mem in all_episodic:
            await self._persist_episodic(mem)
        for mem in all_semantic:
            await self._persist_semantic(mem)

        logger.info(f"提取完成: {len(all_episodic)} 条情景记忆, {len(all_semantic)} 条语义记忆")
        return {"episodic": all_episodic, "semantic": all_semantic}

    async def _extract_window(
        self, messages: list[ConversationMessage],
        user_id: str, agent_id: str, session_id: str
    ) -> dict[str, list]:
        """对单个窗口执行 LLM 提取"""
        # 构建对话文本
        conversation_text = "\n".join([
            f"[{msg.role}] {msg.content}" for msg in messages
        ])

        prompt = f"请从以下对话中提取记忆信息：\n\n{conversation_text}"

        raw = await self.llm.generate_json(
            prompt=prompt,
            system_prompt=EXTRACTION_SYSTEM_PROMPT,
            temperature=0.3,
        )

        episodic_list = []
        semantic_list = []

        # 处理情景记忆
        for item in raw.get("episodic_memories", []):
            if not item.get("lossless_restatement"):
                continue
            confidence = item.get("confidence", 0.8)
            if confidence < self.config.extraction_min_confidence:
                continue

            temporal = None
            if item.get("occurred_at"):
                temporal = TemporalContext(occurred_at=datetime.now())

            mem = EpisodicMemory(
                id=generate_id("mem_ep_"),
                user_id=user_id,
                agent_id=agent_id,
                lossless_restatement=item["lossless_restatement"],
                summary=item.get("summary", item["lossless_restatement"][:50]),
                keywords=item.get("keywords", []),
                event_type=item.get("event_type", "general_conversation"),
                participants=item.get("participants", []),
                location=item.get("location"),
                temporal_context=temporal,
                importance=item.get("importance", 0.5),
                confidence=confidence,
                source_session_id=session_id,
            )
            episodic_list.append(mem)

        # 处理语义记忆
        for item in raw.get("semantic_memories", []):
            if not all(item.get(k) for k in ("subject", "predicate", "object")):
                continue
            confidence = item.get("confidence", 0.8)
            if confidence < self.config.extraction_min_confidence:
                continue

            mem = SemanticMemory(
                id=generate_id("mem_sem_"),
                user_id=user_id,
                agent_id=agent_id,
                subject=item["subject"],
                predicate=item["predicate"],
                object=item["object"],
                category=item.get("category", "fact"),
                confidence=confidence,
            )
            semantic_list.append(mem)

        return {"episodic": episodic_list, "semantic": semantic_list}

    async def _deduplicate_episodic(self, memories: list[EpisodicMemory]) -> list[EpisodicMemory]:
        """基于语义相似度去重情景记忆"""
        if len(memories) <= 1:
            return memories

        unique = [memories[0]]
        for mem in memories[1:]:
            is_dup = False
            for existing in unique:
                try:
                    sim = await self.embedding.similarity(
                        mem.lossless_restatement,
                        existing.lossless_restatement
                    )
                    if sim > self.config.forgetting_similarity_threshold:
                        # 保留重要性更高的
                        if mem.importance > existing.importance:
                            unique.remove(existing)
                            unique.append(mem)
                        is_dup = True
                        break
                except Exception:
                    continue
            if not is_dup:
                unique.append(mem)
        return unique

    def _deduplicate_semantic(self, memories: list[SemanticMemory]) -> list[SemanticMemory]:
        """基于三元组精确去重语义记忆"""
        seen = set()
        unique = []
        for mem in memories:
            key = (mem.subject.lower(), mem.predicate.lower(), mem.object.lower())
            if key not in seen:
                seen.add(key)
                unique.append(mem)
        return unique

    async def _persist_episodic(self, memory: EpisodicMemory) -> None:
        """持久化情景记忆：文档 + 向量 + 图"""
        try:
            # 1. 存储文档
            doc = memory.to_storage()
            await self.doc_repo.insert("episodic_memories", doc)

            # 2. 生成并存储向量
            embedding = await self.embedding.embed(memory.lossless_restatement)
            await self.vector_repo.upsert(
                memory_id=memory.id,
                embedding=embedding,
                metadata={
                    "user_id": memory.user_id,
                    "event_type": memory.event_type,
                    "importance": memory.importance,
                    "created_at": memory.created_at.isoformat(),
                },
                collection="episodic",
            )

            # 3. 更新知识图谱
            await self._update_graph_for_episodic(memory)

        except Exception as e:
            logger.error(f"持久化情景记忆失败 [{memory.id}]: {e}")

    async def _persist_semantic(self, memory: SemanticMemory) -> None:
        """持久化语义记忆：文档 + 向量 + 图"""
        try:
            # 1. 存储文档
            doc = memory.to_storage()
            await self.doc_repo.insert("semantic_memories", doc)

            # 2. 生成并存储向量
            triple_text = f"{memory.subject} {memory.predicate} {memory.object}"
            embedding = await self.embedding.embed(triple_text)
            await self.vector_repo.upsert(
                memory_id=memory.id,
                embedding=embedding,
                metadata={
                    "user_id": memory.user_id,
                    "category": memory.category,
                    "subject": memory.subject,
                    "predicate": memory.predicate,
                    "object": memory.object,
                },
                collection="semantic",
            )

            # 3. 更新知识图谱
            await self._update_graph_for_semantic(memory)

        except Exception as e:
            logger.error(f"持久化语义记忆失败 [{memory.id}]: {e}")

    async def _update_graph_for_episodic(self, memory: EpisodicMemory) -> None:
        """为情景记忆更新知识图谱"""
        # 添加用户节点
        await self.graph_repo.add_node(GraphNode(
            id=f"user_{memory.user_id}",
            label="User",
            properties={"user_id": memory.user_id},
        ))

        # 添加事件节点
        await self.graph_repo.add_node(GraphNode(
            id=memory.id,
            label="Event",
            properties={
                "summary": memory.summary,
                "event_type": memory.event_type,
                "importance": memory.importance,
            },
        ))

        # 用户 -> 事件
        await self.graph_repo.add_edge(GraphEdge(
            source_id=f"user_{memory.user_id}",
            target_id=memory.id,
            relation_type="EXPERIENCED",
            weight=memory.importance,
        ))

        # 地点节点
        if memory.location:
            loc_id = f"loc_{memory.location}"
            await self.graph_repo.add_node(GraphNode(
                id=loc_id, label="Location",
                properties={"name": memory.location},
            ))
            await self.graph_repo.add_edge(GraphEdge(
                source_id=memory.id, target_id=loc_id,
                relation_type="AT_LOCATION",
            ))

        # 参与人物节点
        for person in memory.participants:
            person_id = f"person_{person}"
            await self.graph_repo.add_node(GraphNode(
                id=person_id, label="Person",
                properties={"name": person},
            ))
            await self.graph_repo.add_edge(GraphEdge(
                source_id=memory.id, target_id=person_id,
                relation_type="INVOLVES",
            ))

    async def _update_graph_for_semantic(self, memory: SemanticMemory) -> None:
        """为语义记忆更新知识图谱"""
        subj_id = f"entity_{memory.subject}"
        obj_id = f"entity_{memory.object}"

        await self.graph_repo.add_node(GraphNode(
            id=subj_id, label="Entity",
            properties={"name": memory.subject},
        ))
        await self.graph_repo.add_node(GraphNode(
            id=obj_id, label="Entity",
            properties={"name": memory.object},
        ))
        await self.graph_repo.add_edge(GraphEdge(
            source_id=subj_id, target_id=obj_id,
            relation_type=memory.predicate.upper().replace(" ", "_"),
            weight=memory.confidence,
            properties={"category": memory.category, "memory_id": memory.id},
        ))
