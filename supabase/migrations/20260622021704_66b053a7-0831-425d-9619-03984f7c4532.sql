ALTER TABLE public.users DROP COLUMN IF EXISTS razorpay_customer_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS razorpay_customer_id;
ALTER TABLE public.payments DROP COLUMN IF EXISTS razorpay_order_id;
ALTER TABLE public.payments DROP COLUMN IF EXISTS razorpay_payment_id;
ALTER TABLE public.payments DROP COLUMN IF EXISTS razorpay_signature;