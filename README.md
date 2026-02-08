# SmartAgent2 记忆系统 v2.1.0

> AI 智能代理长期记忆与个性化服务系统 — 支持 ElizaOS Characterfile 兼容

## 系统概述

SmartAgent2 是一个面向 AI 智能代理的记忆管理系统，实现了多层次记忆架构（工作记忆、情景记忆、语义记忆）、用户画像管理和 AI 人格配置功能。系统采用双模式存储架构，支持本地开发（SQLite）和生产部署（Redis + Qdrant + MongoDB + Neo4j）两种模式无缝切换。

## 核心功能

| 模块 | 功能描述 |
|------|----------|
| **记忆提取器** | 滑动窗口 + LLM 结构化提取 + 语义去重 + 多存储持久化 |
| **记忆检索器** | 三层混合检索（语义/词汇/图谱）+ RRF 融合排序 |
| **记忆遗忘器** | 基于有效重要性的记忆压缩、归档与删除 |
| **画像管理器** | 用户画像 CRUD、场景化偏好、关系解析、自动更新 |
| **人格管理器** | Characterfile 加载、System Prompt 构建、主动服务规则 |
| **记忆管理器** | 记忆 CRUD、统计、导出（JSON/CSV） |
| **记忆控制器** | 端到端对话编排（检索→画像→人格→LLM→提取） |

## 系统架构

```
┌─────────────────────────────────────────┐
│              API Layer (FastAPI)         │
│  chat / memory / profile / character    │
├─────────────────────────────────────────┤
│           Core Engine Layer             │
│  Controller → Extractor / Retriever     │
│              Forgetter / ProfileMgr     │
│              CharacterMgr / MemoryMgr   │
├─────────────────────────────────────────┤
│           Service Layer                 │
│       LLMService / EmbeddingService     │
├─────────────────────────────────────────┤
│           Storage Layer                 │
│  Local: SQLite + sqlite-vec + TTLCache  │
│  Prod:  Redis + Qdrant + Mongo + Neo4j  │
└─────────────────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 OpenAI API Key
```

关键配置项：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STORAGE_MODE` | `local` | 存储模式（local/production） |
| `OPENAI_API_KEY` | - | OpenAI API 密钥 |
| `LLM_MODEL` | `gpt-4.1-mini` | LLM 模型名称 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding 模型 |
| `EMBEDDING_DIMENSION` | `1536` | 向量维度 |

### 3. 启动服务

```bash
# 方式一：直接运行
python -m smartagent2.main

# 方式二：使用 uvicorn
uvicorn smartagent2.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. 访问 API 文档

启动后访问 http://localhost:8000/docs 查看完整的 Swagger API 文档。

## API 接口

### 对话接口

```bash
# 发送对话消息
POST /api/v1/chat
{
  "user_id": "user_001",
  "session_id": "sess_001",
  "message": "帮我导航到最近的星巴克",
  "options": {
    "include_memory": true,
    "include_profile": true,
    "character_id": "default"
  }
}
```

### 记忆管理接口

```bash
# 列出情景记忆
GET /api/v1/memory/episodic?user_id=user_001&page=1&page_size=20

# 获取记忆统计
GET /api/v1/memory/stats/user_001

# 导出记忆
GET /api/v1/memory/export/user_001?format=json

# 执行遗忘周期
POST /api/v1/memory/forget/user_001
```

### 画像管理接口

```bash
# 获取用户画像
GET /api/v1/profile/user_001

# 更新画像
PUT /api/v1/profile/user_001

# 获取画像快照
GET /api/v1/profile/user_001/snapshot
```

### 人格配置接口

```bash
# 列出所有人格
GET /api/v1/character/

# 创建人格
POST /api/v1/character/

# 从目录加载
POST /api/v1/character/load-all
```

## 项目结构

