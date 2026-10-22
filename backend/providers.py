"""Provider adapters and private, local model settings.

API responses are deliberately normalized; upstream errors never include bodies,
headers or credentials. Add a protocol using register_provider().
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx


class ProviderError(RuntimeError):
    pass


def normalize_models(models: Any) -> list[dict]:
    result = []
    for item in (models if isinstance(models, list) else [])[:1000]:
        if isinstance(item, str):
            item = {"id": item, "name": item}
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            model_id = item["id"].strip()[:200]
            if model_id and model_id not in [m["id"] for m in result]:
                result.append({"id": model_id, "name": str(item.get("name") or model_id)[:200]})
    return result


def validate_base_url(value: str) -> str:
    value = value.rstrip("/")
    parts = urlsplit(value)
    if (
        parts.scheme not in {"https", "http"}
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise ValueError("Base URL должен быть HTTP(S)-адресом без пароля, query и fragment")
    if parts.scheme == "http" and parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Для удаленного API необходим HTTPS")
    return value


class Settings:
    def __init__(self, root: Path):
        self.path = Path(root) / "settings.private.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        defaults = {
            "providers": [
                {
                    "id": "default",
                    "name": "CheapVibeCode",
                    "type": "openai_compatible",
                    "base_url": os.getenv("SCIENCE_HUB_API_BASE_URL", "https://ru.cheapvibecode.ru/v1"),
                    "api_key": "",
                    "models": [],
                }
            ],
            "default_provider_id": "default",
            "orchestrator_model": os.getenv("SCIENCE_HUB_MODEL", ""),
            "vision_model": os.getenv("SCIENCE_HUB_VISION_MODEL", ""),
            "max_rounds": 8,
            "max_tokens": 2048,
        }
        if self.path.exists():
            try:
                defaults.update(json.loads(self.path.read_text()))
                self.path.chmod(0o600)
            except (OSError, json.JSONDecodeError):
                raise ProviderError("Не удалось прочитать локальные настройки API") from None
        self.data = defaults

    def key(self, provider: dict) -> str:
        return provider.get("api_key") or (
            os.getenv("SCIENCE_HUB_API_KEY", "") if provider["id"] == "default" else ""
        )

    def provider(self, provider_id: str | None = None) -> dict:
        provider_id = provider_id or self.data["default_provider_id"]
        for provider in self.data["providers"]:
            if provider["id"] == provider_id:
                return {**provider, "api_key": self.key(provider)}
        raise ProviderError("Выбранный API-провайдер не найден")

    def public(self) -> dict:
        return self.redact(
            {
                **{
                    k: self.data[k]
                    for k in (
                        "default_provider_id",
                        "orchestrator_model",
                        "vision_model",
                        "max_rounds",
                        "max_tokens",
                    )
                },
                "providers": [
                    {k: p.get(k) for k in ("id", "name", "type", "base_url", "models")}
                    | {"has_key": bool(self.key(p))}
                    for p in self.data["providers"]
                ],
            }
        )

    def update(self, patch: dict) -> dict:
        candidate = {**self.data}
        if "providers" in patch:
            if not isinstance(patch["providers"], list) or not 1 <= len(patch["providers"]) <= 20:
                raise ValueError("Нужно указать от 1 до 20 провайдеров")
            old = {p["id"]: p for p in self.data["providers"]}
            providers, seen = [], set()
            for p in patch["providers"]:
                pid = str(p.get("id", ""))
                if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", pid) or pid in seen:
                    raise ValueError("ID провайдера некорректен или повторяется")
                seen.add(pid)
                previous = old.get(pid, {})
                kind = p.get("type", previous.get("type", "openai_compatible"))
                if kind not in ADAPTERS:
                    raise ValueError("Неподдерживаемый тип API")
                key = p.get("api_key") or previous.get("api_key", "")
                if not isinstance(key, str) or len(key) > 4096:
                    raise ValueError("Некорректный API-ключ")
                providers.append(
                    {
                        "id": pid,
                        "name": str(p.get("name", previous.get("name", pid)))[:120],
                        "type": kind,
                        "base_url": validate_base_url(p.get("base_url", previous.get("base_url", ""))),
                        "api_key": key,
                        "models": normalize_models(p.get("models", previous.get("models", []))),
                    }
                )
            candidate["providers"] = providers
        for key in ("default_provider_id", "orchestrator_model", "vision_model"):
            if key in patch:
                candidate[key] = str(patch[key])[:200]
        if candidate["default_provider_id"] not in {p["id"] for p in candidate["providers"]}:
            raise ValueError("Выберите существующего провайдера по умолчанию")
        for key, low, high in (("max_rounds", 1, 24), ("max_tokens", 128, 8192)):
            if key in patch:
                value = patch[key]
                if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                    raise ValueError(f"{key}: допустимый диапазон {low}–{high}")
                candidate[key] = value
        self.data = candidate
        self.save()
        return self.public()

    def save(self):
        fd, tmp = tempfile.mkstemp(prefix=".settings-", dir=self.path.parent)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(fd, 0o600)
            else:
                os.chmod(tmp, 0o600)
            with os.fdopen(fd, "w") as file:
                json.dump(self.data, file, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def redact(self, value: Any) -> Any:
        secrets = [self.key(p) for p in self.data["providers"] if self.key(p)]

        def clean(v):
            if isinstance(v, str):
                for secret in secrets:
                    v = v.replace(secret, "[REDACTED]")
                return v
            if isinstance(v, list):
                return [clean(i) for i in v]
            if isinstance(v, dict):
                return {k: clean(i) for k, i in v.items()}
            return v

        return clean(value)


class OpenAICompatible:
    def __init__(self, provider: dict):
        self.provider = provider
        self.base_url = validate_base_url(provider["base_url"])

    async def request(self, method: str, path: str, payload: dict | None = None):
        if not self.provider.get("api_key"):
            raise ProviderError("API-ключ не задан. Добавьте его в настройках")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(90, connect=15), follow_redirects=False
            ) as client:
                response = await client.request(
                    method,
                    self.base_url + path,
                    headers={
                        "Authorization": "Bearer " + self.provider["api_key"],
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if response.status_code >= 300:
                    explanation = {
                        401: "неверный API-ключ",
                        403: "доступ запрещён",
                        402: "недостаточно средств",
                        404: "модель или API endpoint не найден",
                        429: "лимит запросов или средств",
                        400: "модель не поддерживает параметры запроса",
                    }.get(response.status_code, "ошибка API")
                    raise ProviderError(f"Провайдер: {explanation} (HTTP {response.status_code})")
                if len(response.content) > 8_000_000:
                    raise ProviderError("Ответ API превышает допустимый размер")
                return response.json()
        except httpx.TimeoutException:
            raise ProviderError("API не ответил за 90 секунд") from None
        except httpx.HTTPError:
            raise ProviderError("Не удалось подключиться к API-провайдеру") from None
        except (ValueError, TypeError):
            raise ProviderError("API вернул некорректный JSON") from None

    async def models(self) -> list[dict]:
        data = await self.request("GET", "/models")
        models = normalize_models(data.get("data", [])) if isinstance(data, dict) else []
        if not models:
            raise ProviderError("Провайдер не вернул доступные модели")
        return models

    async def complete(self, *, model: str, messages: list, tools: list, max_tokens: int) -> dict:
        if not model:
            raise ProviderError("Выберите модель оркестратора в настройках")
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "stream": False}
        if tools:
            payload.update(tools=tools, tool_choice="auto")
        data = await self.request("POST", "/chat/completions", payload)
        try:
            message = data["choices"][0]["message"]
            if not isinstance(message, dict):
                raise ValueError()
            content = message.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(str(i.get("text", "")) for i in content if isinstance(i, dict))
            if not isinstance(content, str) or not isinstance(message.get("tool_calls", []), list):
                raise ValueError()
            return {
                "content": content,
                "tool_calls": message.get("tool_calls") or [],
                "usage": data.get("usage") or {},
                "finish_reason": data["choices"][0].get("finish_reason"),
            }
        except (KeyError, IndexError, TypeError, ValueError):
            raise ProviderError("API вернул ответ без сообщения модели") from None


ADAPTERS = {"openai_compatible": OpenAICompatible}


def register_provider(kind: str, adapter):
    ADAPTERS[kind] = adapter


def adapter_for(provider: dict):
    adapter = ADAPTERS.get(provider.get("type", "openai_compatible"))
    if adapter is None:
        raise ProviderError("Неподдерживаемый тип API")
    return adapter(provider)
