import React, { useEffect, useState } from "react";
import { getCoupon } from "../../services/couponsService";
import useEscClose from "../hooks/useEscClose";

export default function ViewCouponModal({ id, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lock body scroll while open (same as other modals)
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const result = await getCoupon(id);
        console.log("API result:", result);
        setData(result || null);   // 👈 use result directly
      } catch (err) {
        console.error(err);
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // close on ESC
  useEscClose(onClose);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded shadow">
          <p>No data found</p>
          <button className="border px-3 py-1 rounded mt-2" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-4xl rounded shadow-lg p-6 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">View coupon or deal</h2>
          <button className="border px-3 py-1 rounded" onClick={onClose}>
            Back
          </button>
        </div>

        <div className="space-y-3">
          <KV k="Store ID" v={data?.merchant_id} />
          <KV k="Type" v={data?.coupon_type} />
          <KV k="Title" v={data?.title} />
          {data?.coupon_type === "coupon" && (
            <KV k="Coupon Code" v={data?.coupon_code || "-"} />
          )}
          <KV k="Website/Affiliate URL" v={data?.aff_url?.trim() || "-"} />
          <KV k="H2/H3" v={data?.h_block || "-"} />

          {/* present & nullable in your response */}
          <KV k="Show proof?" v={data?.show_proof ? "Yes" : "No"} />
          <KV k="Editor Pick" v={data?.is_editor ? "Yes" : "No"} />
          <KV k="Editor order" v={data?.editor_order ?? 0} />
          <KV k="Coupon Style" v={data?.coupon_style || "-"} />
          <KV k="Special Message Type" v={data?.special_msg_type || "-"} />
          <KV k="Special Message" v={data?.special_msg || "-"} />
          <KV k="Push to" v={data?.push_to || "-"} />
          <KV k="Level" v={data?.level || "-"} />
          <KV k="Display in home?" v={data?.home ? "Yes" : "No"} />
          <KV k="Is Brand Coupon?" v={data?.is_brand_coupon ? "Yes" : "No"} />
          <KV k="Published" v={data?.is_publish ? "Yes" : "No"} />
          <KV
            k="Created"
            v={data?.created_at?.slice(0, 19)?.replace("T", " ") || "-"}
          />
          <KV
            k="Updated"
            v={data?.updated_at?.slice(0, 19)?.replace("T", " ") || "-"}
          />

          {/* Description */}
          <div>
            <div className="text-sm text-gray-600 mb-1">Description</div>
            <div className="whitespace-pre-wrap border rounded p-3 text-sm">
              {data?.description || "-"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex gap-2 text-sm">
      <div className="w-48 text-gray-600">{k}</div>
      <div className="flex-1 text-gray-900 break-words">{String(v ?? "-")}</div>
    </div>
  );
}
