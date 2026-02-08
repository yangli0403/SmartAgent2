"""
SmartAgent2 人格配置 API 路由
"""
from fastapi import APIRouter, HTTPException
from smartagent2.models import AgentCharacter

router = APIRouter(prefix="/api/v1/character", tags=["Character"])


def _get_character_manager():
    from smartagent2.main import get_character_manager
    return get_character_manager()


@router.get("/", response_model=list[AgentCharacter])
async def list_characters():
    """列出所有人格配置"""
    cm = _get_character_manager()
    return await cm.list_characters()


@router.get("/{character_id}")
async def get_character(character_id: str):
    """获取人格配置"""
    cm = _get_character_manager()
    char = await cm.get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="人格配置不存在")
    return char


@router.post("/", response_model=dict)
async def create_character(character: AgentCharacter):
    """创建人格配置"""
    cm = _get_character_manager()
    char_id = await cm.create_character(character)
    return {"status": "ok", "character_id": char_id}


@router.put("/{character_id}")
async def update_character(character_id: str, updates: dict):
    """更新人格配置"""
    cm = _get_character_manager()
    char = await cm.update_character(character_id, updates)
    if not char:
        raise HTTPException(status_code=404, detail="人格配置不存在")
    return char


@router.delete("/{character_id}")
async def delete_character(character_id: str):
    """删除人格配置"""
    cm = _get_character_manager()
    success = await cm.delete_character(character_id)
    if not success:
        raise HTTPException(status_code=404, detail="人格配置不存在")
    return {"status": "ok"}


@router.post("/load-all")
async def load_all_characters():
    """从目录加载所有人格配置"""
    cm = _get_character_manager()
    chars = await cm.load_all_from_directory()
    return {"status": "ok", "loaded": len(chars)}
