"""Adapter registry."""

from .generic import GenericAdapter
from .apis import AlbertHeijnAdapter, OdaAdapter, NuxtAdapter, JsonPathAdapter

ADAPTERS = {
    "generic": GenericAdapter(),
    "ah": AlbertHeijnAdapter(),
    "oda": OdaAdapter(),
    "nuxt": NuxtAdapter(),
    "json": JsonPathAdapter(),
}


def get_adapter(name: str):
    if name not in ADAPTERS:
        raise KeyError(f"unknown adapter '{name}' (have: {', '.join(sorted(ADAPTERS))})")
    return ADAPTERS[name]
