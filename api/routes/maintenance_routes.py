"""
SmartAgent2 系统维护 API 路由
"""
from fastapi import APIRouter
from smartagent2.config import get_config

router = APIRouter(prefix="/api/v1/system", tags=["System"])


@router.get("/health")
async def health_check():
    """健康检查"""
    config = get_config()
    return {
        "status": "healthy",
        "app_name": config.app_name,
        "version": config.app_version,
        "storage_mode": config.storage.storage_mode,
    }


@router.get("/config")
async def get_system_config():
    """获取系统配置（脱敏）"""
    config = get_config()
    return {
        "app_name": config.app_name,
        "version": config.app_version,
        "storage_mode": config.storage.storage_mode,
        "llm_model": config.llm.llm_model,
        "embedding_model": config.llm.embedding_model,
        "embedding_dimension": config.llm.embedding_dimension,
        "working_memory_ttl": config.memory.working_memory_ttl,
        "extraction_window_size": config.memory.extraction_window_size,
        "retrieval_top_k": config.memory.retrieval_top_k,
    }
