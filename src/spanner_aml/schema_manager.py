"""DDL loader and schema application utilities for Cloud Spanner Graph."""

from __future__ import annotations

from pathlib import Path
from typing import Any

DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "schema" / "aml_graph.sql"
)


def load_ddl_statements(sql_path: Path | None = None) -> tuple[str, ...]:
    """Parse a SQL DDL file into semicolon-stripped Spanner DDL statements."""
    target = DEFAULT_SCHEMA_PATH if sql_path is None else sql_path
    raw_text = target.read_text(encoding="utf-8")
    cleaned_lines = [
        line
        for line in raw_text.splitlines()
        if not line.strip().startswith("--")
    ]
    joined = "\n".join(cleaned_lines)
    statements = [
        chunk.strip()
        for chunk in joined.split(";")
        if chunk.strip()
    ]
    return tuple(statements)


def apply_schema(
    database: Any,
    sql_path: Path | None = None,
    timeout_seconds: int = 300,
) -> tuple[str, ...]:
    """Apply all DDL statements in topological order to the target Spanner database."""
    statements = load_ddl_statements(sql_path)
    operation = database.update_ddl(list(statements))
    operation.result(timeout_seconds)
    return statements
