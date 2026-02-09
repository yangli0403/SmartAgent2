import sys
import os

# 添加当前目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 修改所有导入语句
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_config
from storage.factory import create_storage, StorageBundle
from services import LLMService, EmbeddingService
from core import (
    MemoryExtractor, MemoryRetriever, MemoryForgetter,
    MemoryManager, ProfileManager, CharacterManager,
    MemoryController,
)

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# 全局单例
_storage = None
_llm = None
_embedding = None
_controller = None
_memory_manager = None
_profile_manager = None
_character_manager = None
_forgetter = None


def _init_services():
    """初始化所有服务和组件"""
    global _storage, _llm, _embedding, _controller
    global _memory_manager, _profile_manager, _character_manager, _forgetter

    config = get_config()
    logger.info(f"初始化 SmartAgent2 v{config.app_version} [存储模式: {config.storage.storage_mode}]")

    # 存储层
    _storage = create_storage()

    # 服务层
    _llm = LLMService()
    _embedding = EmbeddingService()

    # 核心组件
    extractor = MemoryExtractor(
        llm=_llm, embedding=_embedding,
        vector_repo=_storage.vector,
        doc_repo=_storage.document,
        graph_repo=_storage.graph,
    )
    retriever = MemoryRetriever(
        llm=_llm, embedding=_embedding,
        vector_repo=_storage.vector,
        doc_repo=_storage.document,
        graph_repo=_storage.graph,
    )
    _forgetter = MemoryForgetter(
        embedding=_embedding,
        vector_repo=_storage.vector,
        doc_repo=_storage.document,
    )
    _memory_manager = MemoryManager(
        vector_repo=_storage.vector,
        doc_repo=_storage.document,
    )
    _profile_manager = ProfileManager(
        llm=_llm,
        doc_repo=_storage.document,
    )

    characters_dir = os.path.join(os.path.dirname(__file__), "characters")
    _character_manager = CharacterManager(
        doc_repo=_storage.document,
        characters_dir=characters_dir,
    )

    _controller = MemoryController(
        llm=_llm,
        embedding=_embedding,
        working_memory_repo=_storage.working_memory,
        extractor=extractor,
        retriever=retriever,
        forgetter=_forgetter,
        profile_manager=_profile_manager,
        character_manager=_character_manager,
        memory_manager=_memory_manager,
    )

    logger.info("所有服务初始化完成")


def get_controller():
    if _controller is None:
        _init_services()
    return _controller


def get_memory_manager():
    if _memory_manager is None:
        _init_services()
    return _memory_manager


def get_profile_manager():
    if _profile_manager is None:
        _init_services()
    return _profile_manager


def get_character_manager():
    if _character_manager is None:
        _init_services()
    return _character_manager


def get_forgetter():
    if _forgetter is None:
        _init_services()
    return _forgetter


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    _init_services()

    # 启动时自动加载 characters 目录下的所有人格配置
    try:
        loaded = await _character_manager.load_all_from_directory()
        logger.info(f"自动加载了 {len(loaded)} 个人格配置: {[c.name for c in loaded]}")
    except Exception as e:
        logger.error(f"自动加载人格配置失败: {e}")

    logger.info("SmartAgent2 启动完成")
    yield
    logger.info("SmartAgent2 正在关闭...")


app = FastAPI(
    title="SmartAgent2",
    description="AI 智能代理记忆系统 API（支持 ElizaOS Characterfile 兼容）",
    version="2.1.0",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
from api.routes.chat_routes import router as chat_router
from api.routes.memory_routes import router as memory_router
from api.routes.profile_routes import router as profile_router
from api.routes.character_routes import router as character_router
from api.routes.maintenance_routes import router as maintenance_router

app.include_router(chat_router)
app.include_router(memory_router)
app.include_router(profile_router)
app.include_router(character_router)
app.include_router(maintenance_router)


@app.get("/")
async def root():
    config = get_config()
    return {
        "name": config.app_name,
        "version": config.app_version,
        "docs": "/docs",
    }


@app.get("/api/v1/system/health")
async def health_check():
    """系统健康检查"""
    config = get_config()
    # 获取已加载的人格列表
    characters = []
    if _character_manager:
        try:
            chars = await _character_manager.list_characters()
            characters = [{"id": c.id, "name": c.name, "source_format": c.source_format} for c in chars]
        except Exception:
            pass
    return {
        "status": "healthy",
        "version": config.app_version,
        "storage_mode": config.storage.storage_mode,
        "loaded_characters": characters,
    }


if __name__ == "__main__":
    import uvicorn
    config = get_config()
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        reload=False,
    )
