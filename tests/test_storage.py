"""
SmartAgent2 存储层单元测试
覆盖本地模式下的所有四个存储实现
"""
import asyncio
import os
import sys
import pytest

# 确保项目根目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from smartagent2.models import (
    WorkingMemory, ConversationMessage, MessageRole,
    GraphNode, GraphEdge,
)
from smartagent2.storage.local.working_memory import LocalWorkingMemoryRepo
from smartagent2.storage.local.vector_store import LocalVectorRepo
from smartagent2.storage.local.document_store import LocalDocumentRepo
from smartagent2.storage.local.graph_store import LocalGraphRepo

TEST_DB = "test_smartagent2.db"


# ============================================================
# 工作记忆测试
# ============================================================

class TestWorkingMemory:
    def setup_method(self):
        self.repo = LocalWorkingMemoryRepo(maxsize=100, ttl=60)

    def test_save_and_get_session(self):
        session = WorkingMemory(session_id="sess_001", user_id="user_001")
        asyncio.get_event_loop().run_until_complete(self.repo.save_session(session))
        result = asyncio.get_event_loop().run_until_complete(self.repo.get_session("sess_001"))
        assert result is not None
        assert result.session_id == "sess_001"
        assert result.user_id == "user_001"

    def test_get_nonexistent_session(self):
        result = asyncio.get_event_loop().run_until_complete(self.repo.get_session("nonexistent"))
        assert result is None

    def test_append_message(self):
        session = WorkingMemory(session_id="sess_002", user_id="user_001")
        asyncio.get_event_loop().run_until_complete(self.repo.save_session(session))
        msg = ConversationMessage(role=MessageRole.USER, content="你好")
        asyncio.get_event_loop().run_until_complete(self.repo.append_message("sess_002", msg))
        result = asyncio.get_event_loop().run_until_complete(self.repo.get_session("sess_002"))
        assert len(result.messages) == 1
        assert result.messages[0].content == "你好"

    def test_delete_session(self):
        session = WorkingMemory(session_id="sess_003", user_id="user_001")
        asyncio.get_event_loop().run_until_complete(self.repo.save_session(session))
        deleted = asyncio.get_event_loop().run_until_complete(self.repo.delete_session("sess_003"))
        assert deleted is True
        result = asyncio.get_event_loop().run_until_complete(self.repo.get_session("sess_003"))
        assert result is None

    def test_list_active_sessions(self):
        s1 = WorkingMemory(session_id="sess_a", user_id="user_002")
        s2 = WorkingMemory(session_id="sess_b", user_id="user_002")
        asyncio.get_event_loop().run_until_complete(self.repo.save_session(s1))
        asyncio.get_event_loop().run_until_complete(self.repo.save_session(s2))
        active = asyncio.get_event_loop().run_until_complete(
            self.repo.list_active_sessions("user_002"))
        assert set(active) == {"sess_a", "sess_b"}


# ============================================================
# 向量存储测试
# ============================================================

class TestVectorStore:
    def setup_method(self):
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)
        self.repo = LocalVectorRepo(db_path=TEST_DB, dimension=4)

    def teardown_method(self):
        self.repo.close()
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)

    def test_upsert_and_search(self):
        loop = asyncio.get_event_loop()
        # 插入向量
        loop.run_until_complete(self.repo.upsert(
            "mem_001", [1.0, 0.0, 0.0, 0.0],
            {"user_id": "user_001", "event_type": "navigation"}, "episodic"
        ))
        loop.run_until_complete(self.repo.upsert(
            "mem_002", [0.0, 1.0, 0.0, 0.0],
            {"user_id": "user_001", "event_type": "music"}, "episodic"
        ))
        # 搜索
        results = loop.run_until_complete(self.repo.search(
            [0.9, 0.1, 0.0, 0.0], top_k=2, collection="episodic"
        ))
        assert len(results) >= 1
        assert results[0].memory_id == "mem_001"

    def test_search_with_filter(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.upsert(
            "mem_003", [1.0, 0.0, 0.0, 0.0],
            {"user_id": "user_001"}, "episodic"
        ))
        loop.run_until_complete(self.repo.upsert(
            "mem_004", [1.0, 0.1, 0.0, 0.0],
            {"user_id": "user_002"}, "episodic"
        ))
        results = loop.run_until_complete(self.repo.search(
            [1.0, 0.0, 0.0, 0.0], top_k=5, collection="episodic",
            filters={"user_id": "user_001"}
        ))
        assert all(r.metadata.get("user_id") == "user_001" for r in results)

    def test_delete(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.upsert(
            "mem_005", [1.0, 0.0, 0.0, 0.0], {"user_id": "u1"}, "episodic"
        ))
        deleted = loop.run_until_complete(self.repo.delete("mem_005", "episodic"))
        assert deleted is True


