"""
SmartAgent2 配置管理模块
使用 Pydantic Settings 管理所有配置项
"""
from pydantic_settings import BaseSettings
from pydantic import Field


class StorageConfig(BaseSettings):
    """存储层配置"""
    storage_mode: str = Field(default="local", description="存储模式: local | production")
    sqlite_db_path: str = Field(default="smartagent2_dev.db", description="本地模式 SQLite 路径")

    # 生产模式连接配置（本地模式不使用）
    redis_url: str = Field(default="redis://localhost:6379", description="Redis URL")
    qdrant_url: str = Field(default="http://localhost:6333", description="Qdrant URL")
    mongodb_url: str = Field(default="mongodb://localhost:27017", description="MongoDB URL")
    neo4j_url: str = Field(default="bolt://localhost:7687", description="Neo4j URL")

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


class LLMConfig(BaseSettings):
    """LLM 服务配置"""
    openai_api_key: str = Field(default="", description="OpenAI API Key")
    openai_base_url: str = Field(default="", description="OpenAI Base URL (留空使用默认)")
    llm_model: str = Field(default="gpt-4.1-mini", description="LLM 模型名称")
    embedding_model: str = Field(default="text-embedding-3-small", description="嵌入模型名称")
    embedding_dimension: int = Field(default=1536, description="向量维度")
    temperature: float = Field(default=0.7, description="生成温度")
    max_tokens: int = Field(default=2048, description="最大 token 数")

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


class MemoryConfig(BaseSettings):
    """记忆系统配置"""
    # 工作记忆
    working_memory_ttl: int = Field(default=1800, description="工作记忆 TTL（秒）")
    working_memory_max_sessions: int = Field(default=1000, description="最大会话数")
    working_memory_max_messages: int = Field(default=50, description="每会话最大消息数")

    # 记忆提取
    extraction_window_size: int = Field(default=8, description="滑动窗口大小")
    extraction_overlap: int = Field(default=2, description="窗口重叠数")
    extraction_min_confidence: float = Field(default=0.6, description="最低置信度")

    # 记忆检索
    retrieval_top_k: int = Field(default=5, description="默认返回数量")
    retrieval_score_threshold: float = Field(default=0.5, description="最低相似度阈值")
    rrf_k: int = Field(default=60, description="RRF 平滑常数")

    # 记忆遗忘
    forgetting_importance_threshold: float = Field(default=0.3, description="重要性阈值")
    forgetting_time_decay_factor: float = Field(default=0.95, description="时间衰减因子")
    forgetting_access_boost_factor: float = Field(default=0.1, description="访问强化因子")
    forgetting_similarity_threshold: float = Field(default=0.85, description="相似度合并阈值")
    forgetting_max_memories_per_user: int = Field(default=10000, description="每用户最大记忆数")

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


class AppConfig(BaseSettings):
    """应用总配置"""
    app_name: str = Field(default="SmartAgent2", description="应用名称")
    app_version: str = Field(default="2.1.0", description="应用版本")
    debug: bool = Field(default=True, description="调试模式")
    host: str = Field(default="0.0.0.0", description="服务地址")
    port: int = Field(default=8000, description="服务端口")

    storage: StorageConfig = Field(default_factory=StorageConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)

    model_config = {"env_prefix": "", "env_file": ".env", "extra": "ignore"}


# 全局配置单例
_config: AppConfig | None = None


def get_config() -> AppConfig:
    """获取全局配置单例"""
    global _config
    if _config is None:
        _config = AppConfig()
    return _config
