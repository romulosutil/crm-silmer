-- ADR 032 / CP-07: a human can close a channel cycle without declaring
-- that the client had no lead. Historical sem_lead rows remain untouched.
ALTER TABLE crm.conversations
  ADD COLUMN closure_outcome text,
  ADD COLUMN closed_by text REFERENCES crm.users(id);

ALTER TABLE crm.conversations DROP CONSTRAINT conversations_state_check;
ALTER TABLE crm.conversations ADD CONSTRAINT conversations_state_check CHECK (
  state IN ('nova', 'em_analise', 'em_atendimento', 'requer_atencao',
            'convertida_em_lead', 'sem_lead', 'encerrada')
);

ALTER TABLE crm.conversations DROP CONSTRAINT conversations_terminal_state_check;
ALTER TABLE crm.conversations ADD CONSTRAINT conversations_terminal_state_check CHECK (
  (state IN ('sem_lead', 'encerrada') AND terminal_at IS NOT NULL)
  OR state = 'convertida_em_lead'
  OR (state NOT IN ('convertida_em_lead', 'sem_lead', 'encerrada')
      AND terminal_at IS NULL)
);

ALTER TABLE crm.conversations ADD CONSTRAINT conversations_closure_metadata CHECK (
  (state = 'encerrada' AND closure_outcome IN ('concluido', 'sem_pedido')
    AND closed_by IS NOT NULL)
  OR (state <> 'encerrada' AND closure_outcome IS NULL AND closed_by IS NULL)
);
