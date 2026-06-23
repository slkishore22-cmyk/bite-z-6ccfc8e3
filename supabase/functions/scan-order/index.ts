/* eslint-disable */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    // 1. Get and validate the API key
    const apiKey = req.headers.get("x-api-key") || req.headers.get("x-api-key".toLowerCase());
    if (!apiKey) {
      return json({ error: "Missing x-api-key header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceRole);

    let scannerDeviceName = "Simulated Flutter Scanner";
    let authorizedSellerId: string | null = null;

    // Verify key in canteen_scanners table or use simulated fallback key
    if (apiKey === "bitez_flutter_scanner_secret_2026") {
      scannerDeviceName = "Simulated Mock Scanner (Default)";
    } else {
      const { data: scanner, error: scannerErr } = await adminClient
        .from("canteen_scanners")
        .select("device_name, seller_id")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (scannerErr) {
        return json({ error: "Database authentication error: " + scannerErr.message }, 500);
      }
      if (!scanner) {
        return json({ error: "Invalid API key" }, 401);
      }
      scannerDeviceName = scanner.device_name;
      authorizedSellerId = scanner.seller_id;
    }

    // 2. Parse the body containing the qr_code (which is the order ID/UUID or number)
    const { qr_code } = await req.json().catch(() => ({ qr_code: null }));
    if (!qr_code || typeof qr_code !== "string") {
      return json({ error: "Missing or invalid qr_code in request body" }, 400);
    }

    // 3. Find the order in public.orders using existing columns (id, order_number, or qr_code)
    let orderSearch = adminClient.from("orders").select("*");
    if (qr_code.includes("-") && qr_code.length >= 32) {
      orderSearch = orderSearch.or(`id.eq.${qr_code},qr_code.eq.${qr_code}`);
    } else {
      orderSearch = orderSearch.or(`id.eq.${qr_code},order_number.eq.${qr_code},qr_code.eq.${qr_code}`);
    }
    
    const { data: order, error: orderErr } = await orderSearch.maybeSingle();

    if (orderErr) {
      return json({ error: "Failed to query order: " + orderErr.message }, 500);
    }
    if (!order) {
      return json({ error: "Order not found for the scanned QR code", qr_code }, 404);
    }

    // Verify order seller matches scanner seller (if scanner is bound to a specific canteen)
    if (authorizedSellerId && order.seller_id !== authorizedSellerId) {
      return json({ error: "Access denied. Order belongs to a different canteen." }, 403);
    }

    // Block if already scanned or paid or cancelled
    if (["scanned", "paid", "cancelled"].includes(order.status)) {
      return json({ 
        error: `Order already ${order.status}`,
        order: {
          id: order.id,
          amount: order.amount || order.total || order.subtotal || 0,
          status: order.status,
          qr_code: order.qr_code,
        }
      }, 409);
    }

    // Parse custom metadata from notes column
    let notesMeta: any = {};
    try {
      notesMeta = JSON.parse(order.notes || "{}");
    } catch {
      // ignore
    }

    // Update status to 'scanned' or 'confirmed'
    const targetStatus = (order.status === "qr_generated" || order.status === "pending") ? "scanned" : "confirmed";
    notesMeta.qr_scanned_at = new Date().toISOString();
    notesMeta.qr_scanned_by = scannerDeviceName;

    const { data: updatedOrder, error: updateErr } = await adminClient
      .from("orders")
      .update({
        status: targetStatus,
        qr_scanned_at: notesMeta.qr_scanned_at,
        qr_scanned_by: notesMeta.qr_scanned_by,
        notes: JSON.stringify(notesMeta),
      })
      .eq("id", order.id)
      .select()
      .single();

    if (updateErr) {
      return json({ error: "Failed to update order status: " + updateErr.message }, 500);
    }

    // 5. Fetch seller profile details for the receipt
    let canteenName = "Bitez Canteen";
    let upiId = "";
    if (order.seller_id) {
      const { data: seller } = await adminClient
        .from("sellers")
        .select("canteen_name, upi_id")
        .eq("id", order.seller_id)
        .maybeSingle();
      if (seller) {
        canteenName = seller.canteen_name || canteenName;
        upiId = seller.upi_id || upiId;
      }
    }

    interface OrderItem {
      itemId?: string;
      name?: string;
      icon?: string;
      price?: number;
      qty?: number;
    }

    // 6. Generate the plain text receipt payload formatted for 58mm/80mm thermal printers
    const orderNum = order.order_number || order.id.slice(0, 8).toUpperCase();
    const placedDate = new Date(order.created_at || order.placed_at || Date.now()).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });
    const customer = notesMeta.user_name || "Customer";
    const totalAmount = (order.total || order.subtotal || 0).toFixed(2);
    const orderItems: OrderItem[] = Array.isArray(notesMeta.items) ? notesMeta.items : [];

    const receiptLines: string[] = [];
    receiptLines.push("================================");
    receiptLines.push(canteenName.toUpperCase().padStart(Math.floor((32 + canteenName.length) / 2)));
    receiptLines.push("================================");
    receiptLines.push(`Order: #${orderNum}`);
    receiptLines.push(`Date: ${placedDate}`);
    receiptLines.push(`Cust: ${customer}`);
    receiptLines.push("--------------------------------");
    receiptLines.push("Items: ");

    orderItems.forEach((item: OrderItem) => {
      const itemPriceTotal = ((item.price || 0) * (item.qty || 1)).toFixed(2);
      const nameLine = `${item.icon || ""} ${item.name || "Item"}`;
      const qtyLine = `  ${item.qty || 1} x Rs.${(item.price || 0).toFixed(2)}`;
      
      receiptLines.push(nameLine);
      receiptLines.push(`${qtyLine.padEnd(20)}Rs.${itemPriceTotal.padStart(8)}`);
    });

    receiptLines.push("--------------------------------");
    receiptLines.push(`TOTAL AMOUNT:      Rs.${totalAmount.padStart(8)}`);
    receiptLines.push("Payment: UPI Pending Scan");
    receiptLines.push("Status: SCANNED - CONFIRMED");
    receiptLines.push("================================");
    receiptLines.push("  Thank you for your order!     ");
    receiptLines.push("================================");
    const receiptText = receiptLines.join("\n");

    // 7. Return success and the printer metadata
    return json({
      success: true,
      status: "success",
      message: "Order marked as scanned successfully",
      scanner_device: scannerDeviceName,
      order: {
        id: updatedOrder.id,
        order_number: orderNum,
        amount: updatedOrder.amount || updatedOrder.total || updatedOrder.subtotal || 0,
        status: updatedOrder.status,
        items: orderItems,
        canteen_name: canteenName,
        upi_id: upiId,
        qr_code: updatedOrder.qr_code,
        created_at: updatedOrder.created_at
      },
      thermal_receipt_payload: receiptText,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
