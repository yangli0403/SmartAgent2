"""
SmartAgent2 用户画像 API 路由
"""
from fastapi import APIRouter, HTTPException
from smartagent2.models import UserProfile, UserPreference, ContextualProfileSnapshot

router = APIRouter(prefix="/api/v1/profile", tags=["User Profile"])


def _get_profile_manager():
    from smartagent2.main import get_profile_manager
    return get_profile_manager()


@router.get("/{user_id}", response_model=UserProfile)
async def get_profile(user_id: str):
    """获取用户画像"""
    pm = _get_profile_manager()
    return await pm.get_profile(user_id)


@router.put("/{user_id}", response_model=UserProfile)
async def update_profile(user_id: str, updates: dict):
    """更新用户画像"""
    pm = _get_profile_manager()
    return await pm.update_profile(user_id, updates)


@router.delete("/{user_id}")
async def delete_profile(user_id: str):
    """删除用户画像"""
    pm = _get_profile_manager()
    success = await pm.delete_profile(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="画像不存在")
    return {"status": "ok"}


@router.post("/{user_id}/preference", response_model=UserProfile)
async def add_preference(user_id: str, preference: UserPreference):
    """添加偏好"""
    pm = _get_profile_manager()
    return await pm.add_preference(user_id, preference)


@router.delete("/{user_id}/preference/{preference_id}")
async def remove_preference(user_id: str, preference_id: str):
    """移除偏好"""
    pm = _get_profile_manager()
    await pm.remove_preference(user_id, preference_id)
    return {"status": "ok"}


@router.get("/{user_id}/snapshot", response_model=ContextualProfileSnapshot)
async def get_snapshot(user_id: str, context: str = ""):
    """获取上下文化画像快照"""
    pm = _get_profile_manager()
    return await pm.get_contextual_snapshot(user_id, context)
