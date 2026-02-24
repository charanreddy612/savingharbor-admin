import { supabase } from "../dbhelper/dbclient.js";

const BATCH_SIZE = 1000;

function parseDiscount(title) {
  if (!title) return { type: "none", value: null, currency: null };

  const percentMatches = [...title.matchAll(/(\d{1,3})\s?%/gi)];
  if (percentMatches.length) {
    const values = percentMatches.map(m => Number(m[1])).filter(v => v > 0 && v <= 100);
    if (values.length) return { type: "percent", value: Math.max(...values), currency: null };
  }

  const flatMatch = title.match(/\$\s?(\d+(\.\d+)?)/i);
  if (flatMatch) {
    const value = Number(flatMatch[1]);
    if (value > 0 && value < 100000) return { type: "flat", value, currency: "USD" };
  }

  return { type: "none", value: null, currency: null };
}

async function run() {
  let lastId = 405500;
  let totalProcessed = 0;

  while (true) {
    const { data, error } = await supabase
      .from("coupons")
      .select("id, title, discount_type")
      .gt("id", lastId)
      .eq("is_publish", true)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!data.length) break;

    const unprocessed = data.filter(row => !row.discount_type);

    if (unprocessed.length) {
      const updates = unprocessed.map(row => {
        const parsed = parseDiscount(row.title);
        return {
          id: row.id,
          discount_type: parsed.type,
          discount_value: parsed.value,
          currency: parsed.currency
        };
      });

      const { error: rpcError } = await supabase.rpc("bulk_update_discounts", {
        updates
      });

      if (rpcError) throw rpcError;
      totalProcessed += updates.length;
    }

    lastId = data[data.length - 1].id;
    console.log(`Cursor at ID ${lastId} | Total updated: ${totalProcessed}`);
  }

  console.log("Done. Total records updated:", totalProcessed);
}

run().catch(console.error);