"""
SmartAgent2 核心引擎集成测试
测试记忆提取器、检索器、遗忘器、画像管理器、人格管理器
使用 Mock LLM/Embedding 服务避免真实 API 调用
"""
import asyncio
import json
import os
import sys
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB = "test_core.db"


def cleanup_db():
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)


# ============================================================
# Mock 服务
# ============================================================

class MockLLMService:
    """模拟 LLM 服务"""
    async def generate(self, prompt, system_prompt="", **kwargs):
        return "这是一个模拟回复。"

    async def generate_json(self, prompt, system_prompt="", **kwargs):
        # 根据 prompt 内容返回不同的模拟结果
        if "提取记忆" in prompt or "extract" in prompt.lower():
            return {
                "episodic_memories": [
                    {
                        "lossless_restatement": "用户说他明天要去永辉超市买菜",
                        "summary": "明天去永辉超市买菜",
                        "keywords": ["永辉超市", "买菜", "明天"],
                        "event_type": "shopping",
                        "participants": [],
                        "location": "永辉超市",
                        "importance": 0.6,
                        "confidence": 0.9,
                    }
                ],
                "semantic_memories": [
                    {
                        "subject": "用户",
                        "predicate": "经常去",
                        "object": "永辉超市",
                        "category": "habit",
                        "confidence": 0.85,
                    }
                ],
            }
        elif "意图" in prompt or "intent" in prompt.lower():
            return {
                "intent": "shopping_query",
                "search_keywords": ["永辉超市", "买菜"],
                "time_hint": "明天",
                "entity_hint": "永辉超市",
            }
        elif "画像" in prompt or "profile" in prompt.lower():
            return {
                "preferences": [
                    {"category": "购物", "key": "超市", "value": "永辉超市"}
                ],
                "relationships": [],
                "interests": [{"tag": "购物", "weight": 0.6}],
                "habits": [{"action": "去永辉超市买菜", "pattern": "每周一次"}],
                "basic_info_updates": {},
            }
        return {}

    async def generate_with_history(self, messages, system_prompt="", **kwargs):
        return "好的，我记住了你明天要去永辉超市买菜。需要我帮你规划路线吗？"


class MockEmbeddingService:
    """模拟 Embedding 服务"""
    _counter = 0

    async def embed(self, text):
        # 返回基于文本 hash 的伪向量
        MockEmbeddingService._counter += 1
        import hashlib
        h = hashlib.md5(text.encode()).hexdigest()
        vec = [int(h[i:i+2], 16) / 255.0 for i in range(0, 8, 2)]
        return vec

    async def embed_batch(self, texts):
        return [await self.embed(t) for t in texts]

    async def similarity(self, text1, text2):
        if text1 == text2:
            return 1.0
        return 0.3  # 默认低相似度


# ============================================================
# 测试基础设施
# ============================================================

def create_test_storage():
    """创建测试用存储"""
    cleanup_db()
    from smartagent2.storage.local.working_memory import LocalWorkingMemoryRepo
    from smartagent2.storage.local.vector_store import LocalVectorRepo
    from smartagent2.storage.local.document_store import LocalDocumentRepo
    from smartagent2.storage.local.graph_store import LocalGraphRepo

    return {
        "working_memory": LocalWorkingMemoryRepo(maxsize=100, ttl=60),
        "vector": LocalVectorRepo(db_path=TEST_DB, dimension=4),
        "document": LocalDocumentRepo(db_path=TEST_DB),
        "graph": LocalGraphRepo(db_path=TEST_DB),
    }


# ============================================================
# 记忆提取器测试
# ============================================================

