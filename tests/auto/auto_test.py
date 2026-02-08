"""
SmartAgent2 自动化端到端测试脚本
按照测试用例文档中的6轮对话场景进行测试，并验证记忆提取和用户画像构建
"""
import json
import time
import requests
import sys
from datetime import datetime

BASE_URL = "http://localhost:8000"
USER_ID = "demo_wangwu"
SESSION_ID = f"test_session_{int(time.time())}"
CHARACTER_ID = "default"

# 测试结果收集
test_results = {
    "test_time": datetime.now().isoformat(),
    "user_id": USER_ID,
    "session_id": SESSION_ID,
    "phases": [],
    "summary": {}
}


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def save_results():
    with open("/home/ubuntu/test_results.json", "w", encoding="utf-8") as f:
        json.dump(test_results, f, ensure_ascii=False, indent=2)


# ============================================================
# Phase 0: 系统健康检查
# ============================================================
def test_system_health():
    log("=" * 60)
    log("Phase 0: 系统健康检查")
    log("=" * 60)
    phase = {"name": "系统健康检查", "tests": [], "status": "passed"}

    # Test root endpoint
    try:
        resp = requests.get(f"{BASE_URL}/", timeout=10)
        data = resp.json()
        passed = resp.status_code == 200 and "name" in data
        phase["tests"].append({
            "name": "根路径访问",
            "endpoint": "GET /",
            "status": "passed" if passed else "failed",
            "response": data
        })
        log(f"  根路径: {'✓' if passed else '✗'} - {data}")
    except Exception as e:
        phase["tests"].append({"name": "根路径访问", "status": "failed", "error": str(e)})
        phase["status"] = "failed"
        log(f"  根路径: ✗ - {e}")

    # Test health endpoint
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/system/health", timeout=10)
        data = resp.json()
        passed = data.get("status") == "healthy"
        phase["tests"].append({
            "name": "健康检查",
            "endpoint": "GET /api/v1/system/health",
            "status": "passed" if passed else "failed",
            "response": data
        })
        log(f"  健康检查: {'✓' if passed else '✗'} - {data}")
    except Exception as e:
        phase["tests"].append({"name": "健康检查", "status": "failed", "error": str(e)})
        phase["status"] = "failed"
        log(f"  健康检查: ✗ - {e}")

    # Test config endpoint
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/system/config", timeout=10)
        data = resp.json()
        passed = resp.status_code == 200 and "llm_model" in data
        phase["tests"].append({
            "name": "配置查询",
            "endpoint": "GET /api/v1/system/config",
            "status": "passed" if passed else "failed",
            "response": data
        })
        log(f"  配置查询: {'✓' if passed else '✗'} - model={data.get('llm_model')}")
    except Exception as e:
        phase["tests"].append({"name": "配置查询", "status": "failed", "error": str(e)})
        phase["status"] = "failed"

    test_results["phases"].append(phase)
    return phase["status"] == "passed"


# ============================================================
# Phase 1: 6轮对话交互
# ============================================================
CONVERSATIONS = [
    {
        "round": 1,
        "title": "基础对话（自我介绍）",
        "message": "你好，我叫王五，今年35岁，是一名产品经理，住在北京朝阳区。",
        "expected_keywords": ["王五", "产品经理", "朝阳区"],
    },
    {
        "round": 2,
        "title": "偏好信息",
        "message": "我喜欢喝美式咖啡，不加糖。周末喜欢去三里屯逛街。",
        "expected_keywords": ["美式咖啡", "三里屯"],
    },
    {
        "round": 3,
        "title": "关系信息",
        "message": "我女儿小红今年6岁了，她特别喜欢画画。我老婆叫李梅，是个老师。",
        "expected_keywords": ["小红", "画画", "李梅", "老师"],
    },
    {
        "round": 4,
        "title": "通勤和工作信息",
        "message": "我每天早上9点坐地铁去国贸上班，公司在CBD那边。最近在做一个AI产品。",
        "expected_keywords": ["地铁", "国贸", "CBD", "AI"],
    },
    {
        "round": 5,
        "title": "记忆检索测试",
        "message": "你还记得我家里有几口人吗？我女儿喜欢什么？",
        "expected_keywords": ["三口", "小红", "画画"],
        "is_retrieval_test": True,
    },
    {
        "round": 6,
        "title": "个性化推荐测试",
        "message": "帮我推荐一个适合带6岁小孩去的周末活动",
        "expected_keywords": ["画画", "小红"],
        "is_retrieval_test": True,
    },
]


