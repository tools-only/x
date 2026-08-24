from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse


class ConfigError(ValueError):
    pass


def _path_candidates(path: Path) -> list[Path]:
    expanded = path.expanduser()
    if expanded.is_absolute():
        return [expanded.resolve()]
    working_directory = Path.cwd()
    candidates = [working_directory / expanded]
    candidates.extend(parent / expanded for parent in working_directory.parents)
    return [candidate.resolve() for candidate in candidates]


def _find_file(path: Path) -> Path | None:
    return next((candidate for candidate in _path_candidates(path) if candidate.is_file()), None)


def _dotenv_values(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if "=" not in line:
            raise ConfigError(f"invalid .env assignment at {path}:{line_number}")
        name, value = line.split("=", 1)
        name = name.strip()
        if not name:
            raise ConfigError(f"invalid .env assignment at {path}:{line_number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[name] = value
    return values


def load_dotenv(path: Path | str = ".env") -> None:
    dotenv_path = _find_file(Path(path))
    if dotenv_path is None:
        return
    for name, value in _dotenv_values(dotenv_path).items():
        os.environ.setdefault(name, value)


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    provider_type: str
    base_url: str
    endpoint: str
    model: str
    api_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    secret_headers: set[str] = field(default_factory=set)
    timeout_seconds: float = 60.0
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer"
    anthropic_version: str | None = None
    reasoning: dict | None = None
    reasoning_effort: str | None = None

    @property
    def url(self) -> str:
        return self.base_url.rstrip("/") + "/" + self.endpoint.lstrip("/")

    def redacted(self) -> dict:
        headers = {
            name: "***" if name in self.secret_headers else value
            for name, value in self.headers.items()
        }
        return {
            "name": self.name,
            "type": self.provider_type,
            "base_url": self.base_url,
            "endpoint": self.endpoint,
            "url": self.url,
            "model": self.model,
            "api_key": "***" if self.api_key else None,
            "headers": headers,
            "timeout_seconds": self.timeout_seconds,
            "auth_header": self.auth_header,
            "auth_prefix": self.auth_prefix,
            "anthropic_version": self.anthropic_version,
            "reasoning": self.reasoning,
            "reasoning_effort": self.reasoning_effort,
        }


@dataclass(frozen=True)
class HarnessConfig:
    path: Path
    default_provider: str
    providers: dict[str, dict]
    environment: Mapping[str, str]

    def resolve_provider(self, name: str | None = None, *, require_secret: bool = False) -> ProviderConfig:
        selected = name or self.environment.get("HOS_PROVIDER") or self.default_provider
        if selected not in self.providers:
            raise ConfigError(f"unknown provider {selected!r}; available: {', '.join(sorted(self.providers))}")
        raw = self.providers[selected]
        provider_type = str(raw.get("type", "openai_compatible"))
        if provider_type not in {"openai_compatible", "anthropic_messages"}:
            raise ConfigError(f"provider {selected!r} has unsupported type {provider_type!r}")

        base_url = self.environment.get("HOS_BASE_URL") or raw.get("base_url")
        model = self.environment.get("HOS_MODEL") or raw.get("model")
        default_endpoint = "/v1/messages" if provider_type == "anthropic_messages" else "/chat/completions"
        endpoint = self.environment.get("HOS_ENDPOINT") or raw.get("endpoint", default_endpoint)
        if not isinstance(base_url, str) or not base_url:
            raise ConfigError(f"provider {selected!r} requires base_url")
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigError(f"provider {selected!r} base_url must be an absolute HTTP(S) URL")
        if not isinstance(model, str) or not model:
            raise ConfigError(f"provider {selected!r} requires model")
        if not isinstance(endpoint, str) or not endpoint.startswith("/"):
            raise ConfigError(f"provider {selected!r} endpoint must start with '/'")

        api_key_env = raw.get("api_key_env")
        api_key = self.environment.get("HOS_API_KEY")
        if api_key is None and isinstance(api_key_env, str):
            api_key = self.environment.get(api_key_env)
        if require_secret and isinstance(api_key_env, str) and not api_key:
            raise ConfigError(f"provider {selected!r} requires environment variable {api_key_env}")

        headers = {str(key): str(value) for key, value in raw.get("headers", {}).items()}
        secret_headers: set[str] = set()
        for header, variable in raw.get("header_env", {}).items():
            value = self.environment.get(str(variable))
            if value is None:
                continue
            header_name = str(header)
            headers[header_name] = value
            secret_headers.add(header_name)

        timeout = float(raw.get("timeout_seconds", 60))
        if timeout <= 0:
            raise ConfigError(f"provider {selected!r} timeout_seconds must be positive")
        default_auth_header = "x-api-key" if provider_type == "anthropic_messages" else "Authorization"
        default_auth_prefix = "" if provider_type == "anthropic_messages" else "Bearer"
        anthropic_version = raw.get("anthropic_version", "2023-06-01")
        if provider_type == "anthropic_messages" and (
            not isinstance(anthropic_version, str) or not anthropic_version
        ):
            raise ConfigError(f"provider {selected!r} anthropic_version must be a non-empty string")
        reasoning = raw.get("reasoning")
        if reasoning is not None and not isinstance(reasoning, dict):
            raise ConfigError(f"provider {selected!r} reasoning must be a table")
        reasoning_effort = raw.get("reasoning_effort")
        if reasoning_effort is not None and (
            not isinstance(reasoning_effort, str) or not reasoning_effort.strip()
        ):
            raise ConfigError(f"provider {selected!r} reasoning_effort must be a non-empty string")
        return ProviderConfig(
            name=selected,
            provider_type=provider_type,
            base_url=base_url.rstrip("/"),
            endpoint=endpoint,
            model=model,
            api_key=api_key,
            headers=headers,
            secret_headers=secret_headers,
            timeout_seconds=timeout,
            auth_header=str(raw.get("auth_header", default_auth_header)),
            auth_prefix=str(raw.get("auth_prefix", default_auth_prefix)),
            anthropic_version=anthropic_version if provider_type == "anthropic_messages" else None,
            reasoning=dict(reasoning) if isinstance(reasoning, dict) else None,
            reasoning_effort=reasoning_effort.strip() if isinstance(reasoning_effort, str) else None,
        )


def load_config(path: Path | str | None = None, *, environment: Mapping[str, str] | None = None) -> HarnessConfig:
    if environment is None:
        dotenv_path = _find_file(Path(".env"))
        dotenv = _dotenv_values(dotenv_path) if dotenv_path is not None else {}
        env = {**dotenv, **os.environ}
    else:
        env = dict(environment)
    requested_path = Path(path or env.get("HOS_CONFIG", "hos.toml"))
    selected_path = _find_file(requested_path)
    if selected_path is None:
        attempted = ", ".join(str(candidate) for candidate in _path_candidates(requested_path))
        raise ConfigError(f"configuration file not found; tried: {attempted}")
    with selected_path.open("rb") as handle:
        data = tomllib.load(handle)
    if data.get("version") != 1:
        raise ConfigError("configuration version must be 1")
    providers = data.get("providers")
    if not isinstance(providers, dict) or not providers:
        raise ConfigError("configuration must define at least one [providers.<name>] profile")
    default_provider = data.get("default_provider")
    if not isinstance(default_provider, str) or not default_provider:
        raise ConfigError("configuration requires default_provider")
    return HarnessConfig(
        path=selected_path,
        default_provider=default_provider,
        providers=providers,
        environment=env,
    )
