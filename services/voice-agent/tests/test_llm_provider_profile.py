from __future__ import annotations

import pytest

from voice_agent.llm.provider_profile import ProviderProfile


SCHEMA = {
    "type": "object",
    "properties": {
        "commands": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "value": {"type": ["string", "null"]},
                },
                "required": ["value"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["commands"],
    "additionalProperties": False,
}


def test_deepseek_v1_uses_local_validation_and_compiles_schema() -> None:
    profile = ProviderProfile.from_base_url("https://api.deepseek.com/v1")
    compiled = profile.compile_schema(SCHEMA)

    assert profile.name == "deepseek"
    assert profile.supports_strict_tools is False
    assert "minItems" not in compiled["properties"]["commands"]
    assert "maxItems" not in compiled["properties"]["commands"]
    assert compiled["properties"]["commands"]["items"]["properties"]["value"] == {
        "anyOf": [{"type": "string"}, {"type": "null"}]
    }
    assert SCHEMA["properties"]["commands"]["minItems"] == 1


def test_deepseek_beta_enables_provider_strict_mode() -> None:
    profile = ProviderProfile.from_base_url("https://api.deepseek.com/beta")
    assert profile.supports_strict_tools is True
    options = profile.control_options("route_dialog_turn")
    assert options["extra_body"] == {"thinking": {"type": "disabled"}}
    assert options["max_tokens"] == 512


def test_qwen_control_profile_disables_thinking() -> None:
    profile = ProviderProfile.from_base_url(
        "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    options = profile.control_options("route_dialog_turn")
    assert profile.name == "qwen"
    assert profile.supports_strict_tools is False
    assert options["extra_body"] == {"enable_thinking": False}
    assert options["max_completion_tokens"] == 512
    assert options["parallel_tool_calls"] is False


@pytest.mark.parametrize(
    "base_url",
    [
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
        (
            "https://workspace-123.ap-southeast-1.maas.aliyuncs.com/"
            "compatible-mode/v1"
        ),
        (
            "https://workspace-123.cn-beijing.maas.aliyuncs.com/"
            "compatible-mode/v1"
        ),
    ],
)
def test_qwen_regional_and_workspace_maas_domains_are_recognized(
    base_url: str,
) -> None:
    profile = ProviderProfile.from_base_url(base_url)

    assert profile.name == "qwen"
    assert profile.control_options("route_dialog_turn")["extra_body"] == {
        "enable_thinking": False
    }


def test_explicit_provider_handles_custom_compatible_gateway() -> None:
    profile = ProviderProfile.from_base_url(
        "https://llm-gateway.internal.example/v1", provider="qwen"
    )

    assert profile.name == "qwen"
    assert profile.chat_options() == {"extra_body": {"enable_thinking": False}}


def test_openai_control_profile_preserves_strict_schema() -> None:
    profile = ProviderProfile.from_base_url("https://api.openai.com/v1")
    assert profile.supports_strict_tools is True
    assert profile.compile_schema(SCHEMA) == SCHEMA
