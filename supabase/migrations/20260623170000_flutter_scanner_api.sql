-- Create canteen scanners table for Flutter app authentication
CREATE TABLE IF NOT EXISTS public.canteen_scanners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Grant select permission
GRANT SELECT ON public.canteen_scanners TO anon, authenticated;

-- Enable RLS
ALTER TABLE public.canteen_scanners ENABLE ROW LEVEL SECURITY;

-- Add select policy
DROP POLICY IF EXISTS "Public read canteen scanners" ON public.canteen_scanners;
CREATE POLICY "Public read canteen scanners" ON public.canteen_scanners
  FOR SELECT TO anon, authenticated
  USING (true);

-- Insert simulated/default scanner record for testing
INSERT INTO public.canteen_scanners (device_name, api_key)
VALUES ('Thermal Printer Scanner 1', 'bitez_flutter_scanner_secret_2026')
ON CONFLICT (api_key) DO NOTHING;
