"""
本地模式图存储：使用 SQLite 邻接表替代 Neo4j
"""
import json
import sqlite3
from collections import deque
from typing import Any, Optional

from smartagent2.models import GraphNode, GraphEdge
from smartagent2.storage.interfaces import IGraphRepo


class LocalGraphRepo(IGraphRepo):
    """基于 SQLite 邻接表的图存储"""

    def __init__(self, db_path: str = "smartagent2_dev.db"):
        self.db_path = db_path
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self._init_tables()

    def _init_tables(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS graph_nodes (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                properties TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS graph_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                weight REAL DEFAULT 1.0,
                properties TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (source_id) REFERENCES graph_nodes(id),
                FOREIGN KEY (target_id) REFERENCES graph_nodes(id)
            );
            CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_relation ON graph_edges(relation_type);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
                ON graph_edges(source_id, target_id, relation_type);
        """)
        self.db.commit()

    def _row_to_node(self, row: sqlite3.Row) -> GraphNode:
        props = json.loads(row["properties"]) if row["properties"] else {}
        return GraphNode(id=row["id"], label=row["label"], properties=props)

    def _row_to_edge(self, row: sqlite3.Row) -> GraphEdge:
        props = json.loads(row["properties"]) if row["properties"] else {}
        return GraphEdge(
            source_id=row["source_id"],
            target_id=row["target_id"],
            relation_type=row["relation_type"],
            weight=row["weight"],
            properties=props,
        )

    async def add_node(self, node: GraphNode) -> str:
        self.db.execute(
            "INSERT OR REPLACE INTO graph_nodes (id, label, properties) VALUES (?, ?, ?)",
            (node.id, node.label, json.dumps(node.properties, ensure_ascii=False))
        )
        self.db.commit()
        return node.id

    async def add_edge(self, edge: GraphEdge) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO graph_edges (source_id, target_id, relation_type, weight, properties) "
            "VALUES (?, ?, ?, ?, ?)",
            (edge.source_id, edge.target_id, edge.relation_type, edge.weight,
             json.dumps(edge.properties, ensure_ascii=False))
        )
        self.db.commit()

    async def get_node(self, node_id: str) -> Optional[GraphNode]:
        row = self.db.execute(
            "SELECT * FROM graph_nodes WHERE id = ?", (node_id,)
        ).fetchone()
        return self._row_to_node(row) if row else None

    async def get_neighbors(self, node_id: str,
                            relation_type: Optional[str] = None,
                            direction: str = "both",
                            max_depth: int = 1) -> list[dict]:
        if max_depth > 1:
            return self._bfs_neighbors(node_id, relation_type, direction, max_depth)

        results = []
        if direction in ("outgoing", "both"):
            sql = ("SELECT n.*, e.relation_type as edge_relation, "
                   "e.properties as edge_props, e.weight as edge_weight "
                   "FROM graph_edges e JOIN graph_nodes n ON e.target_id = n.id "
                   "WHERE e.source_id = ?")
            params: list = [node_id]
            if relation_type:
                sql += " AND e.relation_type = ?"
                params.append(relation_type)
            rows = self.db.execute(sql, params).fetchall()
            for r in rows:
                results.append({
                    "node": self._row_to_node(r).model_dump(),
                    "relation": r["edge_relation"],
                    "direction": "outgoing",
                    "weight": r["edge_weight"],
                })

        if direction in ("incoming", "both"):
            sql = ("SELECT n.*, e.relation_type as edge_relation, "
                   "e.properties as edge_props, e.weight as edge_weight "
                   "FROM graph_edges e JOIN graph_nodes n ON e.source_id = n.id "
                   "WHERE e.target_id = ?")
            params = [node_id]
            if relation_type:
                sql += " AND e.relation_type = ?"
                params.append(relation_type)
            rows = self.db.execute(sql, params).fetchall()
            for r in rows:
                results.append({
                    "node": self._row_to_node(r).model_dump(),
                    "relation": r["edge_relation"],
                    "direction": "incoming",
                    "weight": r["edge_weight"],
                })

        return results

    def _bfs_neighbors(self, node_id: str, relation_type: Optional[str],
                       direction: str, max_depth: int) -> list[dict]:
        """BFS 多层邻居遍历"""
        visited = {node_id}
        queue = deque([(node_id, 0)])
        results = []

        while queue:
            current, depth = queue.popleft()
            if depth >= max_depth:
                continue

            # 获取直接邻居
            neighbors = []
            if direction in ("outgoing", "both"):
                sql = "SELECT target_id, relation_type, weight FROM graph_edges WHERE source_id = ?"
                params: list = [current]
                if relation_type:
                    sql += " AND relation_type = ?"
                    params.append(relation_type)
                neighbors.extend([(r["target_id"], r["relation_type"], r["weight"], "outgoing")
                                  for r in self.db.execute(sql, params).fetchall()])

            if direction in ("incoming", "both"):
                sql = "SELECT source_id, relation_type, weight FROM graph_edges WHERE target_id = ?"
                params = [current]
                if relation_type:
                    sql += " AND relation_type = ?"
                    params.append(relation_type)
                neighbors.extend([(r["source_id"], r["relation_type"], r["weight"], "incoming")
                                  for r in self.db.execute(sql, params).fetchall()])

            for nid, rel, weight, dir_ in neighbors:
                if nid not in visited:
                    visited.add(nid)
                    node_row = self.db.execute(
                        "SELECT * FROM graph_nodes WHERE id = ?", (nid,)
                    ).fetchone()
                    if node_row:
                        results.append({
                            "node": self._row_to_node(node_row).model_dump(),
                            "relation": rel,
                            "direction": dir_,
                            "weight": weight,
                            "depth": depth + 1,
                        })
                    queue.append((nid, depth + 1))

        return results

    async def find_path(self, start_id: str, end_id: str,
                        max_depth: int = 5) -> Optional[list[str]]:
        visited = {start_id}
        queue = deque([(start_id, [start_id])])
        while queue:
            current, path = queue.popleft()
            if len(path) > max_depth + 1:
                continue
            if current == end_id:
                return path
            rows = self.db.execute(
                "SELECT target_id FROM graph_edges WHERE source_id = ?", (current,)
            ).fetchall()
            for row in rows:
                nid = row["target_id"]
                if nid not in visited:
                    visited.add(nid)
                    queue.append((nid, path + [nid]))
        return None

    async def delete_node(self, node_id: str, cascade: bool = True) -> bool:
        if cascade:
            self.db.execute(
                "DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?",
                (node_id, node_id)
            )
        self.db.execute("DELETE FROM graph_nodes WHERE id = ?", (node_id,))
        self.db.commit()
        return self.db.total_changes > 0

    async def delete_edge(self, source_id: str, target_id: str,
                          relation_type: Optional[str] = None) -> bool:
        if relation_type:
            self.db.execute(
                "DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = ?",
                (source_id, target_id, relation_type)
            )
        else:
            self.db.execute(
                "DELETE FROM graph_edges WHERE source_id = ? AND target_id = ?",
                (source_id, target_id)
            )
        self.db.commit()
        return self.db.total_changes > 0

    async def query_subgraph(self, center_node_id: str, max_depth: int = 2,
                             relation_types: Optional[list[str]] = None
                             ) -> tuple[list[GraphNode], list[GraphEdge]]:
        # BFS 收集子图
        visited_nodes = {center_node_id}
        queue = deque([(center_node_id, 0)])
        nodes = []
        edges = []

        center = await self.get_node(center_node_id)
        if center:
            nodes.append(center)

        while queue:
            current, depth = queue.popleft()
            if depth >= max_depth:
                continue

            sql = "SELECT * FROM graph_edges WHERE source_id = ? OR target_id = ?"
            params: list = [current, current]
            rows = self.db.execute(sql, params).fetchall()

            for row in rows:
                edge = self._row_to_edge(row)
                if relation_types and edge.relation_type not in relation_types:
                    continue
                edges.append(edge)

                other_id = edge.target_id if edge.source_id == current else edge.source_id
                if other_id not in visited_nodes:
                    visited_nodes.add(other_id)
                    node = await self.get_node(other_id)
                    if node:
                        nodes.append(node)
                    queue.append((other_id, depth + 1))

        return nodes, edges

    def close(self):
        self.db.close()
