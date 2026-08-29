
DROP POLICY IF EXISTS "Anyone delete items in open session" ON public.table_session_items;
DROP POLICY IF EXISTS "Anyone update items in open session" ON public.table_session_items;

CREATE POLICY "Anyone delete items in active session"
ON public.table_session_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.id = table_session_items.session_id
      AND s.status IN ('open','sent')
  )
);

CREATE POLICY "Anyone update items in active session"
ON public.table_session_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.table_sessions s
    WHERE s.id = table_session_items.session_id
      AND s.status IN ('open','sent')
  )
)
WITH CHECK (true);
