-- CAR-08: use the existing append-only evidence as the order's history.
CREATE INDEX audit_events_order_cut_map_history_idx
  ON crm.audit_events (target_id, occurred_at DESC, id DESC)
  WHERE target_type = 'order' AND action = 'order.cut_map.download';
