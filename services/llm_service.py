"""
SmartAgent2 LLM 服务封装
统一调用 OpenAI-compatible API 进行文本生成
"""
import json
import logging
from typing import Any, Optional

from openai import OpenAI

from smartagent2.config import get_config

logger = logging.getLogger(__name__)


class LLMService:
    """LLM 文本生成服务"""

    def __init__(self, config=None):
        self.config = config or get_config().llm
        kwargs = {}
        if self.config.openai_api_key:
            kwargs["api_key"] = self.config.openai_api_key
        if self.config.openai_base_url:
            kwargs["base_url"] = self.config.openai_base_url
        self.client = OpenAI(**kwargs)
        self.model = self.config.llm_model

    async def generate(self, prompt: str, system_prompt: str = "",
                       temperature: Optional[float] = None,
                       max_tokens: Optional[int] = None,
                       response_format: Optional[dict] = None) -> str:
        """生成文本回复"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature or self.config.temperature,
            "max_tokens": max_tokens or self.config.max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = self.client.chat.completions.create(**kwargs)
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"LLM 生成失败: {e}")
            raise

    async def generate_json(self, prompt: str, system_prompt: str = "",
                            temperature: Optional[float] = None) -> dict:
        """生成 JSON 格式回复"""
        result = await self.generate(
            prompt=prompt,
            system_prompt=system_prompt + "\n请以 JSON 格式回复，不要包含 markdown 代码块标记。",
            temperature=temperature or 0.3,
            response_format={"type": "json_object"},
        )
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            # 尝试提取 JSON 部分
            start = result.find("{")
            end = result.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(result[start:end])
            logger.error(f"无法解析 JSON: {result[:200]}")
            return {}

    async def generate_with_history(self, messages: list[dict[str, str]],
                                    system_prompt: str = "",
                                    temperature: Optional[float] = None,
                                    max_tokens: Optional[int] = None) -> str:
        """基于对话历史生成回复"""
        full_messages = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(messages)

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=full_messages,
                temperature=temperature or self.config.temperature,
                max_tokens=max_tokens or self.config.max_tokens,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"LLM 生成失败: {e}")
            raise
