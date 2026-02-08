"""
SmartAgent2 存储工厂
根据环境变量 STORAGE_MODE 创建对应的存储实例
"""
from dataclasses import dataclass
from smartagent2.config import get_config
from smartagent2.storage.interfaces import (
    IWorkingMemoryRepo, IVectorRepo, IDocumentRepo, IGraphRepo,
)


@dataclass
class StorageBundle:
    """存储实例集合"""
    working_memory: IWorkingMemoryRepo
    vector: IVectorRepo
    document: IDocumentRepo
    graph: IGraphRepo


def create_storage() -> StorageBundle:
    """
    工厂函数：根据环境变量创建对应的存储实例。
    本地模式：TTLCache + sqlite-vec + SQLite JSON + SQLite 邻接表
    生产模式：Redis + Qdrant + MongoDB + Neo4j（预留）
    """
    config = get_config()
    mode = config.storage.storage_mode

    if mode == "local":
        db_path = config.storage.sqlite_db_path
        dimension = config.llm.embedding_dimension

        from smartagent2.storage.local.working_memory import LocalWorkingMemoryRepo
        from smartagent2.storage.local.vector_store import LocalVectorRepo
        from smartagent2.storage.local.document_store import LocalDocumentRepo
        from smartagent2.storage.local.graph_store import LocalGraphRepo

        return StorageBundle(
            working_memory=LocalWorkingMemoryRepo(
                maxsize=config.memory.working_memory_max_sessions,
                ttl=config.memory.working_memory_ttl,
            ),
            vector=LocalVectorRepo(db_path=db_path, dimension=dimension),
            document=LocalDocumentRepo(db_path=db_path),
            graph=LocalGraphRepo(db_path=db_path),
        )
    elif mode == "production":
        raise NotImplementedError(
            "生产模式存储尚未实现。请设置 STORAGE_MODE=local 使用本地模式。"
        )
    else:
        raise ValueError(f"不支持的存储模式: {mode}")
