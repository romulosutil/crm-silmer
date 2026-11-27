-- CAR-09: a single immutable assignment per order, with a shared PDF number.
CREATE SEQUENCE crm.order_cut_map_number_seq AS bigint START 1;

CREATE TABLE crm.order_cut_maps (
  number bigint PRIMARY KEY DEFAULT nextval('crm.order_cut_map_number_seq') CHECK (number > 0),
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE crm.order_cut_map_number_seq OWNED BY crm.order_cut_maps.number;

CREATE TABLE crm.order_cut_map_orders (
  order_id text PRIMARY KEY REFERENCES crm.orders(id),
  map_number bigint NOT NULL REFERENCES crm.order_cut_maps(number),
  order_version integer NOT NULL CHECK (order_version > 0)
);

-- Preserve the first issued map for orders from an earlier preview deployment.
-- Those audits shared their actor and request correlation across the selection.
WITH first_membership AS MATERIALIZED (
  SELECT DISTINCT ON (event.target_id)
    event.target_id, event.actor_id, event.correlation_id, event.version, event.occurred_at
  FROM crm.audit_events event
  JOIN crm.orders orders ON orders.id = event.target_id
  WHERE event.target_type = 'order' AND event.action = 'order.cut_map.download'
  ORDER BY event.target_id, event.occurred_at, event.id
), numbered AS MATERIALIZED (
  SELECT actor_id, correlation_id, min(occurred_at) AS generated_at,
    row_number() OVER (ORDER BY min(occurred_at), actor_id, correlation_id) AS number
  FROM first_membership GROUP BY actor_id, correlation_id
), created AS (
  INSERT INTO crm.order_cut_maps (number, generated_at)
  SELECT number, generated_at FROM numbered RETURNING number
)
INSERT INTO crm.order_cut_map_orders (order_id, map_number, order_version)
SELECT first_membership.target_id, created.number, first_membership.version::integer
FROM first_membership
JOIN numbered USING (actor_id, correlation_id)
JOIN created USING (number);

SELECT setval('crm.order_cut_map_number_seq', COALESCE(max(number), 1), count(*) > 0)
FROM crm.order_cut_maps;
