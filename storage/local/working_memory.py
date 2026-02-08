"""
本地模式工作记忆存储：使用 TTLCache 替代 Redis
"""
from typing import Optional
from cachetools import TTLCache
from smartagent2.models import WorkingMemory, ConversationMessage
from smartagent2.storage.interfaces import IWorkingMemoryRepo


class LocalWorkingMemoryRepo(IWorkingMemoryRepo):
    """基于 TTLCache 的工作记忆存储"""

    def __init__(self, maxsize: int = 1000, ttl: int = 1800):
        self._sessions: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._user_sessions: dict[str, set[str]] = {}  # user_id -> set of session_ids

    async def get_session(self, session_id: str) -> Optional[WorkingMemory]:
        return self._sessions.get(session_id)

    async def save_session(self, session: WorkingMemory, ttl_seconds: int = 1800) -> None:
        self._sessions[session.session_id] = session
        # 维护用户-会话映射
        if session.user_id not in self._user_sessions:
            self._user_sessions[session.user_id] = set()
        self._user_sessions[session.user_id].add(session.session_id)

    async def append_message(self, session_id: str, message: ConversationMessage) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.messages.append(message)
        # 超过最大消息数时移除最早消息
        if len(session.messages) > 50:
            session.messages = session.messages[-50:]
        session.active_context.turn_count += 1
        # 重新写入以刷新 TTL
        self._sessions[session_id] = session

    async def delete_session(self, session_id: str) -> bool:
        session = self._sessions.pop(session_id, None)
        if session:
            user_sessions = self._user_sessions.get(session.user_id, set())
            user_sessions.discard(session_id)
            return True
        return False

    async def list_active_sessions(self, user_id: str) -> list[str]:
        sessions = self._user_sessions.get(user_id, set())
        # 过滤掉已过期的会话
        active = [sid for sid in sessions if sid in self._sessions]
        self._user_sessions[user_id] = set(active)
        return active
