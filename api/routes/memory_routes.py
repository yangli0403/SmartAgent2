"""
SmartAgent2 记忆管理 API 路由
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from smartagent2.models import (
    MemoryFilter, PaginatedResult, MemoryStats,
    ExportFormat, ForgettingConfig, ForgettingResult,
)

router = APIRouter(prefix="/api/v1/memory", tags=["Memory Management"])


def _get_manager():
    from smartagent2.main import get_memory_manager
    return get_memory_manager()


def _get_forgetter():
    from smartagent2.main import get_forgetter
    return get_forgetter()


# ============================================================
# 情景记忆
# ============================================================

@router.get("/episodic/{memory_id}")
async def get_episodic_memory(memory_id: str):
    """获取单条情景记忆"""
    manager = _get_manager()
    result = await manager.get_episodic_memory(memory_id)
    if not result:
        raise HTTPException(status_code=404, detail="记忆不存在")
    return result


@router.get("/episodic", response_model=PaginatedResult)
async def list_episodic_memories(
    user_id: str = Query(..., description="用户ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    event_type: Optional[str] = None,
    min_importance: Optional[float] = None,
):
    """分页列出情景记忆"""
    manager = _get_manager()
    filters = MemoryFilter(
        event_type=event_type,
        min_importance=min_importance,
    )
    return await manager.list_episodic_memories(user_id, page, page_size, filters)


@router.put("/episodic/{memory_id}")
async def update_episodic_memory(memory_id: str, updates: dict):
    """更新情景记忆"""
    manager = _get_manager()
    success = await manager.update_episodic_memory(memory_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="更新失败")
    return {"status": "ok", "memory_id": memory_id}


@router.delete("/episodic/{memory_id}")
async def delete_episodic_memory(memory_id: str):
    """删除情景记忆"""
    manager = _get_manager()
    success = await manager.delete_episodic_memory(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="删除失败")
    return {"status": "ok", "memory_id": memory_id}


# ============================================================
# 语义记忆
# ============================================================

@router.get("/semantic/{memory_id}")
async def get_semantic_memory(memory_id: str):
    """获取单条语义记忆"""
    manager = _get_manager()
    result = await manager.get_semantic_memory(memory_id)
    if not result:
        raise HTTPException(status_code=404, detail="记忆不存在")
    return result


@router.get("/semantic", response_model=PaginatedResult)
async def list_semantic_memories(
    user_id: str = Query(..., description="用户ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: Optional[str] = None,
):
    """分页列出语义记忆"""
    manager = _get_manager()
    return await manager.list_semantic_memories(user_id, page, page_size, category)


@router.delete("/semantic/{memory_id}")
async def delete_semantic_memory(memory_id: str):
    """删除语义记忆"""
    manager = _get_manager()
    success = await manager.delete_semantic_memory(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="删除失败")
    return {"status": "ok", "memory_id": memory_id}


# ============================================================
# 统计与导出
# ============================================================

@router.get("/stats/{user_id}", response_model=MemoryStats)
async def get_memory_stats(user_id: str):
    """获取记忆统计"""
    manager = _get_manager()
    return await manager.get_stats(user_id)


@router.get("/export/{user_id}")
async def export_memories(
    user_id: str,
    format: ExportFormat = Query(ExportFormat.JSON),
):
    """导出用户记忆"""
    manager = _get_manager()
    from fastapi.responses import Response
    content = await manager.export_memories(user_id, format)
    media_type = "application/json" if format == ExportFormat.JSON else "text/csv"
    filename = f"memories_{user_id}.{format.value}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ============================================================
# 遗忘与清理
# ============================================================

@router.post("/forget/{user_id}", response_model=ForgettingResult)
async def run_forgetting(user_id: str, config: Optional[ForgettingConfig] = None):
    """执行遗忘周期"""
    forgetter = _get_forgetter()
    return await forgetter.run_forgetting_cycle(user_id, config)


@router.delete("/clear/{user_id}")
async def clear_all_memories(user_id: str):
    """清除用户所有记忆"""
    manager = _get_manager()
    result = await manager.clear_all_memories(user_id)
    return {"status": "ok", **result}
