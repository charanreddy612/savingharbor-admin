import React, { useState } from "react";
import { createAuthor } from "../../services/authorService";
import useEscClose from "../hooks/useEscClose";

const MAX_BIO = 200;

export default function AddAuthorModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    designation: "",
    verifying_since: "",
    bio_html: "",
    is_content_author: true,
    is_active: true,
    social: {
      x: "",
      facebook: "",
      linkedin: "",
      tiktok: "",
      instagram: "",
    },
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEscClose(onClose);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({
      ...f,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSocialChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({
      ...f,
      social: { ...f.social, [name]: value },
    }));
  };

  const validate = () => {
    const name = form.name.trim();
    if (name.length < 5 || name.length > 40) {
      return "Name must be between 5 and 40 characters.";
    }

    const email = form.email.trim();
    if (!email) return "Email is required.";

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Invalid email format.";

    if (form.bio_html.length > MAX_BIO) {
      return `Bio must be <= ${MAX_BIO} characters.`;
    }

    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    const same_as = Object.entries(form.social)
      .filter(([_, url]) => url.trim() !== "")
      .map(([type, url]) => ({
        type,
        url: url.trim(),
      }));

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      designation: form.designation.trim() || null,
      verifying_since: form.verifying_since.trim() || null,
      bio_html: form.bio_html.trim() || null,
      same_as,
      is_content_author: form.is_content_author,
      is_active: form.is_active,
    };

    const { error: apiError } = await createAuthor(payload);

    setSaving(false);

    if (apiError) {
      if (apiError.code === "23505") {
        setError("Email already exists.");
      } else {
        setError("Failed to create author.");
      }
      return;
    }

    onSave?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-xl rounded shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Add Author</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-red-600 text-sm font-medium">{error}</div>
          )}

          {/* Name */}
          <div>
            <label>Name *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={40}
              className="w-full border px-3 py-2 rounded"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label>Email *</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              className="w-full border px-3 py-2 rounded"
              required
            />
          </div>

          {/* Designation */}
          <div>
            <label>Designation</label>
            <input
              name="designation"
              value={form.designation}
              onChange={handleChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          {/* Verifying Since */}
          <div>
            <label>Verifying Since (Year)</label>
            <input
              name="verifying_since"
              type="number"
              min="0"
              value={form.verifying_since}
              onChange={handleChange}
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          {/* Bio */}
          <div>
            <label>Bio (max 200 chars)</label>
            <textarea
              name="bio_html"
              value={form.bio_html}
              onChange={handleChange}
              maxLength={MAX_BIO}
              className="w-full border px-3 py-2 rounded"
            />
            <div className="text-xs text-gray-500 text-right">
              {form.bio_html.length}/{MAX_BIO}
            </div>
          </div>

          {/* Social Links */}
          <div className="space-y-2">
            <label className="font-medium">Social Profiles</label>

            {["x", "facebook", "linkedin", "tiktok", "instagram"].map(
              (platform) => (
                <input
                  key={platform}
                  name={platform}
                  placeholder={`${platform} URL`}
                  value={form.social[platform]}
                  onChange={handleSocialChange}
                  className="w-full border px-3 py-2 rounded"
                />
              ),
            )}
          </div>

          {/* Content Author */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_content_author"
              checked={form.is_content_author}
              onChange={handleChange}
            />
            <span>Is Content Author</span>
          </div>

          {/* Active */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_active"
              checked={form.is_active}
              onChange={handleChange}
            />
            <span>Active</span>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="border px-4 py-2 rounded"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
            >
              {saving ? "Saving..." : "Add Author"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
