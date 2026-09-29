from pathlib import Path
from unittest.mock import MagicMock
from spanner_aml.loader import (
    DEFAULT_SEED_ACCOUNTS_CSV,
    DEFAULT_SEED_ENRICHMENTS_JSON,
    DEFAULT_SEED_TRANSACTIONS_CSV,
    build_simulation_dataset,
    compute_transaction_id,
    infer_entity_type,
    load_dataset_into_spanner,
    normalize_bank_id,
    parse_ibm_aml_files,
    parse_patterns_file,
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


def test_normalize_bank_id_and_infer_entity_type():
    assert normalize_bank_id("01467") == "1467"
    assert normalize_bank_id("000") == "0"
    assert normalize_bank_id("20") == "20"
    assert normalize_bank_id("BANK_001") == "BANK_001"

    assert infer_entity_type("Corporation #33520") == "CORPORATION"
    assert infer_entity_type("Partnership #35397") == "PARTNERSHIP"
    assert infer_entity_type("Sole Proprietorship #50438") == "SOLE_PROPRIETORSHIP"
    assert infer_entity_type("Individual #99") == "INDIVIDUAL"


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


def test_parse_patterns_file_and_build_simulation_dataset(tmp_path: Path):
    acc_csv = tmp_path / "accounts.csv"
    acc_csv.write_text(
        "Bank Name,Bank ID,Account Number,Entity ID,Entity Name\n"
        "Bank A,1467,8013C4030,800A,Partnership #1\n"
        "Bank B,20,80BC62F10,800B,Corporation #2\n"
        "Bank C,99,809999990,800C,Sole Proprietorship #3\n",
        encoding="utf-8",
    )
    patterns_txt = tmp_path / "patterns.txt"
    patterns_txt.write_text(
        "BEGIN LAUNDERING ATTEMPT - CYCLE:  Max 2 hops\n"
        "2022/09/01 00:03,01467,8013C4030,020,80BC62F10,58702.10,Yuan,58702.10,Yuan,ACH,1\n"
        "2022/09/01 02:52,020,80BC62F10,01467,8013C4030,7945.55,US Dollar,7945.55,US Dollar,ACH,1\n"
        "END LAUNDERING ATTEMPT - CYCLE\n",
        encoding="utf-8",
    )
    trans_csv = tmp_path / "trans.csv"
    trans_csv.write_text(
        "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n"
        "2022/09/01 00:20,099,809999990,099,809999990,3697.34,US Dollar,3697.34,US Dollar,Reinvestment,0\n"
        "2022/09/01 01:00,099,809999990,020,80BC62F10,250.00,US Dollar,250.00,US Dollar,ACH,0\n",
        encoding="utf-8",
    )

    episodes = parse_patterns_file(patterns_txt)
    assert len(episodes) == 1
    assert episodes[0].pattern_type == "CYCLE"
    assert episodes[0].pattern_detail == "Max 2 hops"
    assert len(episodes[0].transactions) == 2
    assert episodes[0].transactions[0].from_bank_id == "1467"
    assert episodes[0].transactions[0].to_bank_id == "20"
    assert episodes[0].account_ids == ("8013C4030", "80BC62F10")

    sim_ds = build_simulation_dataset(
        accounts_csv=acc_csv,
        patterns_path=patterns_txt,
        transactions_csv=trans_csv,
        background_tx_limit=10,
        skip_reinvestment_self_loops=True,
    )
    assert len(sim_ds.banks) == 3
    assert len(sim_ds.accounts) == 3
    # 2 pattern txs + 1 non-reinvestment background tx
    assert len(sim_ds.transactions) == 3


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