```
smartagent2/
├── config.py                 # 配置管理
├── main.py                   # FastAPI 应用入口
├── requirements.txt          # 依赖清单
├── .env.example              # 环境变量示例
├── README.md                 # 本文件
├── models/                   # 数据模型层
│   ├── base.py               # 基础类型和枚举
│   ├── working.py            # 工作记忆模型
│   ├── episodic.py           # 情景记忆模型
│   ├── semantic.py           # 语义记忆模型
│   ├── profile.py            # 用户画像模型
│   ├── character.py          # 人格配置模型
│   └── query.py              # 查询与结果模型
├── storage/                  # 存储层
│   ├── interfaces.py         # 抽象接口
│   ├── factory.py            # 存储工厂
│   └── local/                # 本地存储实现
│       ├── working_memory.py # TTLCache 工作记忆
│       ├── vector_store.py   # sqlite-vec 向量存储
│       ├── document_store.py # SQLite JSON 文档存储
│       └── graph_store.py    # SQLite 邻接表图存储
├── services/                 # 服务层
│   ├── llm_service.py        # LLM 服务封装
│   └── embedding_service.py  # Embedding 服务封装
├── core/                     # 核心业务逻辑
│   ├── extractor.py          # 记忆提取器
│   ├── retriever.py          # 记忆检索器
│   ├── forgetter.py          # 记忆遗忘器
│   ├── manager.py            # 记忆管理器
│   ├── profile_manager.py    # 画像管理器
│   ├── character_manager.py  # 人格管理器
│   └── controller.py         # 记忆控制器
├── api/                      # API 路由层
│   └── routes/
│       ├── chat_routes.py    # 对话接口
│       ├── memory_routes.py  # 记忆管理接口
│       ├── profile_routes.py # 画像接口
│       ├── character_routes.py # 人格配置接口
│       └── maintenance_routes.py # 系统维护接口
├── characters/               # 人格配置文件
│   ├── default.json          # 默认人格（小智）
│   ├── jarvis.json           # 贾维斯（J.A.R.V.I.S.）
│   └── alfred.json           # 阿尔弗雷德（Alfred Pennyworth）
└── tests/                    # 测试
    ├── test_storage.py       # 存储层测试 (21 cases)
    ├── test_core.py          # 核心引擎测试 (17 cases)
    ├── test_api.py           # API 端到端测试 (22 cases)
    └── auto/                 # 自动化端到端测试
        ├── auto_test.py      # 自动化测试执行脚本
        ├── test_dataset.json # 测试用例数据集 (7套件/21用例)
        ├── TEST_PLAN.md      # 测试方案设计文档
        └── README.md         # 自动化测试说明
```

## 运行测试

### 单元测试

```bash
# 运行全部单元测试
python -m pytest smartagent2/tests/ -v

# 运行指定模块测试
python -m pytest smartagent2/tests/test_storage.py -v
python -m pytest smartagent2/tests/test_core.py -v
python -m pytest smartagent2/tests/test_api.py -v
```

### 自动化端到端测试

```bash
# 确保服务已启动，然后运行自动化测试
python tests/auto/auto_test.py
```

自动化测试覆盖 7 大类场景（基础对话、记忆检索、用户画像、记忆统计、人格切换、系统健康、边界异常），共 21 个测试用例。详见 [tests/auto/README.md](tests/auto/README.md)。

## 技术栈

- **Python 3.11+**
- **FastAPI** - Web 框架
- **Pydantic v2** - 数据验证
- **SQLite + sqlite-vec** - 本地存储 + 向量检索
- **OpenAI API** - LLM 和 Embedding 服务
- **cachetools** - TTL 缓存（工作记忆）
- **networkx** - 图算法（知识图谱）

## 预置人格

| 人格 | ID | 描述 |
|------|----|------|
| 小智 | `default` | 智能车载 AI 助手，中文对话，擅长导航、音乐、天气等车载场景 |
| 贾维斯 | `jarvis` | 钢铁侠 AI 助手，精通技术分析、数据驱动决策，称呼用户为「先生」 |
| 阿尔弗雷德 | `alfred` | 蝙蝠侠管家，擅长战术支援、医疗急救、礼仪文化，称呼用户为「少爷」 |

对话时通过 `options.character_id` 指定人格 ID 即可切换。系统启动时自动加载 `characters/` 目录下的所有人格配置。

## 版本历史

详见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT License
