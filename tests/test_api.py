"""
SmartAgent2 API 端到端测试
使用 FastAPI TestClient 测试所有 API 端点
"""
import json
import os
import sys
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 在导入 main 之前设置测试环境
os.environ["STORAGE_MODE"] = "local"
os.environ["SQLITE_DB_PATH"] = "test_api.db"

# 清理测试数据库
if os.path.exists("test_api.db"):
    os.remove("test_api.db")

from fastapi.testclient import TestClient


# Mock OpenAI 客户端
class MockCompletion:
    def __init__(self, content):
        self.choices = [MagicMock(message=MagicMock(content=content))]


class MockEmbeddingData:
    def __init__(self, embedding, index=0):
        self.embedding = embedding
        self.index = index


class MockEmbeddingResponse:
    def __init__(self, embeddings):
        self.data = [MockEmbeddingData(e, i) for i, e in enumerate(embeddings)]


class MockOpenAIClient:
    def __init__(self, **kwargs):
        self.chat = MagicMock()
        self.embeddings = MagicMock()

        # Mock chat completions
        def mock_create(**kwargs):
            messages = kwargs.get("messages", [])
            rf = kwargs.get("response_format")
            if rf and rf.get("type") == "json_object":
                # 判断是什么类型的 JSON 请求
                prompt = " ".join(m.get("content", "") for m in messages)
                if "提取记忆" in prompt or "记忆信息" in prompt:
                    return MockCompletion(json.dumps({
                        "episodic_memories": [{
                            "lossless_restatement": "用户喜欢听周杰伦的歌",
                            "summary": "喜欢周杰伦",
                            "keywords": ["周杰伦", "音乐"],
                            "event_type": "general_conversation",
                            "participants": [],
                            "importance": 0.7,
                            "confidence": 0.9,
                        }],
                        "semantic_memories": [{
                            "subject": "用户",
                            "predicate": "喜欢",
                            "object": "周杰伦的歌",
                            "category": "preference",
                            "confidence": 0.9,
                        }],
                    }))
                elif "意图" in prompt or "intent" in prompt:
                    return MockCompletion(json.dumps({
                        "intent": "music_preference",
                        "search_keywords": ["周杰伦", "音乐"],
                    }))
                elif "画像" in prompt or "profile" in prompt:
                    return MockCompletion(json.dumps({
                        "preferences": [{"category": "音乐", "key": "歌手", "value": "周杰伦"}],
                        "relationships": [],
                        "interests": [{"tag": "音乐", "weight": 0.8}],
                        "habits": [],
                        "basic_info_updates": {},
                    }))
                else:
                    return MockCompletion("{}")
            return MockCompletion("好的，我记住了你喜欢周杰伦的歌。需要我播放吗？")

        self.chat.completions.create = mock_create

        # Mock embeddings
        import hashlib
        def mock_embed(**kwargs):
            inputs = kwargs.get("input", "")
            if isinstance(inputs, str):
                inputs = [inputs]
            embeddings = []
            for text in inputs:
                h = hashlib.md5(text.encode()).hexdigest()
                vec = [int(h[i:i+2], 16) / 255.0 for i in range(0, 8, 2)]
                embeddings.append(vec)
            return MockEmbeddingResponse(embeddings)

        self.embeddings.create = mock_embed


# Patch OpenAI before importing main
with patch("openai.OpenAI", MockOpenAIClient):
    # 需要重新配置 embedding dimension 为 4（与 mock 一致）
    os.environ["EMBEDDING_DIMENSION"] = "4"
    from smartagent2.main import app

client = TestClient(app)


# ============================================================
# 系统接口测试
# ============================================================

class TestSystemAPI:
    def test_root(self):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data
        assert "version" in data

    def test_health(self):
        resp = client.get("/api/v1/system/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["storage_mode"] == "local"

    def test_config(self):
        resp = client.get("/api/v1/system/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "app_name" in data
        assert "llm_model" in data


# ============================================================
# 对话接口测试
# ============================================================

class TestChatAPI:
    def test_chat_basic(self):
        resp = client.post("/api/v1/chat", json={
            "user_id": "api_user_001",
            "session_id": "api_sess_001",
            "message": "我喜欢听周杰伦的歌",
            "options": {
                "include_memory": False,
                "include_profile": False,
            },
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "response" in data
        assert data["session_id"] == "api_sess_001"

    def test_chat_with_memory(self):
        resp = client.post("/api/v1/chat", json={
            "user_id": "api_user_001",
            "session_id": "api_sess_002",
            "message": "帮我播放周杰伦的歌",
            "options": {
                "include_memory": True,
                "include_profile": True,
                "max_memory_items": 5,
            },
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "response" in data


# ============================================================
# 记忆管理接口测试
# ============================================================

class TestMemoryAPI:
    def test_list_episodic_empty(self):
        resp = client.get("/api/v1/memory/episodic?user_id=api_user_new")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    def test_get_nonexistent_memory(self):
        resp = client.get("/api/v1/memory/episodic/nonexistent_id")
        assert resp.status_code == 404

    def test_stats(self):
        resp = client.get("/api/v1/memory/stats/api_user_001")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_episodic" in data
        assert "total_semantic" in data

    def test_export_json(self):
        resp = client.get("/api/v1/memory/export/api_user_001?format=json")
        assert resp.status_code == 200

    def test_export_csv(self):
        resp = client.get("/api/v1/memory/export/api_user_001?format=csv")
        assert resp.status_code == 200

    def test_clear_all(self):
        resp = client.delete("/api/v1/memory/clear/api_user_test_clear")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"

    def test_forgetting_cycle(self):
        resp = client.post("/api/v1/memory/forget/api_user_001")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_scanned" in data


# ============================================================
# 画像接口测试
# ============================================================

class TestProfileAPI:
    def test_get_profile(self):
        resp = client.get("/api/v1/profile/api_user_profile")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "api_user_profile"

    def test_update_profile(self):
        resp = client.put("/api/v1/profile/api_user_profile", json={
            "basic_info": {"name": "API测试用户", "age": 25},
            "preferences": [
                {"category": "音乐", "key": "genre", "value": "流行"}
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["basic_info"]["name"] == "API测试用户"

    def test_get_snapshot(self):
        resp = client.get("/api/v1/profile/api_user_profile/snapshot")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "api_user_profile"

    def test_delete_profile(self):
        # 先创建
        client.get("/api/v1/profile/api_user_del")
        resp = client.delete("/api/v1/profile/api_user_del")
        assert resp.status_code == 200


# ============================================================
# 人格配置接口测试
# ============================================================

class TestCharacterAPI:
    def test_create_character(self):
        resp = client.post("/api/v1/character/", json={
            "id": "api_test_char",
            "name": "API测试助手",
            "bio": ["我是API测试助手"],
            "adjectives": ["友好", "测试"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["character_id"] == "api_test_char"

    def test_get_character(self):
        resp = client.get("/api/v1/character/api_test_char")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "API测试助手"

    def test_list_characters(self):
        resp = client.get("/api/v1/character/")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_update_character(self):
        resp = client.put("/api/v1/character/api_test_char", json={
            "name": "更新后的助手",
        })
        assert resp.status_code == 200

    def test_delete_character(self):
        resp = client.delete("/api/v1/character/api_test_char")
        assert resp.status_code == 200

    def test_get_nonexistent_character(self):
        resp = client.get("/api/v1/character/nonexistent")
        assert resp.status_code == 404


# 清理
def teardown_module():
    if os.path.exists("test_api.db"):
        os.remove("test_api.db")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
