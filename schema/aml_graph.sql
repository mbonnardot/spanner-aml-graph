-- Cloud Spanner Relational & Property Graph Schema for spanner-aml-graph

CREATE TABLE Banks (
  bank_id      STRING(64) NOT NULL,
  bank_name    STRING(256) NOT NULL,
  bic_swift    STRING(16),
  jurisdiction STRING(64)
) PRIMARY KEY (bank_id);

CREATE TABLE Entities (
  entity_id            STRING(64) NOT NULL,
  entity_name          STRING(256) NOT NULL,
  entity_type          STRING(32) NOT NULL DEFAULT ('CORPORATION'),
  kyc_risk_tier        STRING(32) NOT NULL DEFAULT ('LOW'),
  is_pep_or_sanctioned BOOL NOT NULL DEFAULT (FALSE),
  jurisdiction         STRING(64),
  ubo_entity_id        STRING(64),
  CONSTRAINT FK_Entity_Ubo FOREIGN KEY (ubo_entity_id) REFERENCES Entities (entity_id) NOT ENFORCED
) PRIMARY KEY (entity_id);

CREATE TABLE Accounts (
  account_id     STRING(64) NOT NULL,
  bank_id        STRING(64) NOT NULL,
  entity_id      STRING(64) NOT NULL,
  iban           STRING(34),
  currency       STRING(16) NOT NULL,
  account_status STRING(32) NOT NULL DEFAULT ('ACTIVE'),
  is_flagged     BOOL NOT NULL DEFAULT (FALSE),
  CONSTRAINT FK_Account_Bank FOREIGN KEY (bank_id) REFERENCES Banks (bank_id),
  CONSTRAINT FK_Account_Entity FOREIGN KEY (entity_id) REFERENCES Entities (entity_id)
) PRIMARY KEY (account_id);

CREATE INDEX AccountsByEntity
  ON Accounts (entity_id)
  STORING (bank_id, currency, account_status, is_flagged);

CREATE INDEX AccountsByBank
  ON Accounts (bank_id)
  STORING (entity_id, currency, account_status, is_flagged);

CREATE TABLE Transactions (
  transaction_id     STRING(64) NOT NULL,
  from_bank_id       STRING(64) NOT NULL,
  from_account_id    STRING(64) NOT NULL,
  to_bank_id         STRING(64) NOT NULL,
  to_account_id      STRING(64) NOT NULL,
  event_timestamp    TIMESTAMP NOT NULL,
  amount_received    NUMERIC NOT NULL,
  receiving_currency STRING(16) NOT NULL,
  amount_paid        NUMERIC NOT NULL,
  payment_currency   STRING(16) NOT NULL,
  payment_format     STRING(32) NOT NULL,
  is_laundering      BOOL NOT NULL DEFAULT (FALSE),
  settlement_status  STRING(32) NOT NULL DEFAULT ('SETTLED'),
  CONSTRAINT FK_Tx_FromAccount FOREIGN KEY (from_account_id) REFERENCES Accounts (account_id) NOT ENFORCED,
  CONSTRAINT FK_Tx_ToAccount FOREIGN KEY (to_account_id) REFERENCES Accounts (account_id) NOT ENFORCED
) PRIMARY KEY (transaction_id);

CREATE INDEX TransactionsByFromAccount
  ON Transactions (from_account_id, event_timestamp)
  STORING (to_account_id, amount_paid, payment_currency, amount_received, receiving_currency, payment_format, settlement_status, is_laundering);

CREATE INDEX TransactionsByToAccount
  ON Transactions (to_account_id, event_timestamp)
  STORING (from_account_id, amount_paid, payment_currency, amount_received, receiving_currency, payment_format, settlement_status, is_laundering);

CREATE TABLE ComplianceAlerts (
  alert_id               STRING(64) NOT NULL,
  trigger_transaction_id STRING(64) NOT NULL,
  subject_entity_id      STRING(64),
  typology               STRING(64) NOT NULL,
  risk_score             FLOAT64 NOT NULL,
  evidence_subgraph      JSON NOT NULL,
  sar_narrative          STRING(MAX),
  alert_status           STRING(32) NOT NULL DEFAULT ('OPEN'),
  created_at             TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (alert_id);

CREATE OR REPLACE PROPERTY GRAPH AmlGraph
  NODE TABLES (
    Banks AS Bank
      KEY (bank_id)
      LABEL Bank PROPERTIES (bank_id, bank_name, bic_swift, jurisdiction),
    Entities AS Entity
      KEY (entity_id)
      LABEL Entity PROPERTIES (
        entity_id, entity_name, entity_type, kyc_risk_tier,
        is_pep_or_sanctioned, jurisdiction, ubo_entity_id
      ),
    Accounts AS Account
      KEY (account_id)
      LABEL Account PROPERTIES (
        account_id, bank_id, entity_id, iban,
        currency, account_status, is_flagged
      )
  )
  EDGE TABLES (
    Entities AS EntityControlsEntity
      KEY (entity_id)
      SOURCE KEY (ubo_entity_id) REFERENCES Entity (entity_id)
      DESTINATION KEY (entity_id) REFERENCES Entity (entity_id)
      LABEL CONTROLS PROPERTIES (ubo_entity_id, entity_id),
    Accounts AS EntityOwnsAccount
      KEY (account_id)
      SOURCE KEY (entity_id) REFERENCES Entity (entity_id)
      DESTINATION KEY (account_id) REFERENCES Account (account_id)
      LABEL OWNS PROPERTIES (entity_id, account_id),
    Accounts AS AccountHeldAtBank
      KEY (account_id)
      SOURCE KEY (account_id) REFERENCES Account (account_id)
      DESTINATION KEY (bank_id) REFERENCES Bank (bank_id)
      LABEL HELD_AT PROPERTIES (account_id, bank_id),
    Transactions AS AccountTransfers
      KEY (transaction_id)
      SOURCE KEY (from_account_id) REFERENCES Account (account_id)
      DESTINATION KEY (to_account_id) REFERENCES Account (account_id)
      LABEL TRANSFERRED_TO PROPERTIES (
        transaction_id, from_bank_id, from_account_id, to_bank_id, to_account_id,
        event_timestamp, amount_paid, payment_currency,
        amount_received, receiving_currency, payment_format,
        settlement_status, is_laundering
      )
  );
