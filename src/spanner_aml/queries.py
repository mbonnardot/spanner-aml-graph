"""Parameterized ISO GQL query definitions for Cloud Spanner Graph (`AmlGraph`)."""

from __future__ import annotations

GQL_CIRCULAR_LAYERING = """
GRAPH AmlGraph
MATCH p = TRAIL (a:Account {account_id: @account_id})-[chain:TRANSFERRED_TO]->{2, 12}(a:Account)
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
MATCH (e:Entity {kyc_risk_tier: "HIGH"})-[:OWNS]->(src:Account),
      (e:Entity)-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 4}(dst)
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
MATCH (ubo:Entity {kyc_risk_tier: "HIGH"})-[:CONTROLS]->(s1:Entity {kyc_risk_tier: "HIGH"})-[:OWNS]->(src:Account),
      (ubo:Entity)-[:CONTROLS]->(s2:Entity {kyc_risk_tier: "HIGH"})-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 4}(dst)
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

GQL_FAN_OUT = """
GRAPH AmlGraph
MATCH (src:Account {account_id: @account_id})-[e:TRANSFERRED_TO]->(dst:Account)
FILTER src.account_id != dst.account_id
  AND e.amount_paid >= @min_amount
RETURN src.account_id AS hub_account_id,
       COUNT(DISTINCT dst.account_id) AS out_degree,
       ARRAY_AGG(SAFE.TO_JSON(e) ORDER BY e.event_timestamp) AS out_edges
GROUP BY hub_account_id
NEXT
FILTER out_degree >= @min_degree
RETURN hub_account_id, out_degree, out_edges
""".strip()

GQL_FAN_IN = """
GRAPH AmlGraph
MATCH (src:Account)-[e:TRANSFERRED_TO]->(dst:Account {account_id: @account_id})
FILTER src.account_id != dst.account_id
  AND e.amount_paid >= @min_amount
RETURN dst.account_id AS sink_account_id,
       COUNT(DISTINCT src.account_id) AS in_degree,
       ARRAY_AGG(SAFE.TO_JSON(e) ORDER BY e.event_timestamp) AS in_edges
GROUP BY sink_account_id
NEXT
FILTER in_degree >= @min_degree
RETURN sink_account_id, in_degree, in_edges
""".strip()

GQL_GATHER_SCATTER = """
GRAPH AmlGraph
MATCH (src:Account)-[e_in:TRANSFERRED_TO]->(hub:Account {account_id: @account_id})-[e_out:TRANSFERRED_TO]->(dst:Account)
FILTER src.account_id != hub.account_id
  AND hub.account_id != dst.account_id
  AND e_in.event_timestamp <= e_out.event_timestamp
  AND e_in.amount_paid >= @min_amount
RETURN hub.account_id AS hub_account_id,
       COUNT(DISTINCT src.account_id) AS fan_in_degree,
       COUNT(DISTINCT dst.account_id) AS fan_out_degree,
       ARRAY_AGG(SAFE.TO_JSON(e_in) ORDER BY e_in.event_timestamp) AS in_edges,
       ARRAY_AGG(SAFE.TO_JSON(e_out) ORDER BY e_out.event_timestamp) AS out_edges
GROUP BY hub_account_id
NEXT
FILTER fan_in_degree >= 1 AND fan_out_degree >= 1
RETURN hub_account_id, fan_in_degree, fan_out_degree, in_edges, out_edges
""".strip()

GQL_SCATTER_GATHER = """
GRAPH AmlGraph
MATCH (origin:Account {account_id: @account_id})-[e1:TRANSFERRED_TO]->(mule:Account)-[e2:TRANSFERRED_TO]->(sink:Account)
FILTER origin.account_id != mule.account_id
  AND mule.account_id != sink.account_id
  AND origin.account_id != sink.account_id
  AND e1.event_timestamp <= e2.event_timestamp
  AND e1.amount_paid >= @min_amount
