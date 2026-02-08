"""
SmartAgent2 人格管理器 (CharacterManager)
v2.1.0: 增加 ElizaOS Characterfile 导入支持，增强 System Prompt 构建
"""
import json
import logging
import os
import random
from datetime import datetime
from typing import Any, Optional

from smartagent2.models import (
    AgentCharacter, ContextualProfileSnapshot,
    ProactiveRule, MessageExample, KnowledgeItem,
    DialogueStyle, ModelSettings, VoiceConfig,
    generate_id,
)
from smartagent2.storage.interfaces import IDocumentRepo

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT_TEMPLATE = """你是 {name}。

## 关于你
{bio}

## 背景故事
{lore}

## 性格特征
{adjectives}

## 专长领域
{topics}

## 对话风格
{style}

## 专属知识
{knowledge}

## 用户信息
{user_context}

## 相关记忆
{memory_context}

请根据以上信息，以你的人格特征与用户进行自然对话。"""


class CharacterManager:
    """AI 人格管理器 (v2.1.0: 支持 ElizaOS Characterfile 导入)"""

    def __init__(self, doc_repo: IDocumentRepo,
                 characters_dir: str = "characters"):
        self.doc_repo = doc_repo
        self.characters_dir = characters_dir
        self._cache: dict[str, AgentCharacter] = {}

    # ============================================================
    # CRUD 操作
    # ============================================================

    async def get_character(self, character_id: str) -> Optional[AgentCharacter]:
        """获取人格配置"""
        # 先查缓存
        if character_id in self._cache:
            return self._cache[character_id]

        # 查数据库
        doc = await self.doc_repo.find_by_id("agent_characters", character_id)
        if doc:
            data = doc.get("data", doc)
            if isinstance(data, str):
                data = json.loads(data)
            try:
                character = AgentCharacter(**data)
                self._cache[character_id] = character
                return character
            except Exception as e:
                logger.error(f"解析人格配置失败: {e}")
                return None
        return None

    async def create_character(self, character: AgentCharacter) -> str:
        """创建人格配置"""
        doc = character.model_dump()
        doc["id"] = character.id
        await self.doc_repo.insert("agent_characters", doc)
        self._cache[character.id] = character
        return character.id

    async def update_character(self, character_id: str, updates: dict) -> Optional[AgentCharacter]:
        """更新人格配置"""
        character = await self.get_character(character_id)
        if not character:
            return None

        char_dict = character.model_dump()
        char_dict.update(updates)
        char_dict["updated_at"] = datetime.now().isoformat()

        updated = AgentCharacter(**char_dict)
        doc = updated.model_dump()
        doc["id"] = character_id
        await self.doc_repo.insert("agent_characters", doc)
        self._cache[character_id] = updated
        return updated

    async def delete_character(self, character_id: str) -> bool:
        """删除人格配置"""
        self._cache.pop(character_id, None)
        return await self.doc_repo.delete("agent_characters", character_id)

    async def list_characters(self) -> list[AgentCharacter]:
        """列出所有人格配置"""
        docs = await self.doc_repo.find("agent_characters", {}, limit=100)
        characters = []
        for doc in docs:
            data = doc.get("data", doc)
            if isinstance(data, str):
                data = json.loads(data)
            try:
                characters.append(AgentCharacter(**data))
            except Exception:
                continue
        return characters

    # ============================================================
    # 从文件加载
    # ============================================================

    async def load_from_file(self, filepath: str) -> AgentCharacter:
        """从 JSON 文件加载人格配置（自动检测格式：native 或 ElizaOS）"""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 检测是否为 ElizaOS 格式
        if self._is_elizaos_format(data):
            logger.info(f"检测到 ElizaOS Characterfile 格式: {filepath}")
            character = self._convert_from_elizaos(data)
        else:
            if "id" not in data:
                data["id"] = generate_id("char_")
            character = AgentCharacter(**data)

        await self.create_character(character)
        logger.info(f"从文件加载人格配置: {character.name} ({character.id}) [格式: {character.source_format or 'native'}]")
        return character

    async def load_all_from_directory(self) -> list[AgentCharacter]:
        """从目录加载所有人格配置文件"""
        characters = []
        if not os.path.exists(self.characters_dir):
            logger.warning(f"人格配置目录不存在: {self.characters_dir}")
            return characters

        for filename in os.listdir(self.characters_dir):
            if filename.endswith(".json"):
                filepath = os.path.join(self.characters_dir, filename)
                try:
                    char = await self.load_from_file(filepath)
                    characters.append(char)
                except Exception as e:
                    logger.error(f"加载人格配置失败 [{filename}]: {e}")
        return characters

    # ============================================================
    # ElizaOS Characterfile 格式检测与转换
    # ============================================================

    def _is_elizaos_format(self, data: dict) -> bool:
        """
        检测是否为 ElizaOS Characterfile 格式。
        ElizaOS 格式的特征：
        - 有 messageExamples（驼峰命名）而非 message_examples
        - 有 postExamples 字段
        - 有 modelProvider 字段
        - messageExamples 中的元素包含 user/content 结构
        """
        elizaos_indicators = [
            "messageExamples" in data,
            "postExamples" in data,
            "modelProvider" in data,
        ]
        # 如果有2个以上 ElizaOS 特征字段，判定为 ElizaOS 格式
        return sum(elizaos_indicators) >= 2

    def _convert_from_elizaos(self, data: dict) -> AgentCharacter:
        """
        将 ElizaOS Characterfile 格式转换为 SmartAgent2 AgentCharacter 格式。
        字段映射规则：
        - name -> name
        - bio (string|string[]) -> bio (list[str])
        - lore -> lore
        - system -> system
        - messageExamples -> message_examples (格式转换)
        - postExamples -> post_examples
        - adjectives -> adjectives
        - topics -> topics
        - knowledge -> knowledge (格式转换)
        - style.all/chat/post -> style.all/chat/post
        - clients -> clients
        - modelProvider -> model_provider
        - settings.voice -> settings.voice
        """
        char_id = data.get("id", generate_id("char_"))
        name = data.get("name", "Unknown")

        # bio: 支持 string 或 string[]
        bio_raw = data.get("bio", [])
        if isinstance(bio_raw, str):
            bio = [bio_raw]
        else:
            bio = list(bio_raw)

        # lore
        lore = data.get("lore", [])

        # system prompt
        system = data.get("system", None)

        # style 转换
        style_raw = data.get("style", {})
        style = DialogueStyle(
            all=style_raw.get("all", []),
            chat=style_raw.get("chat", []),
            post=style_raw.get("post", []),
            voice=[],
        )

        # messageExamples 转换
        # ElizaOS 格式: [[{user, content: {text, action?}}, ...], ...]
        # SmartAgent2 格式: [[{role, content}, ...], ...]
        message_examples = []
        for conversation in data.get("messageExamples", []):
            converted_conv = []
            for msg in conversation:
                user = msg.get("user", "")
                content_raw = msg.get("content", {})
                text = content_raw.get("text", "") if isinstance(content_raw, dict) else str(content_raw)
                # 判断角色
                role = "assistant" if user == name or user == data.get("name", "") else "user"
                if text:
                    converted_conv.append(MessageExample(role=role, content=text))
            if converted_conv:
                message_examples.append(converted_conv)

        # postExamples
        post_examples = data.get("postExamples", [])

        # adjectives
        adjectives = data.get("adjectives", [])

        # topics
        topics = data.get("topics", [])

        # knowledge 转换
        # ElizaOS 格式: [{id, path, content}, ...] 或 [string, ...]
        knowledge = []
        for item in data.get("knowledge", []):
            if isinstance(item, str):
                knowledge.append(KnowledgeItem(
                    content=item,
                    category="general",
                ))
            elif isinstance(item, dict):
                knowledge.append(KnowledgeItem(
                    id=item.get("id", generate_id("know_")),
                    content=item.get("content", ""),
                    category=item.get("category", "general"),
                ))

        # clients
        clients = data.get("clients", [])

        # modelProvider
        model_provider = data.get("modelProvider", None)

        # settings 转换
        settings_raw = data.get("settings", {})
        voice_raw = settings_raw.get("voice", None)
        voice_config = None
        if voice_raw and isinstance(voice_raw, dict) and voice_raw.get("model"):
            voice_config = VoiceConfig(model=voice_raw.get("model", "tts-1"))

        model_name = settings_raw.get("model", "gpt-4o")
        embedding_model = settings_raw.get("embeddingModel", "text-embedding-3-small")

        settings = ModelSettings(
            model=model_name,
            embedding_model=embedding_model,
            voice=voice_config,
        )

        return AgentCharacter(
            id=char_id,
            name=name,
            bio=bio,
            lore=lore,
            system=system,
            style=style,
            message_examples=message_examples,
            post_examples=post_examples,
            adjectives=adjectives,
            topics=topics,
            knowledge=knowledge,
            clients=clients,
            model_provider=model_provider,
            settings=settings,
            source_format="elizaos",
        )

    # ============================================================
    # System Prompt 构建 (v2.1.0 增强)
    # ============================================================

    async def build_system_prompt(
        self, character_id: str,
        user_context: Optional[ContextualProfileSnapshot] = None,
        memory_context: str = "",
    ) -> str:
        """
        构建完整的 System Prompt。
        v2.1.0 增强：
        - 优先使用 character.system 字段（ElizaOS 兼容）
        - 注入 adjectives、topics、knowledge 等扩展信息
        - 支持 bio/lore 随机采样以增加回复多样性
        """
        character = await self.get_character(character_id)
        if not character:
            return "你是一个友好的 AI 助手。"

        # 如果有 ElizaOS 风格的 system prompt，优先使用并增强
        if character.system:
            return self._build_enhanced_system_prompt(
                character, user_context, memory_context
            )

        # 使用模板构建
        template = character.system_prompt_template or DEFAULT_SYSTEM_PROMPT_TEMPLATE

        # 构建各部分内容（支持随机采样以增加多样性）
        bio_items = character.bio if len(character.bio) <= 5 else random.sample(character.bio, 5)
        bio_text = "\n".join(f"- {b}" for b in bio_items) if bio_items else "一个友好的 AI 助手"

        lore_items = character.lore if len(character.lore) <= 5 else random.sample(character.lore, 5)
        lore_text = "\n".join(f"- {l}" for l in lore_items) if lore_items else "暂无背景故事"

        # 形容词
        adj_text = "、".join(character.adjectives[:8]) if character.adjectives else "友好、智能"

        # 话题领域
        topics_text = "、".join(character.topics[:10]) if character.topics else "通用对话"

        # 对话风格
        style_parts = []
        if character.style.all:
            style_parts.extend(character.style.all)
        if character.style.chat:
            style_parts.extend(character.style.chat)
        style_text = "\n".join(f"- {s}" for s in style_parts) if style_parts else "自然、友好"

        # 知识库
        knowledge_items = character.knowledge[:5] if character.knowledge else []
        knowledge_text = "\n".join(f"- {k.content}" for k in knowledge_items) if knowledge_items else "暂无专属知识"

        # 用户上下文
        user_text = self._format_user_context(user_context)

        prompt = template.format(
            name=character.name,
            bio=bio_text,
            lore=lore_text,
            adjectives=adj_text,
            topics=topics_text,
            style=style_text,
            knowledge=knowledge_text,
            user_context=user_text,
            memory_context=memory_context or "暂无相关记忆",
        )

        return prompt

    def _build_enhanced_system_prompt(
        self, character: AgentCharacter,
        user_context: Optional[ContextualProfileSnapshot] = None,
        memory_context: str = "",
    ) -> str:
        """
        基于 ElizaOS system 字段构建增强的 System Prompt。
        将 system 作为核心指令，附加 bio/lore/style/knowledge 等上下文。
        """
        parts = [character.system]

        # 附加 bio 信息
        if character.bio:
            bio_items = character.bio if len(character.bio) <= 5 else random.sample(character.bio, 5)
            parts.append("\n## 背景信息")
            parts.extend(f"- {b}" for b in bio_items)

        # 附加 lore 信息
        if character.lore:
            lore_items = character.lore if len(character.lore) <= 4 else random.sample(character.lore, 4)
            parts.append("\n## 背景故事")
            parts.extend(f"- {l}" for l in lore_items)

        # 附加风格指令
        style_items = character.style.all + character.style.chat
        if style_items:
            parts.append("\n## 对话风格")
            parts.extend(f"- {s}" for s in style_items[:8])

        # 附加知识
        if character.knowledge:
            knowledge_items = character.knowledge[:5]
            parts.append("\n## 专属知识")
            parts.extend(f"- {k.content}" for k in knowledge_items)

        # 附加话题领域
        if character.topics:
            parts.append(f"\n## 专长领域：{'、'.join(character.topics[:10])}")

        # 附加用户上下文
        user_text = self._format_user_context(user_context)
        if user_text != "暂无用户信息":
            parts.append(f"\n## 用户信息\n{user_text}")

        # 附加记忆上下文
        if memory_context:
            parts.append(f"\n## 相关记忆\n{memory_context}")

        return "\n".join(parts)

    def _format_user_context(
        self, user_context: Optional[ContextualProfileSnapshot]
    ) -> str:
        """格式化用户上下文"""
        if not user_context:
            return "暂无用户信息"

        parts = []
        if user_context.display_name:
            parts.append(f"用户称呼: {user_context.display_name}")
        for pref in user_context.active_preferences[:5]:
            parts.append(f"偏好: {pref.category}/{pref.key} = {pref.value}")
        for rel in user_context.relevant_relationships[:3]:
            parts.append(f"关系: {rel.person_name} ({rel.relationship})")
        return "\n".join(parts) if parts else "暂无用户信息"

    # ============================================================
    # 主动服务规则匹配
    # ============================================================

    async def match_proactive_rules(
        self, character_id: str,
        trigger: str,
        context: dict[str, Any] = None,
    ) -> list[ProactiveRule]:
        """匹配主动服务规则"""
        character = await self.get_character(character_id)
        if not character or not character.vehicle_config:
            return []

        matched = []
        for rule in character.vehicle_config.proactive_service_rules:
            if trigger.lower() in rule.trigger.lower():
                # 检查附加条件
                if rule.condition and context:
                    try:
                        # 简单条件评估
                        if not self._evaluate_condition(rule.condition, context):
                            continue
                    except Exception:
                        continue
                matched.append(rule)

        # 按优先级排序
        matched.sort(key=lambda r: r.priority, reverse=True)
        return matched

    def _evaluate_condition(self, condition: str, context: dict) -> bool:
        """简单条件评估"""
        # 支持简单的 key=value 条件
        for part in condition.split(" AND "):
            part = part.strip()
            if "=" in part:
                key, value = part.split("=", 1)
                if str(context.get(key.strip(), "")) != value.strip():
                    return False
        return True

    # ============================================================
    # 问候语生成
    # ============================================================

    async def generate_greeting(
        self, character_id: str,
        user_context: Optional[ContextualProfileSnapshot] = None,
    ) -> str:
        """生成问候语"""
        character = await self.get_character(character_id)
        if not character:
            return "你好！有什么可以帮你的吗？"

        if character.vehicle_config and character.vehicle_config.greeting_templates:
            template = character.vehicle_config.greeting_templates[0]
            if user_context and user_context.display_name:
                return template.replace("{user_name}", user_context.display_name)
            return template.replace("{user_name}", "")

        name = character.name
        if user_context and user_context.display_name:
            return f"你好，{user_context.display_name}！我是{name}，有什么可以帮你的吗？"
        return f"你好！我是{name}，有什么可以帮你的吗？"
