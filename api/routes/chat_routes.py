"""
SmartAgent2 对话 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException

from smartagent2.models import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/v1", tags=["Chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """核心对话接口"""
    from smartagent2.main import get_controller
    controller = get_controller()
    try:
        return await controller.chat(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"对话处理失败: {str(e)}")
