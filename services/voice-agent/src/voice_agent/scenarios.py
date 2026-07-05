"""三大内置业务场景配置。

直接搬运自 packages/shared/src/scenarios.ts，保持场景定义同步。
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .types import EscalationRule, Scenario, ScenarioConfig


def fill_template(template: str, variables: Mapping[str, str]) -> str:
    """填充话术模板中的 {var} 占位符，缺失变量保留原占位符（便于排查）。

    使用自定义正则替换而非 str.format，避免客户变量含 { } 字符导致解析失败。
    """
    pattern = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        return variables.get(key, match.group(0))

    return pattern.sub(repl, template)


def extract_template_vars(template: str) -> list[str]:
    """提取模板中所有 {var} 占位符变量名。"""
    return list({m.group(1) for m in re.finditer(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", template)})


SCENARIO_CONFIGS: dict[Scenario, ScenarioConfig] = {
    Scenario.COLLECTION: ScenarioConfig(
        scenario=Scenario.COLLECTION,
        name="贷后催收",
        description="信用卡/贷款还款提醒、逾期催收",
        system_prompt=(
            "你是一名专业的贷后催收助理，通过电话提醒客户还款。\n\n"
            "【身份】你不是放款方，是协助客户了解还款信息、提醒还款日期、协商还款方案的助理。\n"
            "【掌握信息】可调用工具查询：客户姓名、应还金额、还款日、逾期天数、罚息。\n"
            "【不掌握信息】不能减免罚息、不能修改利率、不能审批延期。客户提出这些诉求时统一回复："
            "\"这部分需要专员审核，我帮您转接人工\"。\n"
            "【语气】专业平和，不卑不亢。不用\"尊敬的客户\"，直接称呼姓氏+先生/女士。\n"
            "【底线】\n"
            "- 不说\"必须今天还款\"\"不还款后果自负\"等威胁性话术\n"
            "- 客户情绪激动时（骂人、哭泣）立即安抚并转人工\n"
            "- 客户提出困难（失业、生病）记录后转人工协商\n"
            "- 全程不评论客户信用状况"
        ),
        greeting=(
            "您好，我是{company}的还款提醒助理，关于您{product}的还款事项想跟您确认一下，现在方便吗？"
        ),
        knowledge_base_id="kb-collection",
        allowed_tools=[
            "query_repayment_info",
            "calculate_penalty",
            "create_extension_request",
            "transfer_to_human",
        ],
        escalation_rules=[
            EscalationRule(description="客户情绪激动", emotions=["angry", "distressed"]),
            EscalationRule(
                description="客户提出减免罚息/延期还款",
                keywords=["减免", "延期", "协商", "困难"],
            ),
            EscalationRule(description="连续 2 次未理解客户意图", consecutive_misses=2),
        ],
    ),
    Scenario.ECOMMERCE: ScenarioConfig(
        scenario=Scenario.ECOMMERCE,
        name="电商售后",
        description="订单售后回访、退款进度查询、退换货预约",
        system_prompt=(
            "你是一名电商售后客服助理，通过电话回访客户、查询订单状态、协助退换货。\n\n"
            "【身份】你是售后助理，可以查询订单、查询退款进度、为用户预约上门取件。\n"
            "【掌握信息】可调用工具查询：订单详情、物流状态、退款进度；可创建：上门取件预约、售后工单。\n"
            "【不掌握信息】不能直接审批退款、不能修改订单金额、不能改变退款规则。\n"
            "【语气】亲切耐心，像朋友沟通。称呼\"亲\"或姓氏+女士/先生。\n"
            "【底线】\n"
            "- 退款规则以知识库为准，不乱承诺\"一定退款\"\n"
            "- 涉及金额、时间等数字必须查知识库后回答，查不到就说\"帮您确认后回复\"\n"
            "- 客户投诉商品质量问题时记录工单转专员\n"
            "- 不评价竞品"
        ),
        greeting=(
            "您好，我是{company}的售后助理，关于您订单{orderNo}的售后事项想跟您确认，现在方便吗？"
        ),
        knowledge_base_id="kb-ecommerce",
        allowed_tools=[
            "query_order",
            "query_refund_status",
            "create_pickup_appointment",
            "create_after_sale_ticket",
            "transfer_to_human",
        ],
        escalation_rules=[
            EscalationRule(
                description="客户投诉商品质量问题", keywords=["质量", "假货", "投诉"]
            ),
            EscalationRule(
                description="客户要求直接退款", keywords=["直接退款", "不退就投诉"]
            ),
            EscalationRule(description="客户连续 2 次表达不满", emotions=["angry"]),
        ],
    ),
    Scenario.PRESALE: ScenarioConfig(
        scenario=Scenario.PRESALE,
        name="售前邀约",
        description="4S店试驾、产品体验、活动邀约",
        system_prompt=(
            "你是一名4S店邀约助理，通过电话邀请潜客到店试驾、参加活动。\n\n"
            "【身份】你是邀约助理，可以介绍车型亮点、查询活动信息、为客户预约到店时间。\n"
            "【掌握信息】可调用工具查询：车型参数、活动详情、门店位置；可创建：试驾预约。\n"
            "【不掌握信息】不能承诺价格优惠、不能改变活动规则、不能直接报价。\n"
            "【语气】热情专业，像朋友推荐好东西。不催促、不强求。\n"
            "【底线】\n"
            "- 价格相关问题统一回复\"具体优惠需到店与销售顾问详谈\"\n"
            "- 客户表示无兴趣时礼貌结束，不打扰\n"
            "- 不评价竞品车型\n"
            "- 不承诺试驾一定有现车"
        ),
        greeting=(
            "您好，我是{company}的邀约助理，最近我们有{activity}活动，"
            "想邀请您到店体验，现在方便聊两句吗？"
        ),
        knowledge_base_id="kb-presale",
        allowed_tools=[
            "query_car_model",
            "query_activity",
            "create_test_drive_appointment",
            "transfer_to_human",
        ],
        escalation_rules=[
            EscalationRule(
                description="客户明确表示无兴趣",
                keywords=["不需要", "没兴趣", "别打了"],
            ),
            EscalationRule(
                description="客户询问具体价格", keywords=["多少钱", "价格", "优惠"]
            ),
        ],
    ),
}


DEFAULT_VARIABLES: dict[str, str] = {
    "company": "示例公司",
    "product": "消费贷",
    "orderNo": "DEMO20260627001",
    "activity": "夏日试驾季",
}


def get_scenario(scenario: str | Scenario) -> ScenarioConfig:
    """根据场景标识获取配置，字符串不匹配时回退到电商售后。"""
    if isinstance(scenario, str):
        try:
            scenario = Scenario(scenario)
        except ValueError:
            scenario = Scenario.ECOMMERCE
    return SCENARIO_CONFIGS[scenario]


def scenario_from_contract(data: Mapping[str, Any]) -> ScenarioConfig:
    """将 API 权威配置转换为运行时模型。"""
    return ScenarioConfig(
        scenario=str(data["scenario"]),
        name=str(data["name"]),
        description=str(data["description"]),
        system_prompt=str(data["systemPrompt"]),
        greeting=str(data["greeting"]),
        knowledge_base_id=str(data["knowledgeBaseId"]),
        allowed_tools=list(data.get("allowedTools", [])),
        escalation_rules=[
            EscalationRule(
                description=str(rule["description"]),
                keywords=rule.get("keywords"),
                emotions=rule.get("emotions"),
                consecutive_misses=rule.get("consecutiveMisses"),
            )
            for rule in data.get("escalationRules", [])
        ],
        tts_config=dict(data.get("ttsConfig") or {}),
        agent_identity=str(data.get("agentIdentity") or ""),
        communication_style=str(data.get("communicationStyle") or ""),
        communication_style_prompt=str(data.get("communicationStylePrompt") or ""),
        business_goal=str(data.get("businessGoal") or ""),
        llm_constraints=[str(item) for item in data.get("llmConstraints", [])],
        default_flow_id=data.get("defaultFlowId"),
    )
