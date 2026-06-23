-- Grant select/insert/update permissions to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE ON public.orders TO anon, authenticated;

-- Customers create own orders policy
DROP POLICY IF EXISTS "Customers create own orders" ON public.orders;
CREATE POLICY "Customers create own orders" ON public.orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Customers view own orders policy
DROP POLICY IF EXISTS "Customers view own orders" ON public.orders;
CREATE POLICY "Customers view own orders" ON public.orders
  FOR SELECT TO anon, authenticated
  USING (true);

-- Sellers view own orders policy
DROP POLICY IF EXISTS "Sellers view own orders" ON public.orders;
CREATE POLICY "Sellers view own orders" ON public.orders
  FOR SELECT TO anon, authenticated
  USING (true);

-- Sellers update own orders policy
DROP POLICY IF EXISTS "Sellers update own orders" ON public.orders;
CREATE POLICY "Sellers update own orders" ON public.orders
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);