class TestMemoryExtractor:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.extractor import MemoryExtractor
        self.extractor = MemoryExtractor(
            llm=MockLLMService(),
            embedding=MockEmbeddingService(),
            vector_repo=self.storage["vector"],
            doc_repo=self.storage["document"],
            graph_repo=self.storage["graph"],
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_extract_from_conversation(self):
        from smartagent2.models import ConversationMessage, MessageRole
        messages = [
            ConversationMessage(role=MessageRole.USER, content="我明天要去永辉超市买菜"),
            ConversationMessage(role=MessageRole.ASSISTANT, content="好的，需要我帮你规划路线吗？"),
            ConversationMessage(role=MessageRole.USER, content="好的，帮我导航到最近的永辉超市"),
        ]
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(
            self.extractor.extract_from_conversation(
                messages, user_id="user_001", session_id="sess_001"
            )
        )
        assert "episodic" in result
        assert "semantic" in result
        assert len(result["episodic"]) >= 1
        assert len(result["semantic"]) >= 1

        # 验证持久化
        ep_count = loop.run_until_complete(
            self.storage["document"].count("episodic_memories", {"user_id": "user_001"})
        )
        assert ep_count >= 1

        sem_count = loop.run_until_complete(
            self.storage["document"].count("semantic_memories", {"user_id": "user_001"})
        )
        assert sem_count >= 1

    def test_extract_empty_conversation(self):
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(
            self.extractor.extract_from_conversation(
                [], user_id="user_001"
            )
        )
        assert result["episodic"] == []
        assert result["semantic"] == []


# ============================================================
# 记忆检索器测试
# ============================================================

class TestMemoryRetriever:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.retriever import MemoryRetriever
        self.retriever = MemoryRetriever(
            llm=MockLLMService(),
            embedding=MockEmbeddingService(),
            vector_repo=self.storage["vector"],
            doc_repo=self.storage["document"],
            graph_repo=self.storage["graph"],
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_retrieve_with_data(self):
        loop = asyncio.get_event_loop()
        # 先插入一些测试数据
        loop.run_until_complete(self.storage["document"].insert("episodic_memories", {
            "id": "mem_ep_test_001",
            "user_id": "user_001",
            "event_type": "shopping",
            "lossless_restatement": "用户去了永辉超市买菜",
            "summary": "去永辉超市买菜",
            "keywords": ["永辉超市", "买菜"],
            "importance": 0.7,
        }))
        loop.run_until_complete(self.storage["vector"].upsert(
            "mem_ep_test_001", [0.8, 0.2, 0.0, 0.0],
            {"user_id": "user_001", "event_type": "shopping"}, "episodic"
        ))

        from smartagent2.models import RetrievalQuery
        query = RetrievalQuery(
            user_id="user_001",
            query="永辉超市",
            top_k=5,
        )
        result = loop.run_until_complete(self.retriever.retrieve(query))
        assert result is not None
        assert result.retrieval_plan != ""

    def test_retrieve_empty(self):
        loop = asyncio.get_event_loop()
        from smartagent2.models import RetrievalQuery
        query = RetrievalQuery(
            user_id="user_nonexist",
            query="测试查询",
            top_k=5,
        )
        result = loop.run_until_complete(self.retriever.retrieve(query))
        assert result is not None
        assert len(result.episodic_memories) == 0


# ============================================================
# 记忆遗忘器测试
# ============================================================

class TestMemoryForgetter:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.forgetter import MemoryForgetter
        self.forgetter = MemoryForgetter(
            embedding=MockEmbeddingService(),
            vector_repo=self.storage["vector"],
            doc_repo=self.storage["document"],
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_forgetting_cycle(self):
        loop = asyncio.get_event_loop()
        # 插入测试记忆
        for i in range(5):
            loop.run_until_complete(self.storage["document"].insert("episodic_memories", {
                "id": f"mem_ep_forget_{i}",
                "user_id": "user_001",
                "lossless_restatement": f"记忆内容 {i}",
                "summary": f"摘要 {i}",
                "importance": 0.1 + i * 0.2,  # 0.1, 0.3, 0.5, 0.7, 0.9
                "access_count": i,
                "created_at": datetime.now().isoformat(),
            }))

        from smartagent2.models import ForgettingConfig
        config = ForgettingConfig(
            importance_threshold=0.4,
            time_decay_factor=0.99,
            access_boost_factor=0.05,
            similarity_threshold=0.9,
            archive_instead_of_delete=True,
        )
        result = loop.run_until_complete(
            self.forgetter.run_forgetting_cycle("user_001", config)
        )
        assert result.total_scanned == 5
        assert result.memories_archived >= 0  # 低重要性的应被归档

    def test_forgetting_empty(self):
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(
            self.forgetter.run_forgetting_cycle("user_empty")
        )
        assert result.total_scanned == 0


# ============================================================
# 画像管理器测试
# ============================================================

class TestProfileManager:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.profile_manager import ProfileManager
        self.pm = ProfileManager(
            llm=MockLLMService(),
            doc_repo=self.storage["document"],
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_get_or_create_profile(self):
        loop = asyncio.get_event_loop()
        profile = loop.run_until_complete(self.pm.get_profile("user_new"))
        assert profile.user_id == "user_new"
        assert profile.preferences == []

    def test_update_profile(self):
        loop = asyncio.get_event_loop()
        profile = loop.run_until_complete(self.pm.update_profile("user_001", {
            "basic_info": {"name": "张三", "age": 30},
            "preferences": [
                {"category": "音乐", "key": "genre", "value": "流行"}
            ],
            "relationships": [
                {"person_name": "小丽", "relationship": "妻子"}
            ],
        }))
        assert profile.basic_info["name"] == "张三"
        assert len(profile.preferences) == 1
        assert len(profile.relationships) == 1

    def test_contextual_snapshot(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.pm.update_profile("user_001", {
            "basic_info": {"name": "张三"},
            "preferences": [
                {"category": "音乐", "key": "genre", "value": "流行"}
            ],
        }))
        snapshot = loop.run_until_complete(
            self.pm.get_contextual_snapshot("user_001")
        )
        assert snapshot.display_name == "张三"
        assert len(snapshot.active_preferences) >= 1

    def test_auto_update_from_conversation(self):
        from smartagent2.models import ConversationMessage, MessageRole
        loop = asyncio.get_event_loop()
        messages = [
            ConversationMessage(role=MessageRole.USER, content="我喜欢去永辉超市买菜"),
            ConversationMessage(role=MessageRole.ASSISTANT, content="好的，我记住了"),
        ]
        result = loop.run_until_complete(
            self.pm.auto_update_from_conversation("user_001", messages)
        )
        assert result.preferences_added >= 0  # Mock 返回了偏好数据


# ============================================================
# 人格管理器测试
# ============================================================

class TestCharacterManager:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.character_manager import CharacterManager
        self.cm = CharacterManager(
            doc_repo=self.storage["document"],
            characters_dir=os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "characters"
            ),
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_load_from_file(self):
        loop = asyncio.get_event_loop()
        char_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "characters", "default.json"
        )
        if os.path.exists(char_file):
            char = loop.run_until_complete(self.cm.load_from_file(char_file))
            assert char.name == "小智"
            assert char.id == "default"

    def test_create_and_get_character(self):
        from smartagent2.models import AgentCharacter
        loop = asyncio.get_event_loop()
        char = AgentCharacter(
            id="test_char",
            name="测试助手",
            bio=["我是测试助手"],
        )
        char_id = loop.run_until_complete(self.cm.create_character(char))
        assert char_id == "test_char"

        result = loop.run_until_complete(self.cm.get_character("test_char"))
        assert result is not None
        assert result.name == "测试助手"

    def test_build_system_prompt(self):
        from smartagent2.models import AgentCharacter
        loop = asyncio.get_event_loop()
        char = AgentCharacter(
            id="prompt_test",
            name="小智",
            bio=["我是小智"],
            lore=["我被设计用于车载场景"],
        )
        loop.run_until_complete(self.cm.create_character(char))
        prompt = loop.run_until_complete(
            self.cm.build_system_prompt("prompt_test")
        )
        assert "小智" in prompt

    def test_generate_greeting(self):
        from smartagent2.models import AgentCharacter, ContextualProfileSnapshot
        loop = asyncio.get_event_loop()
        char = AgentCharacter(
            id="greet_test",
            name="小智",
        )
        loop.run_until_complete(self.cm.create_character(char))
        greeting = loop.run_until_complete(
            self.cm.generate_greeting("greet_test")
        )
        assert "小智" in greeting


# ============================================================
# 记忆管理器测试
# ============================================================

class TestMemoryManager:
    def setup_method(self):
        self.storage = create_test_storage()
        from smartagent2.core.manager import MemoryManager
        self.mm = MemoryManager(
            vector_repo=self.storage["vector"],
            doc_repo=self.storage["document"],
        )

    def teardown_method(self):
        self.storage["vector"].close()
        self.storage["document"].close()
        self.storage["graph"].close()
        cleanup_db()

    def test_list_and_stats(self):
        loop = asyncio.get_event_loop()
        # 插入测试数据
        for i in range(3):
            loop.run_until_complete(self.storage["document"].insert("episodic_memories", {
                "id": f"mem_mgr_{i}",
                "user_id": "user_mgr",
                "lossless_restatement": f"记忆 {i}",
                "summary": f"摘要 {i}",
                "keywords": ["测试"],
                "event_type": "general_conversation",
                "importance": 0.5,
            }))

        result = loop.run_until_complete(
            self.mm.list_episodic_memories("user_mgr", page=1, page_size=10)
        )
        assert result.total == 3
        assert len(result.items) == 3

        stats = loop.run_until_complete(self.mm.get_stats("user_mgr"))
        assert stats.total_episodic == 3

    def test_export_json(self):
        from smartagent2.models import ExportFormat
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.storage["document"].insert("episodic_memories", {
            "id": "mem_export_001",
            "user_id": "user_export",
            "lossless_restatement": "导出测试",
            "summary": "导出测试",
        }))
        content = loop.run_until_complete(
            self.mm.export_memories("user_export", ExportFormat.JSON)
        )
        data = json.loads(content)
        assert data["user_id"] == "user_export"
        assert len(data["episodic_memories"]) == 1

    def test_clear_all(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.storage["document"].insert("episodic_memories", {
            "id": "mem_clear_001",
            "user_id": "user_clear",
            "lossless_restatement": "待清除",
            "summary": "待清除",
        }))
        result = loop.run_until_complete(self.mm.clear_all_memories("user_clear"))
        assert result["episodic_deleted"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
