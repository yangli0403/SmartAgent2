"""SmartAgent2 存储层"""
from .factory import create_storage, StorageBundle
from .interfaces import IWorkingMemoryRepo, IVectorRepo, IDocumentRepo, IGraphRepo

__all__ = [
    "create_storage", "StorageBundle",
    "IWorkingMemoryRepo", "IVectorRepo", "IDocumentRepo", "IGraphRepo",
]
