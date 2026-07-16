"""Provider capabilities for short, deterministic control-plane requests."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    name: str
    supports_strict_tools: bool
    schema_dialect: str
    output_token_parameter: str
    control_extra_body: dict[str, Any]

    @classmethod
    def from_base_url(
        cls, base_url: str, *, provider: str | None = None
    ) -> "ProviderProfile":
        parsed = urlparse(base_url)
        host = parsed.netloc.casefold()
        path = parsed.path.rstrip("/").casefold()
        configured_provider = (provider or "").strip().casefold()
        if configured_provider == "deepseek" or "deepseek.com" in host:
            return cls(
                name="deepseek",
                supports_strict_tools=path.endswith("/beta"),
                schema_dialect="deepseek",
                output_token_parameter="max_tokens",
                control_extra_body={"thinking": {"type": "disabled"}},
            )
        if (
            configured_provider == "qwen"
            or "dashscope" in host
            or "modelstudio" in host
            or host.endswith(".maas.aliyuncs.com")
        ):
            return cls(
                name="qwen",
                supports_strict_tools=False,
                schema_dialect="generic",
                output_token_parameter="max_completion_tokens",
                control_extra_body={"enable_thinking": False},
            )
        if "api.openai.com" in host:
            return cls(
                name="openai",
                supports_strict_tools=True,
                schema_dialect="generic",
                output_token_parameter="max_completion_tokens",
                control_extra_body={},
            )
        return cls(
            name="generic",
            supports_strict_tools=False,
            schema_dialect="generic",
            output_token_parameter="max_tokens",
            control_extra_body={},
        )

    def compile_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        """Compile the domain schema to the provider's accepted dialect.

        DeepSeek strict mode does not accept array cardinality keywords and
        documents nullable values through ``anyOf``. Local validation remains
        authoritative, so removing server-side cardinality never weakens the
        state machine.
        """

        compiled = deepcopy(schema)
        if self.schema_dialect != "deepseek":
            return compiled

        def visit(value: Any) -> Any:
            if isinstance(value, list):
                return [visit(item) for item in value]
            if not isinstance(value, dict):
                return value
            result = {
                key: visit(item)
                for key, item in value.items()
                if key not in {"minItems", "maxItems"}
            }
            raw_type = result.get("type")
            if isinstance(raw_type, list):
                result.pop("type")
                result["anyOf"] = [{"type": item} for item in raw_type]
            return result

        return visit(compiled)

    def control_options(self, tool_name: str, max_output_tokens: int = 512) -> dict[str, Any]:
        options: dict[str, Any] = {
            "tool_choice": {
                "type": "function",
                "function": {"name": tool_name},
            },
            "parallel_tool_calls": False,
            "temperature": 0,
            self.output_token_parameter: max_output_tokens,
        }
        if self.control_extra_body:
            options["extra_body"] = deepcopy(self.control_extra_body)
        return options

    def chat_options(self) -> dict[str, Any]:
        """Provider options shared by normal chat and control requests.

        Voice calls default to non-reasoning generation: it is lower latency and
        avoids provider-specific reasoning state that this protocol does not
        persist across tool-result turns.
        """
        if not self.control_extra_body:
            return {}
        return {"extra_body": deepcopy(self.control_extra_body)}

    def raw_chat_body(self) -> dict[str, Any]:
        """Return provider options flattened for direct HTTP request bodies."""
        return deepcopy(self.control_extra_body)


__all__ = ["ProviderProfile"]