# ============================================================
# 文档存储测试
# ============================================================

class TestDocumentStore:
    def setup_method(self):
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)
        self.repo = LocalDocumentRepo(db_path=TEST_DB)

    def teardown_method(self):
        self.repo.close()
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)

    def test_insert_and_find_episodic(self):
        loop = asyncio.get_event_loop()
        doc = {
            "id": "mem_ep_001",
            "user_id": "user_001",
            "event_type": "navigation",
            "lossless_restatement": "用户去了永辉超市",
            "summary": "去永辉超市",
            "keywords": ["永辉超市", "购物"],
            "importance": 0.7,
        }
        doc_id = loop.run_until_complete(self.repo.insert("episodic_memories", doc))
        assert doc_id == "mem_ep_001"

        result = loop.run_until_complete(self.repo.find_by_id("episodic_memories", "mem_ep_001"))
        assert result is not None
        assert result["summary"] == "去永辉超市"
        assert result["keywords"] == ["永辉超市", "购物"]

    def test_query_with_filter(self):
        loop = asyncio.get_event_loop()
        for i in range(5):
            loop.run_until_complete(self.repo.insert("episodic_memories", {
                "id": f"mem_ep_{i:03d}",
                "user_id": "user_001",
                "event_type": "navigation" if i % 2 == 0 else "music_playback",
                "lossless_restatement": f"记忆 {i}",
                "summary": f"摘要 {i}",
                "importance": 0.5 + i * 0.1,
            }))
        results = loop.run_until_complete(self.repo.find(
            "episodic_memories",
            {"user_id": "user_001", "event_type": "navigation"},
            limit=10
        ))
        assert len(results) == 3

    def test_update_episodic(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.insert("episodic_memories", {
            "id": "mem_ep_upd",
            "user_id": "user_001",
            "lossless_restatement": "原始内容",
            "summary": "原始摘要",
            "importance": 0.5,
        }))
        updated = loop.run_until_complete(self.repo.update(
            "episodic_memories", "mem_ep_upd",
            {"summary": "更新后的摘要", "importance": 0.9}
        ))
        assert updated is True
        result = loop.run_until_complete(self.repo.find_by_id("episodic_memories", "mem_ep_upd"))
        assert result["summary"] == "更新后的摘要"
        assert result["importance"] == 0.9

    def test_delete_episodic(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.insert("episodic_memories", {
            "id": "mem_ep_del",
            "user_id": "user_001",
            "lossless_restatement": "待删除",
            "summary": "待删除",
        }))
        deleted = loop.run_until_complete(self.repo.delete("episodic_memories", "mem_ep_del"))
        assert deleted is True

    def test_count(self):
        loop = asyncio.get_event_loop()
        for i in range(3):
            loop.run_until_complete(self.repo.insert("episodic_memories", {
                "id": f"mem_cnt_{i}",
                "user_id": "user_cnt",
                "lossless_restatement": f"内容 {i}",
                "summary": f"摘要 {i}",
            }))
        count = loop.run_until_complete(self.repo.count("episodic_memories", {"user_id": "user_cnt"}))
        assert count == 3

    def test_user_profile_crud(self):
        loop = asyncio.get_event_loop()
        profile = {
            "user_id": "user_profile_001",
            "basic_info": {"name": "张三", "occupation": "工程师"},
            "preferences": [{"id": "pref_1", "category": "音乐", "key": "genre", "value": "流行"}],
            "relationships": [{"person_name": "小丽", "relationship": "妻子"}],
        }
        loop.run_until_complete(self.repo.insert("user_profiles", profile))
        result = loop.run_until_complete(self.repo.find_by_id("user_profiles", "user_profile_001"))
        assert result is not None
        assert result["basic_info"]["name"] == "张三"

    def test_semantic_memory_crud(self):
        loop = asyncio.get_event_loop()
        doc = {
            "id": "mem_sem_001",
            "user_id": "user_001",
            "subject": "用户",
            "predicate": "妻子名字是",
            "object": "小丽",
            "category": "relationship",
        }
        loop.run_until_complete(self.repo.insert("semantic_memories", doc))
        result = loop.run_until_complete(self.repo.find_by_id("semantic_memories", "mem_sem_001"))
        assert result is not None
        assert result["object"] == "小丽"


