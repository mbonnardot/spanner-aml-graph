"""Parameterized ISO GQL query definitions for Cloud Spanner Graph (`AmlGraph`)."""

from __future__ import annotations

GQL_CIRCULAR_LAYERING = """
GRAPH AmlGraph
MATCH p = TRAIL (a:Account {account_id: @account_id})-[chain:TRANSFERRED_TO]->{2, 6}(a:Account)
FILTER IS_SIMPLE(p)
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()

GQL_PRE_SETTLEMENT_CYCLE_CHECK = """
GRAPH AmlGraph
MATCH p = ACYCLIC (origin:Account {account_id: @to_account_id})-[chain:TRANSFERRED_TO]->{1, 5}(sender:Account {account_id: @from_account_id})
FILTER chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
  AND chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].event_timestamp <= @candidate_timestamp
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS prior_path,
       ARRAY_LENGTH(chain) AS prior_hops,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS latest_amount
""".strip()

GQL_SAME_ENTITY_RING = """
GRAPH AmlGraph
MATCH (e:Entity)-[:OWNS]->(src:Account),
      (e:Entity)-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 5}(dst)
FILTER src.account_id != dst.account_id
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(e) AS owner_entity,
       SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()

GQL_UBO_SHELL_RING = """
GRAPH AmlGraph
MATCH (ubo:Entity)-[:CONTROLS]->(s1:Entity)-[:OWNS]->(src:Account),
      (ubo:Entity)-[:CONTROLS]->(s2:Entity)-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 5}(dst)
FILTER s1.entity_id != s2.entity_id
  AND ubo.ubo_entity_id IS NULL
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(ubo) AS ubo_entity,
       SAFE.TO_JSON(s1) AS origin_shell,
       SAFE.TO_JSON(s2) AS destination_shell,
       SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()
