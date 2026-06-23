/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { clearCart, getCart, removeCartItem } from "@/lib/userCart";
import { createOrderOptimistic, saveOrderLocally } from "@/lib/sellerOrders";
import { pinItem } from "@/lib/userPins";
import { supabase } from "@/integrations/supabase/client";
import { getUserSession } from "@/utils/sessionManager";
import { beginOrder, endOrder } from "@/utils/orderGuard";

const liquidGlass: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  borderRadius: 26,
  boxShadow:
    "inset 0 1.5px 0 0 rgba(255,255,255,0.55), 0 8px 32px rgba(0,0,0,0.06)",
  position: "relative",
  overflow: "hidden",
  border: "1px solid rgba(0,0,0,0.03)",
};

const glassHighlight: React.CSSProperties = {
  content: '""',
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: "45%",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%)",
  pointerEvents: "none",
  zIndex: 1,
};

const Payment = () => {
  const HERO_IMG =
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCiwJoiptyTfJjocBll2nIls6RlxY48tdulifddR5Ese8rvs5cmf6-rAcmLqNJxycS-Dr7ud8C7bRLZRUD8N8A5ClckwSyiZ_53kZFF9u5ZDYD5J8K1_wyYKp6HVxKbxaknaAEVb8RLOCcRXNnp5rNMMv94vETDcFlU2eZrm_p6ruQmZFNwjJWcWWFNNfZGOR3CbPJ7D-ISlZkiKOjKJmaxhuWB07R05v80Qyr406FF2HO2IXveIpxwF4qF68gr1dwINcGXsEKikaWe";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [placing, setPlacing] = useState(false);
  const selectedCanteenId = params.get("canteenId");
  useEffect(() => {
    void import("@/pages/user/OrderStatus");
  }, []);

  const placeOrder = async (method: "cod" | "upi") => {
    try {
      beginOrder();
    } catch {
      return;
    }
    if (placing) {
      endOrder();
      return;
    }
    const cart = getCart();
    const canteenKeys = new Set(cart.map((c) => c.canteenId ?? "__unknown__"));
    const activeCart = selectedCanteenId
      ? cart.filter((c) => (c.canteenId ?? "__unknown__") === selectedCanteenId)
      : canteenKeys.size <= 1
      ? cart
      : [];
    if (activeCart.length === 0) {
      endOrder();
      navigate("/app/cart");
      return;
    }
    const sessionForCheck = getUserSession();
    if (!sessionForCheck?.id) {
      endOrder();
      alert("Please sign in again to place this order.");
      navigate("/app/login");
      return;
    }
    setPlacing(true);

    const firstCartItem = activeCart[0];

    if (method === "upi") {
      try {
        const total = activeCart.reduce((sum, item) => sum + item.price * item.qty, 0);
        const qrValue = `BITEZ-${sessionForCheck.id.slice(0, 8).toUpperCase()}-${Date.now()}`;

        // Create order via Edge Function (using service_role on server to bypass client RLS)
        const orderUuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}00000000-0000-4000-8000-000000000000`.slice(0, 36);

        let order;
        try {
          const { data: edgeResult, error: edgeErr } = await supabase.functions.invoke("analytics-orders", {
            body: {
              op: "create_upi",
              user_id: sessionForCheck.id,
              session_id: orderUuid,
              metadata: {
                items: activeCart.map((c) => ({
                  itemId: c.itemId,
                  name: c.name,
                  icon: c.icon,
                  category: c.category,
                  price: c.price,
                  qty: c.qty,
                  canteenId: c.canteenId,
                  canteenIcon: c.canteenIcon,
                })),
                total: total,
                sellerId: firstCartItem?.canteenId ?? null,
                sellerName: firstCartItem?.canteenName ?? null,
                qr_code: qrValue,
                user_name: sessionForCheck.email || "Customer",
              }
            }
          });

          if (edgeErr || !edgeResult || edgeResult.error) {
            throw new Error(edgeErr?.message || edgeResult?.error || "Edge Function returned error");
          }
          order = edgeResult.order;
        } catch (edgeCallErr) {
          console.warn("Edge function creation failed, trying direct database insert...", edgeCallErr);
          const { data: directResult, error: directErr } = await supabase
            .from("orders")
            .insert({
              id: orderUuid,
              customer_id: sessionForCheck.id,
              seller_id: firstCartItem?.canteenId ?? null,
              delivery_address: {},
              subtotal: total,
              total: total,
              status: "pending",
              notes: JSON.stringify({
                payment_method: "upi",
                qr_code: qrValue,
                items: activeCart.map((c) => ({
                  itemId: c.itemId,
                  name: c.name,
                  icon: c.icon,
                  category: c.category,
                  price: c.price,
                  qty: c.qty,
                  canteenId: c.canteenId,
                  canteenIcon: c.canteenIcon,
                })),
                user_name: sessionForCheck.email || "Customer",
              }),
            } as any)
            .select()
            .single();

          if (directErr) {
            throw new Error(directErr.message);
          }
          order = directResult;
        }

        // Save order locally to survive reloads and allow getOrderById to work
        saveOrderLocally({
          id: order.order_number || order.id.slice(0, 8),
          uid: order.id,
          createdAt: new Date(order.created_at).getTime(),
          payment: "Online",
          status: "Pending",
          items: activeCart.map((c) => ({
            itemId: c.itemId,
            name: c.name,
            icon: c.icon,
            category: c.category,
            price: c.price,
            qty: c.qty,
            canteenId: c.canteenId,
            canteenIcon: c.canteenIcon,
          })),
          subtotal: total,
          total: total,
          sellerId: firstCartItem?.canteenId ?? null,
          sellerName: firstCartItem?.canteenName ?? null,
          paymentStatus: "PENDING",
        });

        // Clear cart
        clearCart(firstCartItem?.canteenId ?? "__unknown__");
        activeCart.forEach((c) => pinItem(c.itemId));

        setPlacing(false);
        endOrder();

        // Navigate to QR screen immediately
        navigate(`/order-qr?id=${order.id}`, {
          state: {
            orderId: order.id,
            qrValue: order.qr_code,
            amount: total,
            items: activeCart.map((c) => ({
              itemId: c.itemId,
              name: c.name,
              icon: c.icon,
              category: c.category,
              price: c.price,
              qty: c.qty,
              canteenId: c.canteenId,
              canteenIcon: c.canteenIcon,
            })),
          },
          replace: true,
        });

      } catch (err) {
        setPlacing(false);
        endOrder();
        alert("Could not create order. Please try again: " + (err instanceof Error ? err.message : String(err)));
      }
      return;
    }

    try {
      const order = createOrderOptimistic({
        payment: "Cash",
        paymentStatus: "PENDING",
        isSoundPlayed: false,
        sellerId: firstCartItem?.canteenId ?? null,
        sellerName: firstCartItem?.canteenName ?? null,
        items: activeCart.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          icon: c.icon,
          category: c.category,
          price: c.price,
          qty: c.qty,
          canteenId: c.canteenId,
          canteenIcon: c.canteenIcon,
        })),
      });
      clearCart(firstCartItem?.canteenId ?? "__unknown__");
      activeCart.forEach((c) => pinItem(c.itemId));
      setPlacing(false);
      endOrder();
      navigate(`/app/order-status?method=${method}&id=${order.uid}`, { replace: true });
    } catch (e) {
      setPlacing(false);
      endOrder();
      alert("Unable to place order: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div
      className="user-page"
      style={{ color: "hsl(var(--user-text))", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="fixed z-50 flex items-center justify-center transition-all duration-[400ms] ease-in-out active:scale-95"
        style={{
          top: "calc(20px + var(--ios-pwa-safe-top))",
          left: 16,
          width: 40,
          height: 40,
          background: "transparent",
          border: "none",
          padding: 0,
        }}
      >
        <span className="material-symbols-outlined" style={{ color: "#1D1D1F", fontSize: 28 }}>
          arrow_back
        </span>
      </button>

      <main
        className="user-content flex flex-col w-full mx-auto px-4 sm:px-6"
        style={{
          paddingTop: "calc(84px + var(--ios-pwa-safe-top) + var(--ios-pwa-top-breathing))",
          maxWidth: "40rem",
          gap: 40,
        }}
      >
        <div
          className="relative overflow-hidden flex items-end w-full"
          style={{
            borderRadius: 26,
            height: 256,
            padding: 32,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <img
            alt="Premium Light Aesthetic"
            src={HERO_IMG}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(255,255,255,0.9), rgba(255,255,255,0.2), transparent)",
            }}
          />
          <div className="relative z-10">
            <span
              className="uppercase font-bold"
              style={{
                background: "#1D1D1F",
                color: "#FFFFFF",
                fontSize: 10,
                letterSpacing: "0.1em",
                padding: "4px 12px",
                borderRadius: 9999,
              }}
            >
              Secure Checkout
            </span>
            <h2
              className="font-extrabold tracking-tighter"
              style={{ fontSize: 30, marginTop: 8, color: "#1D1D1F" }}
            >
              Finalize Order
            </h2>
            <p
              className="font-medium"
              style={{ color: "#6E6E73", fontSize: 14, marginTop: 4 }}
            >
              Pay with Cash or UPI
            </p>
          </div>
        </div>

        <section className="flex flex-col w-full" style={{ gap: 20 }}>
          <button
            type="button"
            disabled={placing}
            onClick={() => placeOrder("cod")}
            className="w-full text-left group active:scale-[0.98] transition-all duration-[400ms] ease-out flex items-center justify-between"
            style={{ ...liquidGlass, padding: 20, borderRadius: 20, opacity: placing ? 0.5 : 1 }}
          >
            <span style={glassHighlight} aria-hidden />
            <div className="flex items-center relative z-10" style={{ gap: 14 }}>
              <div
                className="flex items-center justify-center group-hover:scale-105 transition-transform duration-[400ms]"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "rgba(52,199,89,0.10)",
                  color: "#34C759",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
                >
                  payments
                </span>
              </div>
              <div>
                <h3
                  className="font-bold tracking-tight"
                  style={{ color: "#1D1D1F", fontSize: 15 }}
                >
                  Cash on Delivery
                </h3>
                <p style={{ color: "#6E6E73", fontSize: 12, marginTop: 2 }}>
                  Pay with Cash
                </p>
              </div>
            </div>
            <span
              className="material-symbols-outlined relative z-10"
              style={{ color: "#1D1D1F", fontSize: 22 }}
            >
              chevron_right
            </span>
          </button>

          <button
            type="button"
            disabled={placing}
            onClick={() => placeOrder("upi")}
            className="w-full text-left group active:scale-[0.98] transition-all duration-[400ms] ease-out flex items-center justify-between"
            style={{ ...liquidGlass, padding: 20, borderRadius: 20, opacity: placing ? 0.5 : 1 }}
          >
            <span style={glassHighlight} aria-hidden />
            <div className="flex items-center relative z-10" style={{ gap: 14 }}>
              <div
                className="flex items-center justify-center group-hover:scale-105 transition-transform duration-[400ms]"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "rgba(0,122,255,0.10)",
                  color: "#007AFF",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
                >
                  qr_code
                </span>
              </div>
              <div>
                <h3
                  className="font-bold tracking-tight"
                  style={{ color: "#1D1D1F", fontSize: 15 }}
                >
                  UPI Payment
                </h3>
                <p style={{ color: "#6E6E73", fontSize: 12, marginTop: 2 }}>
                  Pay with any UPI App
                </p>
              </div>
            </div>
            <span
              className="material-symbols-outlined relative z-10"
              style={{ color: "#1D1D1F", fontSize: 22 }}
            >
              chevron_right
            </span>
          </button>
        </section>
      </main>
    </div>
  );
};

export default Payment;