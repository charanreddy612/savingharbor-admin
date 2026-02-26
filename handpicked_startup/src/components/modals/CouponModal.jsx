import React, { useEffect, useState, useRef } from "react";
import {
  addCoupon,
  getCoupon,
  updateCoupon,
} from "../../services/couponsService";
import { listMerchants } from "../../services/merchantService";
import useEscClose from "../hooks/useEscClose";

export default function CouponModal({ id, onClose }) {
  const isEdit = !!id;

  const [form, setForm] = useState({
    store_id: "",
    coupon_type: "coupon",
    title: "",
    h_block: "",
    coupon_code: "",
    aff_url: "",
    description: "",
    show_proof: false,
    editor_pick: false,
    editor_order: 0,
    coupon_style: "custom",
    special_msg_type: "",
    special_msg: "",
    push_to: "",
    level: "",
    home: false,
    is_brand_coupon: false,
    is_publish: true,
  });

  const [availableCategories, setAvailableCategories] = useState([]);

  // Store search
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef(null);

  const [logoFile, setLogoFile] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  // Load coupon (EDIT)
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const result = await getCoupon(id);
      if (!result) return;

      setForm({
        store_id: String(result.merchant_id ?? ""),
        coupon_type: result.coupon_type || "coupon",
        title: result.title || "",
        h_block: result.h_block || "",
        coupon_code: result.coupon_code || "",
        aff_url: result.aff_url || result.url || "",
        description: result.description || "",
        show_proof: Boolean(result.show_proof),
        editor_pick: Boolean(result.is_editor),
        editor_order: Number(result.editor_order ?? 0),
        coupon_style: result.coupon_style || "custom",
        special_msg_type: result.special_msg_type || "",
        special_msg: result.special_msg || "",
        push_to: result.push_to || "",
        level: result.level || "",
        home: Boolean(result.home),
        is_brand_coupon: !!result.is_brand_coupon,
        is_publish:
          result.is_publish !== undefined ? !!result.is_publish : true,
      });

      // Prefill store name
      setSearch(result.merchant_name || "");
      setAvailableCategories(result.category_names || []);
    })();
  }, [id, isEdit]);

  // Async store search (CREATE + EDIT)
  useEffect(() => {
    if (search.length < 3) {
      setSearchResults([]);
      return;
    }

    (async () => {
      setSearchLoading(true);
      const res = await listMerchants({ name: search, limit: 10 });
      setSearchResults(
        (res?.data || []).map((m) => ({
          id: String(m.id),
          name: m.name,
          aff_url: m.aff_url || "",
          website: m.web_url || "",
          categories: m.category_names || [],
        }))
      );
      setHighlightIndex(-1);
      setSearchLoading(false);
    })();
  }, [search]);

  const selectStore = (store) => {
    setForm((prev) => ({
      ...prev,
      store_id: store.id,
      aff_url: store.aff_url || store.website || "",
    }));
    setAvailableCategories(store.categories || []);
    setSearch(store.name);
    setSearchResults([]);
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, searchResults.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      selectStore(searchResults[highlightIndex]);
    }
    if (e.key === "Escape") {
      setSearch("");
      setSearchResults([]);
      setHighlightIndex(-1);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v === null || v === undefined) return;
        fd.append(k, typeof v === "boolean" ? String(v) : String(v));
      });

      if (!isEdit) {
        fd.append("click_count", String(Math.floor(Math.random() * 201) + 400));
      }

      const res = isEdit ? await updateCoupon(id, fd) : await addCoupon(fd);
      if (!res?.error) onClose?.();
    } finally {
      setBusy(false);
    }
  };

  useEscClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-6xl rounded shadow-lg p-6 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {isEdit ? "Update coupon or deal" : "Add coupon or deal"}
          </h2>
          <button className="border px-3 py-1 rounded" onClick={onClose}>
            Back
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Store */}
          <div>
            <label className="block mb-1">Store</label>
            <div className="relative">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Type at least 3 characters…"
                className="w-full border px-3 py-2 rounded"
              />
              {searchLoading && (
                <div className="text-xs text-gray-500 mt-1">Searching…</div>
              )}
              {searchResults.length > 0 && (
                <div className="absolute z-10 bg-white border w-full max-h-60 overflow-y-auto">
                  {searchResults.map((s, i) => (
                    <div
                      key={s.id}
                      className={`px-3 py-2 cursor-pointer ${
                        i === highlightIndex ? "bg-blue-100" : ""
                      }`}
                      onMouseDown={() => selectStore(s)}
                    >
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Coupon or Deal */}
          <div>
            <label className="block mb-1">Coupon or Deal</label>
            <select
              value={form.coupon_type}
              onChange={(e) =>
                setForm({ ...form, coupon_type: e.target.value })
              }
              className="w-full border px-3 py-2 rounded"
            >
              <option value="coupon">Coupon</option>
              <option value="deal">Deal</option>
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          {/* Select H2 or H3 */}
          <div>
            <label className="block mb-1">Select H2 or H3</label>
            <select
              value={form.h_block}
              onChange={(e) => setForm({ ...form, h_block: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            >
              <option value="">--Select--</option>
              {/* TODO: populate H2/H3 options */}
            </select>
          </div>

          {/* Coupon Code (only when type = coupon) */}
          {form.coupon_type === "coupon" && (
            <div>
              <label className="block mb-1">Coupon Code</label>
              <input
                value={form.coupon_code}
                onChange={(e) =>
                  setForm({ ...form, coupon_code: e.target.value })
                }
                className="w-full border px-3 py-2 rounded"
              />
            </div>
          )}

          {/* Website or Affiliate URL */}
          <div>
            <label className="block mb-1">Website or Affiliate URL</label>
            <input
              value={form.aff_url}
              onChange={(e) => setForm({ ...form, aff_url: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block mb-1">Description</label>
            <textarea
              rows={6}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          {/* Editor pick + order */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-1">Editor Pick?</label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.editor_pick}
                  onChange={(e) =>
                    setForm({ ...form, editor_pick: e.target.checked })
                  }
                />
                <span>Yes</span>
              </label>
            </div>
            <div>
              <label className="block mb-1">Editor order</label>
              <input
                type="number"
                value={form.editor_order}
                onChange={(e) =>
                  setForm({
                    ...form,
                    editor_order: Number(e.target.value || 0),
                  })
                }
                className="w-full border px-3 py-2 rounded"
              />
            </div>
          </div>

          {/* Coupon Type + Special Message Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-1">Coupon Type</label>
              <select
                value={form.coupon_style}
                onChange={(e) =>
                  setForm({ ...form, coupon_style: e.target.value })
                }
                className="w-full border px-3 py-2 rounded"
              >
                <option value="custom">Custom</option>
                {/* Add more styles if needed */}
              </select>
            </div>
            <div>
              <label className="block mb-1">Special Message Type</label>
              <select
                value={form.special_msg_type}
                onChange={(e) =>
                  setForm({ ...form, special_msg_type: e.target.value })
                }
                className="w-full border px-3 py-2 rounded"
              >
                <option value="">None</option>
                {/* Add options */}
              </select>
            </div>
          </div>

          {/* Special Message + Push to */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-1">Special Message</label>
              <input
                value={form.special_msg}
                onChange={(e) =>
                  setForm({ ...form, special_msg: e.target.value })
                }
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            <div>
              <label className="block mb-1">Push to</label>
              <select
                value={form.push_to}
                onChange={(e) => setForm({ ...form, push_to: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="">None</option>
                {/* Add options */}
              </select>
            </div>
          </div>

          {/* Level + Display in home */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-1">Level</label>
              <select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="">None</option>
                {/* Add options */}
              </select>
            </div>
            <div>
              <label className="block mb-1">Display in home?</label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.home}
                  onChange={(e) => setForm({ ...form, home: e.target.checked })}
                />
                <span>Yes</span>
              </label>
            </div>
          </div>

          {/* Is Brand Coupon? */}
          <div>
            <label className="block mb-1">Is Brand Coupon?</label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_brand_coupon}
                onChange={(e) =>
                  setForm({ ...form, is_brand_coupon: e.target.checked })
                }
              />
              <span>Yes</span>
            </label>
          </div>

          {/* Publish toggle (default true) */}
          <div>
            <label className="block mb-1">Publish?</label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_publish}
                onChange={(e) =>
                  setForm({ ...form, is_publish: e.target.checked })
                }
              />
              <span>Yes</span>
            </label>
          </div>

          {/* Footer actions */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
            >
              {busy ? "Saving..." : isEdit ? "Update Coupon" : "Create Coupon"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
