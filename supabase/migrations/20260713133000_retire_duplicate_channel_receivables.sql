-- corte_receivables is the CxC lifecycle ledger, not a mirror of daily Corte
-- payment channels. Retire legacy rows created with evidence.kind=channel_sales
-- while preserving them for audit history.
update public.corte_receivables
set
  status = 'settled',
  settled_on = coalesce(settled_on, opened_on),
  settled_principal = principal
where status = 'open'
  and evidence ->> 'kind' = 'channel_sales';
