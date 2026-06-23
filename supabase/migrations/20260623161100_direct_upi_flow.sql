-- Add new values to order_status enum if they don't exist
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'qr_generated';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'scanned';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cod_pending';

-- Drop NOT NULL constraints to allow simplified UPI order inserts
ALTER TABLE public.orders 
ALTER COLUMN customer_id DROP NOT NULL,
ALTER COLUMN seller_id DROP NOT NULL,
ALTER COLUMN delivery_address DROP NOT NULL,
ALTER COLUMN subtotal DROP NOT NULL,
ALTER COLUMN total DROP NOT NULL;

-- Add QR and payment tracking columns
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS qr_code TEXT,
ADD COLUMN IF NOT EXISTS qr_scanned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS qr_scanned_by TEXT,
ADD COLUMN IF NOT EXISTS upi_txn_ref TEXT,
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'upi',
ADD COLUMN IF NOT EXISTS items JSONB,
ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Drop check constraint if it exists
ALTER TABLE public.orders 
DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add constraint to limit status fields to allowed set
ALTER TABLE public.orders 
ADD CONSTRAINT orders_status_check 
CHECK (status::text IN (
  'pending',
  'qr_generated',
  'scanned',
  'paid',
  'confirmed',
  'cancelled',
  'cod_pending'
));

-- Index for fast QR lookup by staff
CREATE INDEX IF NOT EXISTS idx_orders_qr_code 
ON public.orders(qr_code);

-- Enable Realtime on orders
ALTER TABLE public.orders REPLICA IDENTITY FULL;
