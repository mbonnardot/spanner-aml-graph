import re
from unittest.mock import MagicMock
from spanner_aml.schema_manager import apply_schema, load_ddl_statements


def test_load_ddl_statements_parses_all_tables_indexes_and_graph():
    statements = load_ddl_statements()
    assert len(statements) == 12
    assert statements[0].startswith("CREATE TABLE IF NOT EXISTS Banks")
    assert statements[1].startswith("CREATE TABLE IF NOT EXISTS Entities")
    assert statements[2].startswith("CREATE INDEX IF NOT EXISTS EntitiesByUbo")
    assert statements[3].startswith("CREATE INDEX IF NOT EXISTS EntitiesByRiskTier")
    assert statements[4].startswith("CREATE TABLE IF NOT EXISTS Accounts")
    assert statements[7].startswith("CREATE TABLE IF NOT EXISTS Transactions")
    assert statements[10].startswith("CREATE TABLE IF NOT EXISTS ComplianceAlerts")
    assert statements[11].startswith("CREATE OR REPLACE PROPERTY GRAPH AmlGraph")
    for stmt in statements:
        assert not stmt.endswith(";")
        if stmt.startswith("CREATE TABLE"):
            assert not re.search(r",\s*\)\s*PRIMARY KEY", stmt)


def test_apply_schema_calls_update_ddl_and_waits():
    mock_db = MagicMock()
    mock_op = MagicMock()
    mock_db.update_ddl.return_value = mock_op

    applied = apply_schema(mock_db, timeout_seconds=120)

    assert len(applied) == 12
    mock_db.update_ddl.assert_called_once_with(list(applied))
    mock_op.result.assert_called_once_with(120)