# ============================================================
# 图存储测试
# ============================================================

class TestGraphStore:
    def setup_method(self):
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)
        self.repo = LocalGraphRepo(db_path=TEST_DB)

    def teardown_method(self):
        self.repo.close()
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)

    def test_add_and_get_node(self):
        loop = asyncio.get_event_loop()
        node = GraphNode(id="user_001", label="Person", properties={"name": "张三"})
        loop.run_until_complete(self.repo.add_node(node))
        result = loop.run_until_complete(self.repo.get_node("user_001"))
        assert result is not None
        assert result.label == "Person"
        assert result.properties["name"] == "张三"

    def test_add_edge_and_get_neighbors(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="u1", label="Person", properties={"name": "张三"})))
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="loc1", label="Location", properties={"name": "永辉超市"})))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="u1", target_id="loc1", relation_type="VISITED")))

        neighbors = loop.run_until_complete(
            self.repo.get_neighbors("u1", direction="outgoing"))
        assert len(neighbors) == 1
        assert neighbors[0]["node"]["id"] == "loc1"

    def test_find_path(self):
        loop = asyncio.get_event_loop()
        for nid in ["a", "b", "c", "d"]:
            loop.run_until_complete(self.repo.add_node(
                GraphNode(id=nid, label="Node")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="a", target_id="b", relation_type="LINK")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="b", target_id="c", relation_type="LINK")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="c", target_id="d", relation_type="LINK")))

        path = loop.run_until_complete(self.repo.find_path("a", "d"))
        assert path == ["a", "b", "c", "d"]

    def test_delete_node_cascade(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="x", label="Node")))
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="y", label="Node")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="x", target_id="y", relation_type="REL")))
        deleted = loop.run_until_complete(self.repo.delete_node("x", cascade=True))
        assert deleted is True

    def test_query_subgraph(self):
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="center", label="Person")))
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="n1", label="Location")))
        loop.run_until_complete(self.repo.add_node(
            GraphNode(id="n2", label="Person")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="center", target_id="n1", relation_type="VISITED")))
        loop.run_until_complete(self.repo.add_edge(
            GraphEdge(source_id="center", target_id="n2", relation_type="KNOWS")))

        nodes, edges = loop.run_until_complete(
            self.repo.query_subgraph("center", max_depth=1))
        assert len(nodes) == 3
        assert len(edges) == 2


# ============================================================
# 存储工厂测试
# ============================================================

class TestStorageFactory:
    def test_create_local_storage(self):
        os.environ["STORAGE_MODE"] = "local"
        os.environ["SQLITE_DB_PATH"] = TEST_DB
        from smartagent2.storage.factory import create_storage
        bundle = create_storage()
        assert bundle.working_memory is not None
        assert bundle.vector is not None
        assert bundle.document is not None
        assert bundle.graph is not None
        # 清理
        bundle.vector.close()
        bundle.document.close()
        bundle.graph.close()
        if os.path.exists(TEST_DB):
            os.remove(TEST_DB)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
