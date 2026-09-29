"""Pydantic request and response schemas for the Spanner Graph AML Workbench API."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class ApiEnvelope(BaseModel):
    """Consistent API response envelope."""

    success: bool
    data: Any | None = None
    error: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class InvestigateRequest(BaseModel):
    """Request payload to run Spanner Graph detection + KYC enrichment ($0 LLM cost)."""

    case_id: str | None = Field(default=None, max_length=64)
    typology: str = Field(..., min_length=2, max_length=64)
    account_id: str = Field(default="", max_length=64)
    min_amount: float = Field(default=100.0, ge=0.0)


class InterceptRequest(BaseModel):
    """Request payload to evaluate a candidate payment through the Pre-Settlement Interceptor."""

    from_account_id: str = Field(..., min_length=1, max_length=64)
    to_account_id: str = Field(..., min_length=1, max_length=64)
    amount_paid: float = Field(..., gt=0.0)
    payment_currency: str = Field(default="USD", min_length=2, max_length=16)
    payment_format: str = Field(default="Wire", min_length=2, max_length=32)
    persist: bool = Field(default=False)


class GenerateSarRequest(BaseModel):
    """Request payload to trigger single-ticket SAR generation and ComplianceAlerts persistence."""

    case_id: str | None = Field(default=None, max_length=64)
    typology: str = Field(..., min_length=2, max_length=64)
    account_id: str = Field(default="", max_length=64)
    min_amount: float = Field(default=100.0, ge=0.0)
    persist_alert: bool = Field(default=True)
