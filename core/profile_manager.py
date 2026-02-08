"""
SmartAgent2 画像管理器 (ProfileManager)
实现用户画像的 CRUD、场景化偏好、关系解析和自动更新
"""
import logging
from datetime import datetime
from typing import Any, Optional

from smartagent2.models import (
    UserProfile, UserPreference, PersonRelationship,
    InterestTag, HabitPattern, ContextualProfileSnapshot,
    ConversationMessage, generate_id,
)
from smartagent2.models.query import ProfileUpdateResult
from smartagent2.services import LLMService
from smartagent2.storage.interfaces import IDocumentRepo

logger = logging.getLogger(__name__)

PROFILE_EXTRACTION_PROMPT = """你是一个用户画像分析系统。请从以下对话中提取用户画像信息。

返回 JSON 格式：
{
  "preferences": [
    {"category": "分类", "key": "键名", "value": "值", "context": "场景(可选)"}
  ],
  "relationships": [
    {"person_name": "人名", "relationship": "关系类型", "aliases": ["别名"], "attributes": {}}
  ],
  "interests": [
    {"tag": "兴趣标签", "weight": 0.5}
  ],
  "habits": [
    {"action": "行为描述", "pattern": "行为模式"}
  ],
  "basic_info_updates": {
    "key": "value"
  }
}

只提取对话中明确提到的信息，不要推测。如果没有相关信息，返回空数组。"""


