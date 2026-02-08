"""
本地模式文档存储：使用 SQLite JSON 字段替代 MongoDB
"""
import json
import sqlite3
from datetime import datetime
from typing import Any, Optional

from smartagent2.storage.interfaces import IDocumentRepo


class LocalDocumentRepo(IDocumentRepo):
    """基于 SQLite 的文档存储"""

    def __init__(self, db_path: str = "smartagent2_dev.db"):
        self.db_path = db_path
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self._init_tables()

    def _init_tables(self):
        """初始化文档表"""
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS episodic_memories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                agent_id TEXT DEFAULT 'default',
                session_id TEXT,
                event_type TEXT DEFAULT 'general_conversation',
                lossless_restatement TEXT,
                summary TEXT,
                keywords TEXT DEFAULT '[]',
                participants TEXT DEFAULT '[]',
                location TEXT,
                temporal_context TEXT,
                importance REAL DEFAULT 0.5,
                access_count INTEGER DEFAULT 0,
                last_accessed_at TEXT,
                confidence REAL DEFAULT 0.8,
                source_session_id TEXT,
                is_archived INTEGER DEFAULT 0,
                is_compressed INTEGER DEFAULT 0,
                merged_from TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS semantic_memories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                agent_id TEXT DEFAULT 'default',
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                object TEXT NOT NULL,
                category TEXT DEFAULT 'fact',
                confidence REAL DEFAULT 0.8,
                source TEXT DEFAULT 'dialogue_extraction',
                valid_from TEXT,
                valid_until TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                basic_info TEXT NOT NULL DEFAULT '{}',
                preferences TEXT NOT NULL DEFAULT '[]',
                relationships TEXT NOT NULL DEFAULT '[]',
                interests TEXT NOT NULL DEFAULT '[]',
                habits TEXT NOT NULL DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS agent_characters (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_episodic_user
                ON episodic_memories(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_episodic_type
                ON episodic_memories(event_type);
            CREATE INDEX IF NOT EXISTS idx_episodic_archived
                ON episodic_memories(is_archived);
            CREATE INDEX IF NOT EXISTS idx_semantic_user
                ON semantic_memories(user_id, category);
            CREATE INDEX IF NOT EXISTS idx_semantic_subject
                ON semantic_memories(subject);
        """)

        # 创建 FTS5 全文搜索虚拟表
        try:
            self.db.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
                    id UNINDEXED,
                    lossless_restatement,
                    summary,
                    keywords,
                    content=episodic_memories,
                    content_rowid=rowid
                )
            """)
        except sqlite3.OperationalError:
            pass
        self.db.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> dict:
        """将 SQLite Row 转换为字典，自动解析 JSON 字段"""
        d = dict(row)
        json_fields = ("keywords", "participants", "temporal_context", "merged_from",
                        "basic_info", "preferences", "relationships", "interests",
                        "habits", "data")
        for key in json_fields:
            if key in d and isinstance(d[key], str):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        # 转换布尔字段
        for key in ("is_archived", "is_compressed"):
            if key in d:
                d[key] = bool(d[key])
        return d

    # ============================================================
    # IDocumentRepo 接口实现
    # ============================================================

    async def insert(self, collection: str, document: dict) -> str:
        doc_id = document.get("id", "")
        if collection == "episodic_memories":
            self.db.execute(
                """INSERT OR REPLACE INTO episodic_memories
                   (id, user_id, agent_id, session_id, event_type,
                    lossless_restatement, summary, keywords, participants,
                    location, temporal_context, importance, access_count,
                    confidence, source_session_id, is_archived, is_compressed,
                    merged_from, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    doc_id,
                    document.get("user_id", ""),
                    document.get("agent_id", "default"),
                    document.get("source_session_id"),
                    document.get("event_type", "general_conversation"),
                    document.get("lossless_restatement", ""),
                    document.get("summary", ""),
                    json.dumps(document.get("keywords", []), ensure_ascii=False),
                    json.dumps(document.get("participants", []), ensure_ascii=False),
                    document.get("location"),
                    json.dumps(document.get("temporal_context"), ensure_ascii=False, default=str)
                        if document.get("temporal_context") else None,
                    document.get("importance", 0.5),
                    document.get("access_count", 0),
                    document.get("confidence", 0.8),
                    document.get("source_session_id"),
                    int(document.get("is_archived", False)),
                    int(document.get("is_compressed", False)),
                    json.dumps(document.get("merged_from", []), ensure_ascii=False),
                    document.get("created_at", datetime.now().isoformat()),
                    document.get("updated_at", datetime.now().isoformat()),
                )
            )
            # 更新 FTS 索引
            try:
                self.db.execute(
                    "INSERT OR REPLACE INTO episodic_fts(rowid, id, lossless_restatement, summary, keywords) "
                    "SELECT rowid, id, lossless_restatement, summary, keywords FROM episodic_memories WHERE id = ?",
                    (doc_id,)
                )
            except Exception:
                pass
        elif collection == "semantic_memories":
            self.db.execute(
                """INSERT OR REPLACE INTO semantic_memories
                   (id, user_id, agent_id, subject, predicate, object,
                    category, confidence, source, valid_from, valid_until,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    doc_id,
                    document.get("user_id", ""),
                    document.get("agent_id", "default"),
                    document.get("subject", ""),
                    document.get("predicate", ""),
                    document.get("object", ""),
                    document.get("category", "fact"),
                    document.get("confidence", 0.8),
                    document.get("source", "dialogue_extraction"),
                    document.get("valid_from"),
                    document.get("valid_until"),
                    document.get("created_at", datetime.now().isoformat()),
                    document.get("updated_at", datetime.now().isoformat()),
                )
            )
        elif collection == "user_profiles":
            self.db.execute(
                """INSERT OR REPLACE INTO user_profiles
                   (user_id, basic_info, preferences, relationships, interests, habits, updated_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    document.get("user_id", ""),
                    json.dumps(document.get("basic_info", {}), ensure_ascii=False),
                    json.dumps(document.get("preferences", []), ensure_ascii=False, default=str),
                    json.dumps(document.get("relationships", []), ensure_ascii=False, default=str),
                    json.dumps(document.get("interests", []), ensure_ascii=False, default=str),
                    json.dumps(document.get("habits", []), ensure_ascii=False, default=str),
                    datetime.now().isoformat(),
                )
            )
            doc_id = document.get("user_id", "")
        elif collection == "agent_characters":
            self.db.execute(
                "INSERT OR REPLACE INTO agent_characters (id, data, updated_at) VALUES (?,?,?)",
                (doc_id, json.dumps(document, ensure_ascii=False, default=str),
                 datetime.now().isoformat())
            )
        self.db.commit()
        return doc_id

    async def find_by_id(self, collection: str, doc_id: str) -> Optional[dict]:
        table = collection
        id_col = "user_id" if collection == "user_profiles" else "id"
        row = self.db.execute(
            f"SELECT * FROM {table} WHERE {id_col} = ?", (doc_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    async def find(self, collection: str, query: dict[str, Any],
                   sort_by: str = "created_at", sort_order: str = "desc",
                   skip: int = 0, limit: int = 20) -> list[dict]:
        table = collection
        conditions = []
        params: list = []
        for k, v in query.items():
            if v is not None:
                conditions.append(f"{k} = ?")
                params.append(v)

        sql = f"SELECT * FROM {table}"
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        sql += f" ORDER BY {sort_by} {sort_order} LIMIT ? OFFSET ?"
        params.extend([limit, skip])

        rows = self.db.execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def update(self, collection: str, doc_id: str, updates: dict) -> bool:
        table = collection
        id_col = "user_id" if collection == "user_profiles" else "id"
        set_clauses = []
        params = []
        for key, value in updates.items():
            if key in ("id", "user_id"):
                continue
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, default=str)
            elif isinstance(value, bool):
                value = int(value)
            set_clauses.append(f"{key} = ?")
            params.append(value)

        if not set_clauses:
            return False

        set_clauses.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(doc_id)

        self.db.execute(
            f"UPDATE {table} SET {', '.join(set_clauses)} WHERE {id_col} = ?",
            params
        )
        self.db.commit()
        return self.db.total_changes > 0

    async def delete(self, collection: str, doc_id: str) -> bool:
        table = collection
        id_col = "user_id" if collection == "user_profiles" else "id"
        self.db.execute(f"DELETE FROM {table} WHERE {id_col} = ?", (doc_id,))
        self.db.commit()
        return self.db.total_changes > 0

    async def count(self, collection: str, query: dict[str, Any]) -> int:
        table = collection
        conditions = []
        params: list = []
        for k, v in query.items():
            if v is not None:
                conditions.append(f"{k} = ?")
                params.append(v)
        sql = f"SELECT COUNT(*) FROM {table}"
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        row = self.db.execute(sql, params).fetchone()
        return row[0] if row else 0

    async def full_text_search(self, collection: str, search_text: str,
                               fields: list[str], limit: int = 10) -> list[dict]:
        if collection == "episodic_memories":
            try:
                rows = self.db.execute(
                    "SELECT e.* FROM episodic_fts f "
                    "JOIN episodic_memories e ON f.id = e.id "
                    "WHERE episodic_fts MATCH ? "
                    "LIMIT ?",
                    (search_text, limit)
                ).fetchall()
                return [self._row_to_dict(r) for r in rows]
            except Exception:
                # FTS 失败时回退到 LIKE 搜索
                pass

        # 回退：LIKE 搜索
        conditions = []
        params: list = []
        for field in fields:
            conditions.append(f"{field} LIKE ?")
            params.append(f"%{search_text}%")
        sql = f"SELECT * FROM {collection} WHERE {' OR '.join(conditions)} LIMIT ?"
        params.append(limit)
        rows = self.db.execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def close(self):
        self.db.close()
