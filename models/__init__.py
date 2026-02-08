"""SmartAgent2 数据模型包"""
from .base import (
    MemoryType, EpisodicEventType, SemanticCategory, MessageRole, ExportFormat,
    SmartAgent2BaseModel, MemoryBase, ConversationMessage, ExtractedEntity,
    ScoredMemory, VectorSearchResult, generate_id,
)
from .working import ActiveContext, WorkingMemory
from .episodic import TemporalContext, EpisodicMemory
from .semantic import SemanticMemory, GraphNode, GraphEdge
from .profile import (
    UserPreference, PersonRelationship, InterestTag, HabitPattern,
    UserProfile, ContextualProfileSnapshot,
)
from .character import (
    MessageExample, VoiceConfig, ModelSettings, ProactiveRule,
    DialogueStyle, KnowledgeItem, VehicleConfig, AgentCharacter,
)
from .query import (
    DateRange, RetrievalQuery, RetrievalResult,
    ForgettingConfig, ForgettingResult,
    ChatOptions, ChatRequest, ChatResponse, ActionItem,
    MemoryFilter, PaginatedResult, MemoryStats, KeywordCount,
    ProfileUpdateResult,
)

__all__ = [
    "MemoryType", "EpisodicEventType", "SemanticCategory", "MessageRole", "ExportFormat",
    "SmartAgent2BaseModel", "MemoryBase", "ConversationMessage", "ExtractedEntity",
    "ScoredMemory", "VectorSearchResult", "generate_id",
    "ActiveContext", "WorkingMemory",
    "TemporalContext", "EpisodicMemory",
    "SemanticMemory", "GraphNode", "GraphEdge",
    "UserPreference", "PersonRelationship", "InterestTag", "HabitPattern",
    "UserProfile", "ContextualProfileSnapshot",
    "MessageExample", "VoiceConfig", "ModelSettings", "ProactiveRule",
    "DialogueStyle", "KnowledgeItem", "VehicleConfig", "AgentCharacter",
    "DateRange", "RetrievalQuery", "RetrievalResult",
    "ForgettingConfig", "ForgettingResult",
    "ChatOptions", "ChatRequest", "ChatResponse", "ActionItem",
    "MemoryFilter", "PaginatedResult", "MemoryStats", "KeywordCount",
    "ProfileUpdateResult",
]
