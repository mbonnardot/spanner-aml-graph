"""Environment configuration and Cloud Spanner client factory."""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any, Mapping


class ConfigurationError(ValueError):
    """Raised when required Spanner configuration is missing or invalid."""


@dataclass(frozen=True)
class SpannerConfig:
    """Immutable Cloud Spanner connection configuration."""

    project_id: str
    instance_id: str
    database_id: str
    emulator_host: str | None = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> SpannerConfig:
        """Load and validate Spanner configuration from environment variables."""
        env = os.environ if environ is None else environ
        required_keys = (
            "SPANNER_PROJECT_ID",
            "SPANNER_INSTANCE_ID",
            "SPANNER_DATABASE_ID",
        )
        missing = [key for key in required_keys if not env.get(key, "").strip()]
        if missing:
            raise ConfigurationError(
                f"Missing required environment variable(s): {', '.join(missing)}"
            )
        emulator = env.get("SPANNER_EMULATOR_HOST", "").strip() or None
        return cls(
            project_id=env["SPANNER_PROJECT_ID"].strip(),
            instance_id=env["SPANNER_INSTANCE_ID"].strip(),
            database_id=env["SPANNER_DATABASE_ID"].strip(),
            emulator_host=emulator,
        )

    def get_database(self, client: Any | None = None) -> Any:
        """Return a bound Cloud Spanner Database handle."""
        if client is None:
            from google.cloud import spanner  # type: ignore[import-untyped]

            client = spanner.Client(project=self.project_id)
        instance = client.instance(self.instance_id)
        return instance.database(self.database_id)
