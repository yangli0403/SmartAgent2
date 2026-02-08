# SmartAgent2 更新日志

## v2.1.0 (2026-02-08)

### 新增功能

#### ElizaOS Characterfile 兼容

本版本引入了对 ElizaOS Characterfile 格式的完整兼容支持。`CharacterManager.load_from_file()` 能够自动识别 ElizaOS 和原生格式，支持 `messageExamples`、`postExamples`、`modelProvider`、`clients` 等 ElizaOS 特有字段的映射转换，使两种格式的人格配置可以在同一系统中无缝共存。

#### 人格配置模型扩展 (`AgentCharacter`)

扩展了 `AgentCharacter` 数据模型，新增以下字段：`system`（ElizaOS 风格系统提示词，优先级高于模板构建）、`post_examples`（社交媒体/帖子风格示例）、`clients`（支持的客户端平台列表）、`model_provider`（模型提供商标记）、`source_format`（来源格式标记 native/elizaos）。同时 `DialogueStyle` 新增 `post` 维度以支持社交媒体风格指令。

#### System Prompt 构建增强

支持 `system` 字段优先模式——当人格配置包含 `system` 字段时，以其为核心构建增强提示词。提示词中注入 `adjectives`（性格特征）、`topics`（专长领域）、`knowledge`（专属知识）等上下文信息，并支持 `bio`/`lore` 随机采样以增加回复多样性。所有提示词模板和章节标题均已中文化，确保中文对话场景下的最佳效果。

#### 预置人格库（中文版）

| 人格 | ID | 描述 |
|------|----|------|
| 贾维斯 (J.A.R.V.I.S.) | `jarvis` | 钢铁侠AI助手，精通技术分析、数据驱动决策，称呼用户为「先生」 |
| 阿尔弗雷德 (Alfred Pennyworth) | `alfred` | 蝙蝠侠管家，擅长战术支援、医疗急救、礼仪文化、道德指引，称呼用户为「少爷」 |

两个人格的所有内容（system 提示词、bio、lore、style、knowledge、message_examples、adjectives、topics 等）均已完整中文化，适配中文对话场景。

#### 启动自动加载

服务启动时自动扫描 `characters/` 目录，加载所有人格配置文件。健康检查接口 (`/api/v1/system/health`) 返回已加载人格列表。

### 改进

`DEFAULT_SYSTEM_PROMPT_TEMPLATE` 增加了 `{adjectives}`、`{topics}`、`{knowledge}` 占位符。人格配置的 `knowledge` 字段同时支持纯字符串数组（ElizaOS 格式）和结构化对象数组（原生格式）。增强提示词构建方法 `_build_enhanced_system_prompt` 的所有章节标题已从英文翻译为中文（如 Background -> 背景信息、Communication Style -> 对话风格 等）。启动日志增加人格加载信息，便于运维监控。

### 兼容性

本版本完全向后兼容 v2.0.0 的人格配置格式。原有 `default.json` 配置无需修改即可正常使用，新增字段均有默认值，不影响现有功能。

---

## v2.0.0

初始版本，包含核心记忆系统（工作记忆、情景记忆、语义记忆）、用户画像管理、人格配置管理、记忆提取/检索/遗忘功能，以及 FastAPI REST API。
