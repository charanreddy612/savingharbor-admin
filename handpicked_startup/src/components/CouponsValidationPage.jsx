// src/pages/coupons/CouponsValidationPage.jsx
import React, { useEffect, useState, useRef } from "react";
import { listMerchants } from "../services/merchantService.js";
import {
  fetchMerchantProofs,
  deleteProof,
} from "../services/couponsService.js";
import AddProofModal from "../components/modals/AddProofModal.jsx";

export default function CouponsValidationPage() {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchRef = useRef(null);

  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const PAGE_SIZE = 10;

  /* ===========================
     Merchant async search
     =========================== */
  useEffect(() => {
    if (search.length < 3) {
      setSearchResults([]);
      return;
    }

    let mounted = true;
    (async () => {
      setSearchLoading(true);
      const res = await listMerchants({ name: search, limit: 10 });
      if (!mounted) return;
      setSearchResults(
        (res?.data || []).map((m) => ({
          id: m.id,
          name: m.name,
          slug: m.slug,
        }))
      );
      setHighlightIndex(-1);
      setSearchLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [search]);

  const selectMerchant = (m) => {
    setSelectedMerchant(m);
    setSearch(m.name || m.slug || "");
    setSearchResults([]);
    setPage(1);
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
      selectMerchant(searchResults[highlightIndex]);
    }
    if (e.key === "Escape") {
      setSearch("");
      setSearchResults([]);
      setHighlightIndex(-1);
      setSelectedMerchant(null);
    }
  };

  /* ===========================
     Fetch proofs
     =========================== */
  useEffect(() => {
    if (!selectedMerchant) {
      setProofs([]);
      setPage(1);
      setTotalPages(1);
      return;
    }

    let mounted = true;
    setLoading(true);

    (async () => {
      const { data, error } = await fetchMerchantProofs(
        selectedMerchant.id,
        page,
        PAGE_SIZE
      );

      if (!mounted) return;

      if (!error) {
        setProofs(data.rows || []);
        setTotalPages(Math.ceil((data.total || 0) / PAGE_SIZE));
      } else {
        console.error("Error fetching proofs:", error);
      }
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [selectedMerchant, refreshKey, page]);

  const handleDeleteProof = async (id) => {
    if (!window.confirm("Delete this proof?")) return;
    const { error } = await deleteProof(id);
    if (!error) setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Coupons Validation</h1>
        {selectedMerchant && (
          <button
            className="bg-blue-600 text-white px-3 py-2 rounded"
            onClick={() => setShowAddModal(true)}
          >
            + Add Proof
          </button>
        )}
      </div>

      {/* Merchant Search */}
      <div className="mb-4">
        <label className="block mb-2 font-medium">Search Merchant</label>
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
              {searchResults.map((m, i) => (
                <div
                  key={m.id}
                  className={`px-3 py-2 cursor-pointer ${
                    i === highlightIndex ? "bg-blue-100" : ""
                  }`}
                  onMouseDown={() => selectMerchant(m)}
                >
                  {m.name || m.slug}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proofs Table */}
      <div className="border rounded mb-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 border-b">ID</th>
                <th className="text-left p-2 border-b">Filename / URL</th>
                <th className="text-left p-2 border-b">Uploaded At</th>
                <th className="text-left p-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center">
                    Loading…
                  </td>
                </tr>
              ) : proofs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center">
                    No proofs found.
                  </td>
                </tr>
              ) : (
                proofs.map((p) => (
                  <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border-b">{p.id}</td>
                    <td className="p-2 border-b">{p.filename || p.url}</td>
                    <td className="p-2 border-b">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2 border-b">
                      <button
                        className="bg-red-600 text-white px-2 py-1 rounded"
                        onClick={() => handleDeleteProof(p.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mb-4">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Add Proof Modal */}
      {showAddModal && selectedMerchant && (
        <AddProofModal
          merchant={selectedMerchant}
          onClose={() => setShowAddModal(false)}
          onSave={() => {
            setShowAddModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
