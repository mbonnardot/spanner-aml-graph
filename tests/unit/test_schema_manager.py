import re
from unittest.mock import MagicMock
from spanner_aml.schema_manager import apply_schema, load_ddl_statements


def test_load_ddl_statements_parses_all_tables_indexes_and_graph():
    statements = load_ddl_statements()
    assert len(statements) == 10
    assert statements[0].startswith("CREATE TABLE Banks")
    assert statements[1].startswith("CREATE TABLE Entities")
    assert statements[2].startswith("CREATE TABLE Accounts")
    assert statements[5].startswith("CREATE TABLE Transactions")
    assert statements[8].startswith("CREATE TABLE ComplianceAlerts")
    assert statements[9].startswith("CREATE OR REPLACE PROPERTY GRAPH AmlGraph")
    for stmt in statements:
        assert not stmt.endswith(";")
        if stmt.startswith("CREATE TABLE"):
            assert not re.search(r",\s*\)\s*PRIMARY KEY", stmt)


def test_apply_schema_calls_update_ddl_and_waits():
    mock_db = MagicMock()
    mock_op = MagicMock()
    mock_db.update_ddl.return_value = mock_op

    applied = apply_schema(mock_db, timeout_seconds=120)

    assert len(applied) == 10
    mock_db.update_ddl.assert_called_once_with(list(applied))
    mock_op.result.assert_called_once_with(120)
