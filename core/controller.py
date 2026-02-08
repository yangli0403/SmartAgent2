"""
SmartAgent2 记忆控制器 (MemoryController)
统一编排所有核心模块，实现端到端的 chat 接口
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from smartagent2.config import get_config
from smartagent2.models import (
    ChatRequest, ChatResponse, ChatOptions,
    ConversationMessage, MessageRole, WorkingMemory,
    RetrievalQuery, RetrievalResult,
    generate_id,
)
from smartagent2.core.extractor import MemoryExtractor
from smartagent2.core.retriever import MemoryRetriever
from smartagent2.core.forgetter import MemoryForgetter
from smartagent2.core.profile_manager import ProfileManager
from smartagent2.core.character_manager import CharacterManager
from smartagent2.core.manager import MemoryManager
from smartagent2.services import LLMService, EmbeddingService
from smartagent2.storage.interfaces import IWorkingMemoryRepo

logger = logging.getLogger(__name__)


class MemoryController:
    """记忆控制器 - 系统核心编排器"""

    def __init__(
        self,
        llm: LLMService,
        embedding: EmbeddingService,
        working_memory_repo: IWorkingMemoryRepo,
        extractor: MemoryExtractor,
        retriever: MemoryRetriever,
        forgetter: MemoryForgetter,
        profile_manager: ProfileManager,
        character_manager: CharacterManager,
        memory_manager: MemoryManager,
    ):
        self.llm = llm
        self.embedding = embedding
        self.working_memory_repo = working_memory_repo
        self.extractor = extractor
        self.retriever = retriever
        self.forgetter = forgetter
        self.profile_manager = profile_manager
        self.character_manager = character_manager
        self.memory_manager = memory_manager
        self.config = get_config()

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """
        核心对话接口 - 端到端处理流程：
        1. 获取/创建工作记忆
        2. 检索相关长期记忆
        3. 获取用户画像快照
        4. 构建 System Prompt
        5. 调用 LLM 生成回复
        6. 更新工作记忆
        7. 异步触发记忆提取
        """
        # 1. 获取或创建工作记忆
        session = await self._get_or_create_session(request)

        # 2. 追加用户消息到工作记忆
        user_msg = ConversationMessage(
            role=MessageRole.USER,
            content=request.message,
        )
        await self.working_memory_repo.append_message(request.session_id, user_msg)

        # 3. 检索相关长期记忆
        memory_context = None
        memories_used = 0
        if request.options.include_memory:
            try:
                retrieval_query = RetrievalQuery(
                    user_id=request.user_id,
                    query=request.message,
                    top_k=request.options.max_memory_items,
                )
                memory_context = await self.retriever.retrieve(retrieval_query)
                memories_used = (
                    len(memory_context.episodic_memories) +
                    len(memory_context.semantic_memories)
                )
            except Exception as e:
                logger.error(f"记忆检索失败: {e}")

        # 4. 获取用户画像快照
        user_context = None
        if request.options.include_profile:
            try:
                user_context = await self.profile_manager.get_contextual_snapshot(
                    request.user_id
                )
            except Exception as e:
                logger.error(f"获取画像失败: {e}")

        # 5. 构建 System Prompt
        character_id = request.options.character_id or "default"
        memory_text = self._format_memory_context(memory_context)

        try:
            system_prompt = await self.character_manager.build_system_prompt(
                character_id=character_id,
                user_context=user_context,
                memory_context=memory_text,
            )
        except Exception:
            system_prompt = "你是一个友好的 AI 助手。请根据用户的消息进行回复。"
            if memory_text:
                system_prompt += f"\n\n## 相关记忆\n{memory_text}"

        # 6. 构建对话历史并调用 LLM
        chat_messages = self._build_chat_messages(session, request.message)
        try:
            response_text = await self.llm.generate_with_history(
                messages=chat_messages,
                system_prompt=system_prompt,
            )
        except Exception as e:
            logger.error(f"LLM 生成失败: {e}")
            response_text = "抱歉，我暂时无法回复。请稍后再试。"

        # 7. 追加助手回复到工作记忆
        assistant_msg = ConversationMessage(
            role=MessageRole.ASSISTANT,
            content=response_text,
        )
        await self.working_memory_repo.append_message(request.session_id, assistant_msg)

        # 8. 异步触发记忆提取（当对话积累到一定轮次时）
        updated_session = await self.working_memory_repo.get_session(request.session_id)
        if updated_session and len(updated_session.messages) >= self.config.memory.extraction_window_size:
            try:
                await self.extractor.extract_from_conversation(
                    messages=updated_session.messages,
                    user_id=request.user_id,
                    agent_id=request.agent_id,
                    session_id=request.session_id,
                )
                # 同时更新画像
                await self.profile_manager.auto_update_from_conversation(
                    request.user_id, updated_session.messages
                )
            except Exception as e:
                logger.error(f"记忆提取失败: {e}")

        return ChatResponse(
            response=response_text,
            session_id=request.session_id,
            memories_used=memories_used,
            memory_context=memory_context,
            character_id=character_id,
        )

    async def _get_or_create_session(self, request: ChatRequest) -> WorkingMemory:
        """获取或创建工作记忆会话"""
        session = await self.working_memory_repo.get_session(request.session_id)
        if session is None:
            session = WorkingMemory(
                session_id=request.session_id,
                user_id=request.user_id,
                agent_id=request.agent_id,
                expires_at=datetime.now() + timedelta(
                    seconds=self.config.memory.working_memory_ttl
                ),
            )
            await self.working_memory_repo.save_session(
                session,
                ttl_seconds=self.config.memory.working_memory_ttl,
            )
        return session

    def _build_chat_messages(
        self, session: WorkingMemory, current_message: str
    ) -> list[dict[str, str]]:
        """构建发送给 LLM 的对话历史"""
        messages = []
        # 取最近的对话历史（不包括刚追加的当前消息，因为它已在 session 中）
        recent = session.messages[-10:]  # 最多取最近 10 条
        for msg in recent:
            messages.append({
                "role": msg.role,
                "content": msg.content,
            })
        # 确保最后一条是用户消息
        if not messages or messages[-1]["role"] != "user":
            messages.append({"role": "user", "content": current_message})
        return messages

    def _format_memory_context(self, result: Optional[RetrievalResult]) -> str:
        """将检索结果格式化为文本"""
        if not result:
            return ""

        parts = []

        if result.episodic_memories:
            parts.append("### 相关事件记忆")
            for i, mem in enumerate(result.episodic_memories, 1):
                parts.append(f"{i}. {mem.content} (相关度: {mem.score:.2f})")

        if result.semantic_memories:
            parts.append("\n### 相关知识")
            for mem in result.semantic_memories:
                parts.append(f"- {mem.subject} {mem.predicate} {mem.object}")

        return "\n".join(parts)
