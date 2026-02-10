// src/components/coupons/AddProofModal.jsx
import React, { useState } from "react";
import { uploadProofs } from "../../services/couponsService";
import useEscClose from "../hooks/useEscClose";

export default function AddProofModal({ merchant, onClose, onSave }) {
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(selected);
    setError("");
  };

  const handleRemoveFile = (index) => {
    setFiles((f) => f.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) {
      setError("Please select at least one file.");
      return;
    }

    setSaving(true);
    const fd = new FormData();
    // files.forEach((f) => fd.append("proofs", f));
    files.forEach((f) => {
      const safeName = sanitizeFileName(f.name);
      fd.append("proofs", f, safeName);
    });

    try {
      const { data, error } = await uploadProofs(merchant.id, fd);
      if (error) {
        setError(error.message || "Failed to add proofs.");
      } else {
        onSave?.();
        onClose();
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  };

  const sanitizeFileName = (name) => {
    const ext = name.substring(name.lastIndexOf("."));
    const base = name.substring(0, name.lastIndexOf("."));
    // Replace anything that's not alphanumeric, hyphen, or underscore
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "_");
    return clean + ext;
  };

  useEscClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-3xl rounded shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Add Proofs</h2>
        <p className="mb-3 text-gray-600">
          Merchant: <strong>{merchant.name}</strong>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1">Select Proof Images</label>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileChange}
            />
            {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              {files.map((file, i) => (
                <div
                  key={i}
                  className="relative border rounded overflow-hidden"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-20 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(i)}
                    className="absolute top-0 right-0 bg-red-600 text-white px-1 rounded-bl"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="border px-4 py-2 rounded"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
              disabled={saving}
            >
              {saving ? "Saving..." : "Add Proofs"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