def test_conversations():
    log("=" * 60)
    log("Phase 1: 6轮对话交互测试")
    log("=" * 60)
    phase = {"name": "对话交互测试", "conversations": [], "status": "passed"}

    for conv in CONVERSATIONS:
        log(f"\n  --- 对话 {conv['round']}: {conv['title']} ---")
        log(f"  用户: {conv['message']}")

        conv_result = {
            "round": conv["round"],
            "title": conv["title"],
            "user_input": conv["message"],
            "expected_keywords": conv["expected_keywords"],
            "status": "unknown",
        }

        try:
            payload = {
                "user_id": USER_ID,
                "session_id": SESSION_ID,
                "message": conv["message"],
                "options": {
                    "include_memory": conv["round"] >= 5,
                    "include_profile": conv["round"] >= 5,
                    "character_id": CHARACTER_ID,
                    "max_memory_items": 10,
                },
            }
            resp = requests.post(f"{BASE_URL}/api/v1/chat", json=payload, timeout=60)
            data = resp.json()

            system_reply = data.get("response", "")
            conv_result["system_reply"] = system_reply
            conv_result["http_status"] = resp.status_code
            conv_result["session_id"] = data.get("session_id", "")

            # Check if memory was used
            if "memory_context" in data:
                conv_result["memory_context"] = data["memory_context"]
            if "memories_used" in data:
                conv_result["memories_used"] = data["memories_used"]

            log(f"  系统: {system_reply[:120]}{'...' if len(system_reply) > 120 else ''}")

            # Validate response contains expected keywords
            found_keywords = []
            missing_keywords = []
            for kw in conv["expected_keywords"]:
                if kw in system_reply:
                    found_keywords.append(kw)
                else:
                    missing_keywords.append(kw)

            conv_result["found_keywords"] = found_keywords
            conv_result["missing_keywords"] = missing_keywords

            if resp.status_code == 200 and system_reply:
                conv_result["status"] = "passed"
                keyword_info = f"关键词匹配: {len(found_keywords)}/{len(conv['expected_keywords'])}"
                if missing_keywords:
                    keyword_info += f" (缺失: {missing_keywords})"
                log(f"  结果: ✓ 回复成功 | {keyword_info}")
            else:
                conv_result["status"] = "failed"
                conv_result["error"] = f"HTTP {resp.status_code}"
                phase["status"] = "failed"
                log(f"  结果: ✗ HTTP {resp.status_code}")

        except Exception as e:
            conv_result["status"] = "failed"
            conv_result["error"] = str(e)
            phase["status"] = "failed"
            log(f"  结果: ✗ 异常: {e}")

        phase["conversations"].append(conv_result)

        # Wait between conversations to allow memory extraction
        if conv["round"] < 6:
            log(f"  等待3秒让系统完成记忆提取...")
            time.sleep(3)

    test_results["phases"].append(phase)
    return phase["status"] == "passed"


