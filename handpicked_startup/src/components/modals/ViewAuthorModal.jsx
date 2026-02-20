import React, { useEffect, useState } from "react";
import { getAuthor } from "../../services/authorService";
import useEscClose from "../hooks/useEscClose";

export default function ViewAuthorModal({ authorId, onClose }) {
  const [a, setA] = useState(null);

  useEscClose(onClose);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const data = await getAuthor(authorId);
      if (mounted) setA(data);
    })();
    return () => {
      mounted = false;
    };
  }, [authorId]);

  if (!a) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 text-white">
        Loading author...
      </div>
    );
  }

  const social =
    Array.isArray(a.same_as) && a.same_as.length > 0 ? a.same_as : [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-xl rounded shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{a.name}</h2>

        <div className="space-y-3 text-sm">
          <p>
            <strong>Email:</strong> {a.email || "—"}
          </p>

          <p>
            <strong>Designation:</strong> {a.designation || "—"}
          </p>

          <p>
            <strong>Verifying Since:</strong>{" "}
            {a.verifying_since || "—"}
          </p>

          <p>
            <strong>Content Author:</strong>{" "}
            {a.is_content_author ? "Yes" : "No"}
          </p>

          <p>
            <strong>Active:</strong> {a.is_active ? "Yes" : "No"}
          </p>

          <div>
            <strong>Bio:</strong>
            <p className="mt-1 whitespace-pre-wrap">{a.bio_html || "—"}</p>
          </div>

          <div>
            <strong>Social Profiles:</strong>
            {social.length === 0 ? (
              <p className="mt-1">—</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {social.map((s, idx) => (
                  <li key={idx}>
                    <span className="capitalize">{s.type}:</span>{" "}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline break-all"
                    >
                      {s.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p>
            <strong>Created:</strong>{" "}
            {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
          </p>

          <p>
            <strong>Updated:</strong>{" "}
            {a.updated_at ? new Date(a.updated_at).toLocaleString() : "—"}
          </p>
        </div>

        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="border px-4 py-2 rounded">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
