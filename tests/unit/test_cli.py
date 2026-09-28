from decimal import Decimal
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from spanner_aml.cli import main
from spanner_aml.models import LaunderingRingEvidence, TransferHop


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.apply_schema")
def test_cli_init_schema(mock_apply, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    mock_apply.return_value = ("CREATE TABLE Banks...",)

    rc = main(["init-schema"])
    assert rc == 0
    mock_apply.assert_called_once()
    out = capsys.readouterr().out
    assert "Applied 1 DDL statement(s)" in out


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.load_dataset_into_spanner")
def test_cli_load_data_seed(mock_load, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    mock_load.return_value = {"Banks": 8, "Entities": 15, "Accounts": 15, "Transactions": 12}

    rc = main(["load-data", "--seed"])
    assert rc == 0
    mock_load.assert_called_once()
    out = capsys.readouterr().out
    assert '"Transactions": 12' in out


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.RingDetector")
def test_cli_detect_rings_prints_json_summary(mock_detector_cls, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    t0 = datetime(2026, 9, 28, 8, 0, tzinfo=timezone.utc)
    hop = TransferHop(
        transaction_id="tx_1",
        from_account_id="ACC_RING1_A",
        to_account_id="ACC_RING1_B",
        amount_paid=Decimal("100000.00"),
        amount_received=Decimal("98800.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t0,
    )
    evidence = LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=(hop,),
        subject_entity_id=None,
        query_latency_ms=11.5,
        raw_graph_path={},
    )
    mock_detector = MagicMock()
    mock_detector.scan_all_typologies.return_value = (evidence,)
    mock_detector_cls.return_value = mock_detector

    rc = main(["detect-rings", "--account-id", "ACC_RING1_A", "--min-amount", "50000"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "CIRCULAR_LAYERING" in out
    assert "ACC_RING1_A" in out
