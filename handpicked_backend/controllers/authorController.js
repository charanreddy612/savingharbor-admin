import * as authorRepo from "../dbhelper/AuthorRepo.js";

const toError = (err, msg = "Server error") => ({
  data: null,
  error: { message: msg, details: err?.message || err },
});
const toBool = (v) => v === true || v === "true" || v === 1 || v === "1";

export async function listAuthors(req, res) {
  try {
    const { name, email } = req.query;
    const rows = await authorRepo.list({
      name: name || null,
      email: email || null,
    });
    return res.json({ data: rows, error: null });
  } catch (err) {
    return res.status(500).json(toError(err, "Error fetching authors"));
  }
}

export async function getAuthor(req, res) {
  try {
    const row = await authorRepo.getById(req.params.id);
    if (!row) return res.status(404).json(toError({}, "Author not found"));
    return res.json({ data: row, error: null });
  } catch (err) {
    return res.status(500).json(toError(err, "Error fetching author"));
  }
}

export async function createAuthor(req, res) {
  try {
    const b = req.body || {};

    if (!b.name || !String(b.name).trim()) {
      return res.status(400).json({
        data: null,
        error: { message: "Name is required" },
      });
    }

    const created = await authorRepo.insert({
      name: String(b.name).trim(),
      email: b.email || null,
      designation: b.designation || null,
      verifying_since: b.verifying_since || null,
      bio_html: b.bio_html || null,
      same_as: Array.isArray(b.same_as) ? b.same_as : [],
      is_content_author:
        b.is_content_author !== undefined ? toBool(b.is_content_author) : true,
      is_active: b.is_active !== undefined ? toBool(b.is_active) : true,
    });

    return res.status(201).json({ data: created, error: null });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        data: null,
        error: { code: "23505", message: "Email already exists" },
      });
    }

    return res.status(500).json(toError(err, "Error creating author"));
  }
}

export async function updateAuthor(req, res) {
  try {
    const { id } = req.params;
    const b = req.body || {};

    const patch = {
      name: b.name,
      email: b.email,
      designation: b.designation,
      verifying_since: b.verifying_since,
      bio_html: b.bio_html,
      same_as: Array.isArray(b.same_as) ? b.same_as : undefined,
      is_content_author:
        b.is_content_author !== undefined
          ? toBool(b.is_content_author)
          : undefined,
      is_active: b.is_active !== undefined ? toBool(b.is_active) : undefined,
    };

    const updated = await authorRepo.update(id, patch);

    return res.json({ data: updated, error: null });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        data: null,
        error: { code: "23505", message: "Email already exists" },
      });
    }

    return res.status(500).json(toError(err, "Error updating author"));
  }
}

export async function updateAuthorStatus(req, res) {
  try {
    const updated = await authorRepo.update(req.params.id, {
      is_active: toBool(req.body.is_active),
    });
    return res.json({ data: updated, error: null });
  } catch (err) {
    return res.status(500).json(toError(err, "Error updating author status"));
  }
}

export async function deleteAuthor(req, res) {
  try {
    await authorRepo.remove(req.params.id);
    return res.json({ data: { id: Number(req.params.id) }, error: null });
  } catch (err) {
    return res.status(500).json(toError(err, "Error deleting author"));
  }
}