RETURN origin.account_id AS origin_account_id,
       sink.account_id AS sink_account_id,
       COUNT(DISTINCT mule.account_id) AS mule_count,
       ARRAY_AGG(SAFE.TO_JSON(e1) ORDER BY e1.event_timestamp) AS scatter_edges,
       ARRAY_AGG(SAFE.TO_JSON(e2) ORDER BY e2.event_timestamp) AS gather_edges
GROUP BY origin_account_id, sink_account_id
NEXT
FILTER mule_count >= @min_degree
RETURN origin_account_id, sink_account_id, mule_count, scatter_edges, gather_edges
""".strip()

GQL_BIPARTITE = """
GRAPH AmlGraph
MATCH (peer:Account)-[e_in:TRANSFERRED_TO]->(s1:Account {account_id: @account_id})-[e_bip:TRANSFERRED_TO]->(d1:Account)
FILTER peer.account_id != s1.account_id
  AND s1.account_id != d1.account_id
  AND e_bip.amount_paid >= @min_amount
RETURN s1.account_id AS sender_account_id,
       d1.account_id AS receiver_account_id,
       COUNT(DISTINCT peer.account_id) AS upstream_funder_count,
       ARRAY_AGG(SAFE.TO_JSON(e_in) ORDER BY e_in.event_timestamp) AS funding_edges,
       ARRAY_AGG(SAFE.TO_JSON(e_bip) ORDER BY e_bip.event_timestamp) AS bipartite_edges
GROUP BY sender_account_id, receiver_account_id
NEXT
FILTER upstream_funder_count >= 1
RETURN sender_account_id, receiver_account_id, upstream_funder_count, funding_edges, bipartite_edges
""".strip()

GQL_STACKED_BIPARTITE = """
GRAPH AmlGraph
MATCH p = ACYCLIC (l1:Account)-[chain:TRANSFERRED_TO]->{2, 4}(l_end:Account)
FILTER l1.account_id != l_end.account_id
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS relay_path,
       ARRAY_LENGTH(chain) AS hop_count
LIMIT 25
""".strip()

GQL_RANDOM_WALK_LAYERING = """
GRAPH AmlGraph
MATCH p = ACYCLIC (src:Account {account_id: @account_id})-[chain:TRANSFERRED_TO]->{2, 11}(dst:Account)
FILTER src.account_id != dst.account_id
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS walk_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
LIMIT 25
""".strip()

GQL_ACCOUNT_KYC_CONTEXT = """
GRAPH AmlGraph
MATCH (b:Bank)<-[:HELD_AT]-(a:Account)<-[:OWNS]-(e:Entity)
WHERE a.account_id IN UNNEST(@account_ids)
RETURN a.account_id AS account_id,
       a.iban AS iban,
       a.currency AS currency,
       a.account_status AS account_status,
       a.is_flagged AS is_flagged,
       b.bank_id AS bank_id,
       b.bank_name AS bank_name,
       b.bic_swift AS bic_swift,
       b.jurisdiction AS bank_jurisdiction,
       e.entity_id AS entity_id,
       e.entity_name AS entity_name,
       e.entity_type AS entity_type,
       e.kyc_risk_tier AS kyc_risk_tier,
       e.is_pep_or_sanctioned AS is_pep_or_sanctioned,
       e.jurisdiction AS entity_jurisdiction,
       e.ubo_entity_id AS ubo_entity_id
""".strip()

SQL_UBO_ENTITIES_LOOKUP = """
SELECT entity_id, entity_name
FROM Entities
WHERE entity_id IN UNNEST(@ubo_ids)
""".strip()


GQL_PRE_SETTLEMENT_TRAIL_CHECK = """
GRAPH AmlGraph
MATCH p = (sender:Account {account_id: @from_account_id})-[e:TRANSFERRED_TO WHERE e.is_laundering = true]->(receiver:Account {account_id: @to_account_id})
RETURN SAFE.TO_JSON(p) AS laundering_path,
       1 AS total_hops
LIMIT 1
""".strip()

