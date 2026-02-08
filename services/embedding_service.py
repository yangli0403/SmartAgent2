"""
SmartAgent2 Embedding 服务封装
统一调用 OpenAI-compatible API 进行文本向量化
"""
import logging
from typing import Optional

from openai import OpenAI

from smartagent2.config import get_config

logger = logging.getLogger(__name__)


class EmbeddingService:
    """文本向量化服务"""

    def __init__(self, config=None):
        self.config = config or get_config().llm
        kwargs = {}
        if self.config.openai_api_key:
            kwargs["api_key"] = self.config.openai_api_key
        if self.config.openai_base_url:
            kwargs["base_url"] = self.config.openai_base_url
        self.client = OpenAI(**kwargs)
        self.model = self.config.embedding_model
        self.dimension = self.config.embedding_dimension

    async def embed(self, text: str) -> list[float]:
        """将单段文本转换为向量"""
        try:
            response = self.client.embeddings.create(
                model=self.model,
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding 生成失败: {e}")
            raise

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """批量文本向量化"""
        if not texts:
            return []
        try:
            response = self.client.embeddings.create(
                model=self.model,
                input=texts,
            )
            # 按 index 排序确保顺序一致
            sorted_data = sorted(response.data, key=lambda x: x.index)
            return [d.embedding for d in sorted_data]
        except Exception as e:
            logger.error(f"批量 Embedding 生成失败: {e}")
            raise

    async def similarity(self, text1: str, text2: str) -> float:
        """计算两段文本的余弦相似度"""
        embeddings = await self.embed_batch([text1, text2])
        if len(embeddings) < 2:
            return 0.0
        return self._cosine_similarity(embeddings[0], embeddings[1])

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        """计算余弦相似度"""
        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot_product / (norm_a * norm_b)