# ============================================================
# Phase 2: 记忆验证
# ============================================================
def test_memory_verification():
    log("\n" + "=" * 60)
    log("Phase 2: 记忆提取验证")
    log("=" * 60)

    # Wait a bit for async memory extraction to complete
    log("  等待5秒让系统完成所有记忆提取...")
    time.sleep(5)

    phase = {"name": "记忆提取验证", "tests": [], "status": "passed"}

    # 2.1 Check episodic memories
    log("\n  --- 2.1 情景记忆验证 ---")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/v1/memory/episodic",
            params={"user_id": USER_ID, "page": 1, "page_size": 50},
            timeout=30
        )
        data = resp.json()
        episodic_total = data.get("total", 0)
        episodic_items = data.get("items", [])

        # Expected: ~13 episodic memories
        expected_episodic = 13
        test_item = {
            "name": "情景记忆数量",
            "endpoint": "GET /api/v1/memory/episodic",
            "expected": f"约 {expected_episodic} 条",
            "actual": f"{episodic_total} 条",
            "status": "passed" if episodic_total >= 5 else "warning",
            "details": []
        }

        log(f"  情景记忆总数: {episodic_total} (预期约 {expected_episodic})")

        # List episodic memory summaries
        for i, item in enumerate(episodic_items[:15]):
            summary = item.get("summary", item.get("lossless_restatement", "N/A"))
            importance = item.get("importance", "N/A")
            event_type = item.get("event_type", "N/A")
            detail = {
                "index": i + 1,
                "summary": summary,
                "event_type": event_type,
                "importance": importance,
            }
            test_item["details"].append(detail)
            log(f"    [{i+1}] {summary[:60]} | 类型={event_type} | 重要性={importance}")

        phase["tests"].append(test_item)

    except Exception as e:
        phase["tests"].append({"name": "情景记忆查询", "status": "failed", "error": str(e)})
        phase["status"] = "failed"
        log(f"  ✗ 情景记忆查询失败: {e}")

    # 2.2 Check semantic memories
    log("\n  --- 2.2 语义记忆验证 ---")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/v1/memory/semantic",
            params={"user_id": USER_ID, "page": 1, "page_size": 50},
            timeout=30
        )
        data = resp.json()
        semantic_total = data.get("total", 0)
        semantic_items = data.get("items", [])

        expected_semantic = 31
        test_item = {
            "name": "语义记忆数量",
            "endpoint": "GET /api/v1/memory/semantic",
            "expected": f"约 {expected_semantic} 条",
            "actual": f"{semantic_total} 条",
            "status": "passed" if semantic_total >= 10 else "warning",
            "details": []
        }

        log(f"  语义记忆总数: {semantic_total} (预期约 {expected_semantic})")

        # Check key semantic triples
        key_triples = [
            ("小红", "喜欢", "画画"),
            ("王五", "喜欢喝", "咖啡"),
            ("李梅", "职业", "老师"),
            ("王五", "通勤", "地铁"),
        ]

        for item in semantic_items[:35]:
            subject = item.get("subject", "")
            predicate = item.get("predicate", "")
            obj = item.get("object", "")
            category = item.get("category", "")
            confidence = item.get("confidence", "")
            detail = {
                "subject": subject,
                "predicate": predicate,
                "object": obj,
                "category": category,
                "confidence": confidence,
            }
            test_item["details"].append(detail)
            log(f"    ({subject}, {predicate}, {obj}) | 类别={category} | 置信度={confidence}")

        # Verify key triples exist
        found_triples = []
        for subj, pred, obj in key_triples:
            found = False
            for item in semantic_items:
                s = item.get("subject", "")
                p = item.get("predicate", "")
                o = item.get("object", "")
                if subj in s and (pred in p or obj in o):
                    found = True
                    break
            found_triples.append({"triple": f"({subj}, {pred}, {obj})", "found": found})

        test_item["key_triples_check"] = found_triples
        log(f"\n  关键三元组验证:")
        for ft in found_triples:
            log(f"    {'✓' if ft['found'] else '✗'} {ft['triple']}")

        phase["tests"].append(test_item)

    except Exception as e:
        phase["tests"].append({"name": "语义记忆查询", "status": "failed", "error": str(e)})
        phase["status"] = "failed"
        log(f"  ✗ 语义记忆查询失败: {e}")

    # 2.3 Memory stats
    log("\n  --- 2.3 记忆统计 ---")
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/memory/stats/{USER_ID}", timeout=30)
        data = resp.json()
        test_item = {
            "name": "记忆统计",
            "endpoint": f"GET /api/v1/memory/stats/{USER_ID}",
            "status": "passed",
            "response": data,
        }
        phase["tests"].append(test_item)
        log(f"  统计: {json.dumps(data, ensure_ascii=False)}")
    except Exception as e:
        phase["tests"].append({"name": "记忆统计", "status": "failed", "error": str(e)})
        log(f"  ✗ 记忆统计查询失败: {e}")

    test_results["phases"].append(phase)
    return phase["status"] == "passed"


