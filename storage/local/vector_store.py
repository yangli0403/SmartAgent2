"""
本地模式向量存储：使用 sqlite-vec 替代 Qdrant
"""
import json
import sqlite3
import struct
from typing import Any, Optional

import sqlite_vec

from smartagent2.models import VectorSearchResult
from smartagent2.storage.interfaces import IVectorRepo


def _serialize_f32(vector: list[float]) -> bytes:
    """将 float 列表序列化为 bytes（sqlite-vec 要求的格式）"""
    return struct.pack(f"{len(vector)}f", *vector)


class LocalVectorRepo(IVectorRepo):
    """基于 sqlite-vec 的向量存储"""

    def __init__(self, db_path: str = "smartagent2_dev.db", dimension: int = 1536):
        self.db_path = db_path
        self.dimension = dimension
        self.db = sqlite3.connect(db_path)
        self.db.enable_load_extension(True)
        sqlite_vec.load(self.db)
        self.db.enable_load_extension(False)
        self.db.row_factory = sqlite3.Row
        self._init_tables()

    def _init_tables(self):
        """初始化向量表和元数据表"""
        # 元数据表
        self.db.executescript(f"""
            CREATE TABLE IF NOT EXISTS vec_metadata (
                memory_id TEXT PRIMARY KEY,
                collection TEXT NOT NULL DEFAULT 'episodic',
                metadata_json TEXT NOT NULL DEFAULT '{{}}'
            );
            CREATE INDEX IF NOT EXISTS idx_vec_meta_collection
                ON vec_metadata(collection);
        """)
        # 向量虚拟表
        try:
            self.db.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0("
                f"  memory_id TEXT PRIMARY KEY,"
                f"  embedding float[{self.dimension}]"
                f")"
            )
        except sqlite3.OperationalError:
            pass  # 表已存在
        self.db.commit()

    async def upsert(self, memory_id: str, embedding: list[float],
                     metadata: dict[str, Any], collection: str = "episodic") -> None:
        vec_bytes = _serialize_f32(embedding)
        # 先尝试删除旧记录
        try:
            self.db.execute("DELETE FROM vec_memory WHERE memory_id = ?", (memory_id,))
        except Exception:
            pass
        # 插入向量
        self.db.execute(
            "INSERT INTO vec_memory (memory_id, embedding) VALUES (?, ?)",
            (memory_id, vec_bytes)
        )
        # 插入/更新元数据
        self.db.execute(
            "INSERT OR REPLACE INTO vec_metadata (memory_id, collection, metadata_json) "
            "VALUES (?, ?, ?)",
            (memory_id, collection, json.dumps(metadata, ensure_ascii=False, default=str))
        )
        self.db.commit()

    async def search(self, query_embedding: list[float], top_k: int = 10,
                     collection: str = "episodic",
                     filters: Optional[dict[str, Any]] = None,
                     score_threshold: float = 0.0) -> list[VectorSearchResult]:
        vec_bytes = _serialize_f32(query_embedding)
        fetch_k = top_k * 3  # 多取一些用于后续过滤
        # sqlite-vec vec0 要求 k=? 约束必须在虚拟表查询中
        # 先从 vec0 取出 top-k 候选，再 JOIN 元数据
        rows = self.db.execute(
            "SELECT v.memory_id, v.distance "
            "FROM vec_memory v "
            "WHERE v.embedding MATCH ? AND k = ?",
            (vec_bytes, fetch_k)
        ).fetchall()

        results = []
        for row in rows:
            memory_id = row[0]
            distance = row[1]
            # sqlite-vec 返回的是 L2 距离，转换为相似度分数 (0-1)
            score = max(0.0, 1.0 / (1.0 + distance))

            if score < score_threshold:
                continue

            # 查询元数据
            meta_row = self.db.execute(
                "SELECT metadata_json FROM vec_metadata WHERE memory_id = ? AND collection = ?",
                (memory_id, collection)
            ).fetchone()
            if meta_row is None:
                continue

            metadata = json.loads(meta_row[0]) if meta_row[0] else {}

            # 应用元数据过滤
            if filters:
                match = True
                for k, v in filters.items():
                    if metadata.get(k) != v:
                        match = False
                        break
                if not match:
                    continue

            results.append(VectorSearchResult(
                memory_id=memory_id,
                score=min(score, 1.0),
                metadata=metadata,
            ))

            if len(results) >= top_k:
                break

        return results

    async def delete(self, memory_id: str, collection: str = "episodic") -> bool:
        try:
            self.db.execute("DELETE FROM vec_memory WHERE memory_id = ?", (memory_id,))
            self.db.execute("DELETE FROM vec_metadata WHERE memory_id = ?", (memory_id,))
            self.db.commit()
            return True
        except Exception:
            return False

    async def batch_upsert(self, items: list[tuple[str, list[float], dict[str, Any]]],
                           collection: str = "episodic") -> int:
        count = 0
        for memory_id, embedding, metadata in items:
            try:
                await self.upsert(memory_id, embedding, metadata, collection)
                count += 1
            except Exception:
                continue
        return count

    def close(self):
        """关闭数据库连接"""
        self.db.close()