class ProfileManager:
    """用户画像管理器"""

    def __init__(self, llm: LLMService, doc_repo: IDocumentRepo):
        self.llm = llm
        self.doc_repo = doc_repo

    # ============================================================
    # CRUD 操作
    # ============================================================

    async def get_profile(self, user_id: str) -> UserProfile:
        """获取用户画像，不存在则创建空画像"""
        doc = await self.doc_repo.find_by_id("user_profiles", user_id)
        if doc:
            return self._doc_to_profile(doc)
        # 创建空画像
        profile = UserProfile(user_id=user_id)
        await self._save_profile(profile)
        return profile

    async def update_profile(self, user_id: str, updates: dict) -> UserProfile:
        """手动更新画像"""
        profile = await self.get_profile(user_id)

        if "basic_info" in updates:
            profile.basic_info.update(updates["basic_info"])

        if "preferences" in updates:
            for pref_data in updates["preferences"]:
                pref = UserPreference(**pref_data)
                # 检查是否已存在相同 key
                existing = next(
                    (p for p in profile.preferences
                     if p.category == pref.category and p.key == pref.key),
                    None
                )
                if existing:
                    existing.value = pref.value
                    existing.context = pref.context
                    existing.updated_at = datetime.now()
                else:
                    profile.preferences.append(pref)

        if "relationships" in updates:
            for rel_data in updates["relationships"]:
                rel = PersonRelationship(**rel_data)
                existing = next(
                    (r for r in profile.relationships
                     if r.person_name == rel.person_name),
                    None
                )
                if existing:
                    existing.relationship = rel.relationship
                    existing.aliases = rel.aliases or existing.aliases
                    existing.attributes.update(rel.attributes)
                else:
                    profile.relationships.append(rel)

        profile.updated_at = datetime.now()
        await self._save_profile(profile)
        return profile

    async def delete_profile(self, user_id: str) -> bool:
        """删除用户画像"""
        return await self.doc_repo.delete("user_profiles", user_id)

    # ============================================================
    # 偏好管理
    # ============================================================

    async def add_preference(self, user_id: str, preference: UserPreference) -> UserProfile:
        """添加偏好"""
        profile = await self.get_profile(user_id)
        profile.preferences.append(preference)
        profile.updated_at = datetime.now()
        await self._save_profile(profile)
        return profile

    async def remove_preference(self, user_id: str, preference_id: str) -> UserProfile:
        """移除偏好"""
        profile = await self.get_profile(user_id)
        profile.preferences = [p for p in profile.preferences if p.id != preference_id]
        profile.updated_at = datetime.now()
        await self._save_profile(profile)
        return profile

    async def get_contextual_preferences(
        self, user_id: str, context: str = ""
    ) -> list[UserPreference]:
        """获取场景化偏好"""
        profile = await self.get_profile(user_id)
        if not context:
            return [p for p in profile.preferences if p.is_active]

        return [
            p for p in profile.preferences
            if p.is_active and (p.context is None or p.context == "" or p.context == context)
        ]

    # ============================================================
    # 画像快照
    # ============================================================

    async def get_contextual_snapshot(
        self, user_id: str, context: str = ""
    ) -> ContextualProfileSnapshot:
        """获取上下文化画像快照"""
        profile = await self.get_profile(user_id)

        active_prefs = [
            p for p in profile.preferences
            if p.is_active and (not p.context or p.context == context)
        ]

        active_habits = [h for h in profile.habits if h.is_active]

        display_name = profile.basic_info.get("name", "")
        if not display_name:
            display_name = profile.basic_info.get("nickname", f"用户{user_id[:6]}")

        return ContextualProfileSnapshot(
            user_id=user_id,
            display_name=display_name,
            active_preferences=active_prefs,
            relevant_relationships=profile.relationships,
            active_habits=active_habits,
            context=context,
        )

    # ============================================================
    # 自动更新（从对话中提取）
    # ============================================================

    async def auto_update_from_conversation(
        self, user_id: str, messages: list[ConversationMessage]
    ) -> ProfileUpdateResult:
        """从对话中自动提取并更新画像"""
        result = ProfileUpdateResult()

        if not messages:
            return result

        conversation_text = "\n".join([
            f"[{msg.role}] {msg.content}" for msg in messages
        ])

        try:
            extracted = await self.llm.generate_json(
                prompt=f"请从以下对话中提取用户画像信息：\n\n{conversation_text}",
                system_prompt=PROFILE_EXTRACTION_PROMPT,
                temperature=0.3,
            )
        except Exception as e:
            logger.error(f"画像自动提取失败: {e}")
            return result

        profile = await self.get_profile(user_id)

        # 处理偏好
        for pref_data in extracted.get("preferences", []):
            try:
                existing = next(
                    (p for p in profile.preferences
                     if p.category == pref_data.get("category")
                     and p.key == pref_data.get("key")),
                    None
                )
                if existing:
                    existing.value = pref_data.get("value", existing.value)
                    existing.updated_at = datetime.now()
                    existing.source = "auto_extract"
                    result.preferences_updated += 1
                else:
                    profile.preferences.append(UserPreference(
                        category=pref_data.get("category", "general"),
                        key=pref_data.get("key", ""),
                        value=pref_data.get("value", ""),
                        context=pref_data.get("context"),
                        source="auto_extract",
                    ))
                    result.preferences_added += 1
            except Exception:
                continue

        # 处理关系
        for rel_data in extracted.get("relationships", []):
            try:
                existing = next(
                    (r for r in profile.relationships
                     if r.person_name == rel_data.get("person_name")),
                    None
                )
                if existing:
                    existing.relationship = rel_data.get("relationship", existing.relationship)
                    result.relationships_updated += 1
                else:
                    profile.relationships.append(PersonRelationship(
                        person_name=rel_data.get("person_name", ""),
                        relationship=rel_data.get("relationship", ""),
                        aliases=rel_data.get("aliases", []),
                        attributes=rel_data.get("attributes", {}),
                    ))
                    result.relationships_added += 1
            except Exception:
                continue

        # 处理兴趣
        for interest_data in extracted.get("interests", []):
            try:
                tag = interest_data.get("tag", "")
                if tag and not any(i.tag == tag for i in profile.interests):
                    profile.interests.append(InterestTag(
                        tag=tag,
                        weight=interest_data.get("weight", 0.5),
                        source="auto_extract",
                    ))
            except Exception:
                continue

        # 处理习惯
        for habit_data in extracted.get("habits", []):
            try:
                action = habit_data.get("action", "")
                if action and not any(h.action == action for h in profile.habits):
                    profile.habits.append(HabitPattern(
                        action=action,
                        pattern=habit_data.get("pattern", ""),
                    ))
                    result.habits_detected += 1
            except Exception:
                continue

        # 处理基本信息
        for key, value in extracted.get("basic_info_updates", {}).items():
            if value:
                profile.basic_info[key] = value

        profile.updated_at = datetime.now()
        await self._save_profile(profile)

        return result

    # ============================================================
    # 内部方法
    # ============================================================

    async def _save_profile(self, profile: UserProfile) -> None:
        """保存画像到文档存储"""
        doc = {
            "user_id": profile.user_id,
            "basic_info": profile.basic_info,
            "preferences": [p.model_dump() for p in profile.preferences],
            "relationships": [r.model_dump() for r in profile.relationships],
            "interests": [i.model_dump() for i in profile.interests],
            "habits": [h.model_dump() for h in profile.habits],
        }
        await self.doc_repo.insert("user_profiles", doc)

    def _doc_to_profile(self, doc: dict) -> UserProfile:
        """将文档转换为 UserProfile 对象"""
        prefs = []
        for p in doc.get("preferences", []):
            if isinstance(p, dict):
                try:
                    prefs.append(UserPreference(**p))
                except Exception:
                    continue

        rels = []
        for r in doc.get("relationships", []):
            if isinstance(r, dict):
                try:
                    rels.append(PersonRelationship(**r))
                except Exception:
                    continue

        interests = []
        for i in doc.get("interests", []):
            if isinstance(i, dict):
                try:
                    interests.append(InterestTag(**i))
                except Exception:
                    continue

        habits = []
        for h in doc.get("habits", []):
            if isinstance(h, dict):
                try:
                    habits.append(HabitPattern(**h))
                except Exception:
                    continue

        return UserProfile(
            user_id=doc["user_id"],
            basic_info=doc.get("basic_info", {}),
            preferences=prefs,
            relationships=rels,
            interests=interests,
            habits=habits,
        )
