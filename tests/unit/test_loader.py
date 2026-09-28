from pathlib import Path
from unittest.mock import MagicMock
from spanner_aml.loader import (
    DEFAULT_SEED_ACCOUNTS_CSV,
    DEFAULT_SEED_ENRICHMENTS_JSON,
    DEFAULT_SEED_TRANSACTIONS_CSV,
    compute_transaction_id,
    load_dataset_into_spanner,
    parse_ibm_aml_files,
)


def test_compute_transaction_id_is_deterministic_and_distinguishes_ordinals():
    tx_id_1 = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 0
    )
    tx_id_2 = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 0
    )
    tx_id_dup = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 1
    )
    assert tx_id_1 == tx_id_2
    assert tx_id_1.startswith("tx_")
    assert tx_id_1 != tx_id_dup


def test_parse_ibm_aml_seed_files_with_enrichments():
    dataset = parse_ibm_aml_files(
        accounts_csv=DEFAULT_SEED_ACCOUNTS_CSV,
        transactions_csv=DEFAULT_SEED_TRANSACTIONS_CSV,
        enrichments_json=DEFAULT_SEED_ENRICHMENTS_JSON,
    )
    assert len(dataset.banks) == 8
    # 14 distinct entities in CSV + 1 extra UBO entity (ENT_UBO_VIKTOR)
    assert len(dataset.entities) == 15
    assert len(dataset.accounts) == 15
    assert len(dataset.transactions) == 12

    entities_by_id = {e.entity_id: e for e in dataset.entities}
    assert entities_by_id["ENT_UBO_VIKTOR"].is_pep_or_sanctioned is True
    assert entities_by_id["ENT_SHELL_ALPHA"].ubo_entity_id == "ENT_UBO_VIKTOR"
    assert entities_by_id["ENT_SHELL_BETA"].ubo_entity_id == "ENT_UBO_VIKTOR"


def test_load_dataset_into_spanner_chunks_batches_topologically():
    dataset = parse_ibm_aml_files(
        accounts_csv=DEFAULT_SEED_ACCOUNTS_CSV,
        transactions_csv=DEFAULT_SEED_TRANSACTIONS_CSV,
        enrichments_json=DEFAULT_SEED_ENRICHMENTS_JSON,
    )
    mock_db = MagicMock()
    mock_batch = MagicMock()
    mock_db.batch.return_value.__enter__.return_value = mock_batch

    counts = load_dataset_into_spanner(mock_db, dataset, batch_size=5)

    assert counts == {
        "Banks": 8,
        "Entities": 15,
        "Accounts": 15,
        "Transactions": 12,
    }
    assert mock_batch.insert_or_update.called
