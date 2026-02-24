// src/components/merchants/ViewMerchantModal.jsx
import React, { useEffect, useState } from "react";
import { getMerchant } from "../../services/merchantService";
import { getAllCategories } from "../../services/merchantCategoryService.js";
import useEscClose from "../hooks/useEscClose";
import DOMPurify from "dompurify";

export default function ViewMerchantModal({ merchantId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState(null);

  // all categories fetched from merchant_categories table
  const [allCategories, setAllCategories] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getMerchant(merchantId);
        if (!mounted) return;
        setM(data || {});
      } catch (e) {
        console.error("Failed to load merchant:", e?.message || e);
        if (mounted) setM({});
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [merchantId]);

  // fetch and normalize categories list
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingCats(true);
        const res = await getAllCategories();
        if (!mounted) return;
        if (!Array.isArray(res) || res.length === 0) {
          setAllCategories([]);
          return;
        }
        const normalized = res.map((c) =>
          typeof c === "string" ? c : c.name ?? c.category_name ?? String(c.id)
        );

        setAllCategories(normalized);
      } catch (err) {
        console.error("Could not fetch categories:", err);
        setAllCategories([]);
      } finally {
        if (mounted) setLoadingCats(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // helpers to resolve category item (id | name | object) -> display name
  const buildLookups = () => {
    const byId = new Map();
    const byName = new Map();
    for (const c of allCategories) {
      if (c.id !== undefined && c.id !== null) byId.set(String(c.id), c.name);
      if (c.name) byName.set(String(c.name).toLowerCase(), c.name);
    }
    return { byId, byName };
  };

  const resolveCategoryName = (item) => {
    if (item == null) return "—";
    const { byId, byName } = buildLookups();

    // plain number (id)
    if (typeof item === "number") {
      return byId.get(String(item)) ?? String(item);
    }

    // plain string: could be id string or name
    if (typeof item === "string") {
      if (byId.has(item)) return byId.get(item);
      const lower = item.toLowerCase();
      if (byName.has(lower)) return byName.get(lower);
      return item;
    }

    // object shape { id, name } or { name: ... }
    if (typeof item === "object") {
      if (item.name) return item.name;
      if (item.id && byId.has(String(item.id)))
        return byId.get(String(item.id));
      return String(item);
    }

    return String(item);
  };

  const Bool = ({ v }) => (
    <span className={v ? "text-green-600" : "text-gray-500"}>
      {v ? "Yes" : "No"}
    </span>
  );

  const Field = ({ label, children }) => (
    <div>
      <div className="text-gray-600 mb-1">{label}</div>
      <div className="border rounded px-3 py-2">{children ?? "—"}</div>
    </div>
  );

  // close on ESC
  useEscClose(onClose);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 text-white">
        Loading…
      </div>
    );
  }

  // compute display string for categories (robust to id/name/object)
  const renderedCategories = (() => {
    const list = Array.isArray(m?.category_names) ? m.category_names : [];
    if (!list.length) return "—";
    return list.map((it) => resolveCategoryName(it)).join(", ");
  })();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-6xl rounded shadow-lg p-6 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">View Store</h2>
          <button className="border px-3 py-1 rounded" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Top basics */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">{m?.name}</Field>
          <Field label="Slug">{m?.slug}</Field>
        </div>

        {/* Categories */}
        <Field label="Categories">{renderedCategories}</Field>

        {/* URLs and tracker */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Web URL">{m?.web_url || m?.website}</Field>
          <Field label="Affiliate URL">{m?.aff_url}</Field>
        </div>
        <Field label="Tracker Lock">
          <Bool v={!!m?.tracker_lock} />
        </Field>

        {/* H1 */}
        <Field label="H1 Keyword">{m?.h1keyword}</Field>

        {/* Logo */}
        <div>
          <div className="text-gray-600 mb-1">Store Logo</div>
          {m?.logo_url || m?.logo ? (
            <img
              src={m.logo_url || m.logo}
              alt="logo"
              className="w-32 h-32 object-cover border rounded"
            />
          ) : (
            <div className="w-32 h-32 border rounded flex items-center justify-center text-xs text-gray-500">
              —
            </div>
          )}
        </div>

        {/* SEO */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <Field label="SEO Title">{m?.meta_title}</Field>
          <Field label="SEO Keywords">{m?.meta_keywords}</Field>
          <Field label="SEO Description">{m?.meta_description}</Field>
        </div>

        {/* Content blocks */}
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Side Description">
            <div className="prose max-w-none whitespace-pre-wrap">
              {m?.side_description_html || "—"}
            </div>
          </Field>
          <Field label="Description">
            <div
              className="my-6 prose max-w-none prose-img:rounded prose-img:max-h-[400px] prose-img:object-contain"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                  m?.description_html || m?.description || "—"
                ),
              }}
            />
          </Field>
          <Field label="Table Content">
            <div className="prose max-w-none whitespace-pre-wrap">
              {m?.table_content_html || "—"}
            </div>
          </Field>
        </div>

        {/* Ads and brand categories */}
        <div className="mt-4">
          <Field label="Ads Description">
            <div className="prose max-w-none whitespace-pre-wrap">
              {m?.ads_description_html || "—"}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <Field label="Brand Categories">
              {Array.isArray(m?.subcategories) && m.subcategories.length
                ? m.subcategories.join(", ")
                : "—"}
            </Field>
            <Field label="Ads Description (Label)">
              {m?.ads_description_label}
            </Field>
          </div>
        </div>

        {/* Toggles */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="Sidebar">
            <Bool v={!!m?.sidebar} />
          </Field>
          <Field label="Home">
            <Bool v={!!m?.home} />
          </Field>
          <Field label="Ads Block All">
            <Bool v={!!m?.ads_block_all} />
          </Field>
          <Field label="Ads Block Banners">
            <Bool v={!!m?.ads_block_banners} />
          </Field>
          <Field label="Is Header">
            <Bool v={!!m?.is_header} />
          </Field>
          <Field label="Deals Home">
            <Bool v={!!m?.deals_home} />
          </Field>
          <Field label="Tag Home">
            <Bool v={!!m?.tag_home} />
          </Field>
          <Field label="Amazon Store">
            <Bool v={!!m?.amazon_store} />
          </Field>
          <Field label="Active">
            <Bool v={!!m?.active} />
          </Field>
          <Field label="Show at Search Bar">
            <Bool v={!!m?.show_at_search_bar} />
          </Field>
          <Field label="Extension Active">
            <Bool v={!!m?.extension_active} />
          </Field>
          <Field label="Extension Mandatory">
            <Bool v={!!m?.extension_mandatory} />
          </Field>
          <Field label="Is Header (2)">
            <Bool v={!!m?.is_header_2} />
          </Field>
        </div>

        {/* Radios */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Coupon Icon">{m?.coupon_icon_visibility || "—"}</Field>
          <Field label="Store Status">
            {m?.store_status_visibility || "—"}
          </Field>
        </div>

        {/* Lists */}
        <div className="mt-4 border rounded p-3">
          <div className="font-medium mb-2">Coupon H2 & Descriptions</div>
          {Array.isArray(m?.coupon_h2_blocks) && m.coupon_h2_blocks.length ? (
            <ul className="list-disc pl-6">
              {m.coupon_h2_blocks.map((b, i) => (
                <li key={i}>
                  {b.heading} — {b.description}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500">—</div>
          )}
        </div>

        <div className="mt-4 border rounded p-3">
          <div className="font-medium mb-2">Coupon H3 & Descriptions</div>
          {Array.isArray(m?.coupon_h3_blocks) && m.coupon_h3_blocks.length ? (
            <ul className="list-disc pl-6">
              {m.coupon_h3_blocks.map((b, i) => (
                <li key={i}>
                  {b.heading} — {b.description}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500">—</div>
          )}
        </div>

        <div className="mt-4 border rounded p-3">
          <div className="font-medium mb-2">Store Question and Answers</div>
          {Array.isArray(m?.faqs) && m.faqs.length ? (
            <ul className="list-disc pl-6">
              {m.faqs.map((qa, i) => (
                <li key={i}>
                  <span className="font-medium">{qa.question}</span> —{" "}
                  {qa.answer}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500">—</div>
          )}
        </div>

        <div className="mt-4 border rounded p-3">
          <div className="font-medium mb-2">Store Suggestions</div>
          {Array.isArray(m?.suggestions) && m.suggestions.length ? (
            <ul className="list-disc pl-6">
              {m.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500">—</div>
          )}
        </div>

        <div className="flex justify-end mt-6">
          <button className="border px-4 py-2 rounded" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