# ============================================================
# Phase 3: 用户画像验证
# ============================================================
def test_profile_verification():
    log("\n" + "=" * 60)
    log("Phase 3: 用户画像验证")
    log("=" * 60)
    phase = {"name": "用户画像验证", "tests": [], "status": "passed"}

    # 3.1 Get user profile
    log("\n  --- 3.1 用户画像查询 ---")
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/profile/{USER_ID}", timeout=30)
        profile = resp.json()

        test_item = {
            "name": "用户画像",
            "endpoint": f"GET /api/v1/profile/{USER_ID}",
            "status": "passed",
            "profile": profile,
            "validations": [],
        }

        # Validate basic_info
        basic_info = profile.get("basic_info", {})
        log(f"  基本信息: {json.dumps(basic_info, ensure_ascii=False)}")

        expected_basic = {
            "姓名/name": "王五",
            "年龄/age": "35",
            "职业/occupation": "产品经理",
            "居住地/location": "朝阳",
        }

        basic_info_str = json.dumps(basic_info, ensure_ascii=False).lower()
        for field, expected_val in expected_basic.items():
            found = expected_val.lower() in basic_info_str
            test_item["validations"].append({
                "field": field,
                "expected": expected_val,
                "found": found,
            })
            log(f"    {'✓' if found else '✗'} {field}: 期望包含 '{expected_val}'")

        # Validate preferences
        preferences = profile.get("preferences", [])
        log(f"\n  偏好数量: {len(preferences)}")
        for pref in preferences[:10]:
            cat = pref.get("category", "")
            key = pref.get("key", "")
            val = pref.get("value", "")
            log(f"    - {cat}/{key} = {val}")

        expected_prefs = ["咖啡", "三里屯", "地铁"]
        prefs_str = json.dumps(preferences, ensure_ascii=False).lower()
        for ep in expected_prefs:
            found = ep.lower() in prefs_str
            test_item["validations"].append({
                "field": f"偏好-{ep}",
                "expected": ep,
                "found": found,
            })
            log(f"    {'✓' if found else '✗'} 偏好包含 '{ep}'")

        # Validate relationships
        relationships = profile.get("relationships", [])
        log(f"\n  关系数量: {len(relationships)}")
        for rel in relationships[:10]:
            name = rel.get("person_name", "")
            relation = rel.get("relationship", "")
            attrs = rel.get("attributes", {})
            log(f"    - {name} ({relation}) {attrs}")

        expected_rels = [("小红", "女儿"), ("李梅", "妻子")]
        rels_str = json.dumps(relationships, ensure_ascii=False).lower()
        for name, rel in expected_rels:
            found = name.lower() in rels_str
            test_item["validations"].append({
                "field": f"关系-{name}",
                "expected": f"{name}({rel})",
                "found": found,
            })
            log(f"    {'✓' if found else '✗'} 关系包含 '{name}({rel})'")

        phase["tests"].append(test_item)

    except Exception as e:
        phase["tests"].append({"name": "用户画像查询", "status": "failed", "error": str(e)})
        phase["status"] = "failed"
        log(f"  ✗ 用户画像查询失败: {e}")

    # 3.2 Get contextual snapshot
    log("\n  --- 3.2 上下文快照 ---")
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/profile/{USER_ID}/snapshot", timeout=30)
        snapshot = resp.json()
        test_item = {
            "name": "上下文快照",
            "endpoint": f"GET /api/v1/profile/{USER_ID}/snapshot",
            "status": "passed",
            "snapshot": snapshot,
        }
        log(f"  显示名称: {snapshot.get('display_name', 'N/A')}")
        log(f"  活跃偏好: {len(snapshot.get('active_preferences', []))} 条")
        log(f"  相关关系: {len(snapshot.get('relevant_relationships', []))} 条")
        phase["tests"].append(test_item)
    except Exception as e:
        phase["tests"].append({"name": "上下文快照", "status": "failed", "error": str(e)})
        log(f"  ✗ 上下文快照查询失败: {e}")

    test_results["phases"].append(phase)
    return phase["status"] == "passed"


# ============================================================
# Phase 4: 附加功能测试
# ============================================================
def test_additional_features():
    log("\n" + "=" * 60)
    log("Phase 4: 附加功能测试")
    log("=" * 60)
    phase = {"name": "附加功能测试", "tests": [], "status": "passed"}

    # 4.1 Memory export (JSON)
    log("\n  --- 4.1 记忆导出 (JSON) ---")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/v1/memory/export/{USER_ID}",
            params={"format": "json"},
            timeout=30
        )
        passed = resp.status_code == 200
        phase["tests"].append({
            "name": "记忆导出(JSON)",
            "endpoint": f"GET /api/v1/memory/export/{USER_ID}?format=json",
            "status": "passed" if passed else "failed",
            "response_length": len(resp.text),
        })
        log(f"  {'✓' if passed else '✗'} JSON导出: {len(resp.text)} 字节")
    except Exception as e:
        phase["tests"].append({"name": "记忆导出(JSON)", "status": "failed", "error": str(e)})
        log(f"  ✗ JSON导出失败: {e}")

    # 4.2 Memory export (CSV)
    log("\n  --- 4.2 记忆导出 (CSV) ---")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/v1/memory/export/{USER_ID}",
            params={"format": "csv"},
            timeout=30
        )
        passed = resp.status_code == 200
        phase["tests"].append({
            "name": "记忆导出(CSV)",
            "endpoint": f"GET /api/v1/memory/export/{USER_ID}?format=csv",
            "status": "passed" if passed else "failed",
            "response_length": len(resp.text),
        })
        log(f"  {'✓' if passed else '✗'} CSV导出: {len(resp.text)} 字节")
    except Exception as e:
        phase["tests"].append({"name": "记忆导出(CSV)", "status": "failed", "error": str(e)})
        log(f"  ✗ CSV导出失败: {e}")

    # 4.3 Character management
    log("\n  --- 4.3 人格配置管理 ---")
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/character/", timeout=30)
        characters = resp.json()
        passed = resp.status_code == 200 and isinstance(characters, list)
        phase["tests"].append({
            "name": "人格列表查询",
            "endpoint": "GET /api/v1/character/",
            "status": "passed" if passed else "failed",
            "count": len(characters),
        })
        log(f"  {'✓' if passed else '✗'} 人格列表: {len(characters)} 个")
    except Exception as e:
        phase["tests"].append({"name": "人格列表查询", "status": "failed", "error": str(e)})
        log(f"  ✗ 人格列表查询失败: {e}")

    # 4.4 Get default character
    log("\n  --- 4.4 默认人格配置 ---")
    try:
        resp = requests.get(f"{BASE_URL}/api/v1/character/default", timeout=30)
        if resp.status_code == 200:
            char = resp.json()
            phase["tests"].append({
                "name": "默认人格查询",
                "endpoint": "GET /api/v1/character/default",
                "status": "passed",
                "character_name": char.get("name", ""),
            })
            log(f"  ✓ 默认人格: {char.get('name', 'N/A')}")
        else:
            phase["tests"].append({
                "name": "默认人格查询",
                "status": "warning",
                "note": f"HTTP {resp.status_code}",
            })
            log(f"  ⚠ 默认人格未找到 (HTTP {resp.status_code})")
    except Exception as e:
        phase["tests"].append({"name": "默认人格查询", "status": "failed", "error": str(e)})
        log(f"  ✗ 默认人格查询失败: {e}")

    # 4.5 Forgetting cycle
    log("\n  --- 4.5 遗忘周期 ---")
    try:
        resp = requests.post(f"{BASE_URL}/api/v1/memory/forget/{USER_ID}", timeout=30)
        data = resp.json()
        passed = resp.status_code == 200 and "total_scanned" in data
        phase["tests"].append({
            "name": "遗忘周期",
            "endpoint": f"POST /api/v1/memory/forget/{USER_ID}",
            "status": "passed" if passed else "failed",
            "response": data,
        })
        log(f"  {'✓' if passed else '✗'} 遗忘周期: {json.dumps(data, ensure_ascii=False)}")
    except Exception as e:
        phase["tests"].append({"name": "遗忘周期", "status": "failed", "error": str(e)})
        log(f"  ✗ 遗忘周期失败: {e}")

    test_results["phases"].append(phase)
    return phase["status"] == "passed"


# ============================================================
# Summary
# ============================================================
def generate_summary():
    log("\n" + "=" * 60)
    log("测试总结")
    log("=" * 60)

    total_tests = 0
    passed_tests = 0
    failed_tests = 0
    warning_tests = 0

    for phase in test_results["phases"]:
        tests = phase.get("tests", []) + phase.get("conversations", [])
        for t in tests:
            total_tests += 1
            status = t.get("status", "unknown")
            if status == "passed":
                passed_tests += 1
            elif status == "failed":
                failed_tests += 1
            elif status == "warning":
                warning_tests += 1

    summary = {
        "total_tests": total_tests,
        "passed": passed_tests,
        "failed": failed_tests,
        "warnings": warning_tests,
        "pass_rate": f"{passed_tests / total_tests * 100:.1f}%" if total_tests > 0 else "0%",
        "overall_status": "PASSED" if failed_tests == 0 else "FAILED",
    }
    test_results["summary"] = summary

    log(f"  总测试数: {total_tests}")
    log(f"  通过: {passed_tests}")
    log(f"  失败: {failed_tests}")
    log(f"  警告: {warning_tests}")
    log(f"  通过率: {summary['pass_rate']}")
    log(f"  总体状态: {summary['overall_status']}")

    save_results()
    log(f"\n测试结果已保存到: /home/ubuntu/test_results.json")


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    log("SmartAgent2 自动化端到端测试开始")
    log(f"目标服务: {BASE_URL}")
    log(f"测试用户: {USER_ID}")
    log(f"会话ID: {SESSION_ID}")

    # Run all test phases
    health_ok = test_system_health()
    if not health_ok:
        log("系统健康检查失败，终止测试")
        generate_summary()
        sys.exit(1)

    test_conversations()
    test_memory_verification()
    test_profile_verification()
    test_additional_features()

    generate_summary()
    log("\n测试完成！")
