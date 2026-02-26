// src/controllers/couponsController.js
import { uploadImageBuffer } from "../services/storageService.js";
import * as CouponsRepo from "../dbhelper/CouponsRepo.js";
import sharp from "sharp";

const BUCKET = process.env.UPLOAD_BUCKET || "coupon-images";
const FOLDER = "coupons";
const PROOF_FOLDER = "proofs"; // folder inside your bucket

const WEBP_QUALITY = 80; // adjust 60-90 as you like
const MAX_WIDTH = 1600; // optional resize, null to skip

const toBool = (v) => v === true || v === "true" || v === "1";
const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// List
export async function listCoupons(req, res) {
  try {
    const params = {
      search: req.query.search || "",
      store_id: req.query.store_id ? Number(req.query.store_id) : undefined,
      type: req.query.type || "",
      status: req.query.status || "",
      from_date: req.query.from_date || "",
      to_date: req.query.to_date || "",
      page: Math.max(1, toInt(req.query.page || 1, 1)),
      limit: Math.min(100, Math.max(1, toInt(req.query.limit || 20, 20))),
    };
    const { rows, total } = await CouponsRepo.list(params);
    return res.json({ data: { rows, total }, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error listing coupons",
        details: err?.message || err,
      },
    });
  }
}

// Detail
export async function getCoupon(req, res) {
  try {
    const data = await CouponsRepo.getById(req.params.id);
    return res.json({ data, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error fetching coupon",
        details: err?.message || err,
      },
    });
  }
}

// Create
export async function createCoupon(req, res) {
  try {
    const b = req.body || {};
    const f = req.files || {};

    const payload = {
      merchant_id: b.store_id ? Number(b.store_id) : null,
      coupon_type: b.coupon_type || "coupon", // 'coupon' | 'deal'
      title: b.title || "",
      h_block: b.h_block || "",
      coupon_code:
        (b.coupon_type || "coupon") === "coupon" ? b.coupon_code || "" : "",
      aff_url: b.aff_url || "",
      description: b.description || "",
      show_proof: toBool(b.show_proof),
      is_editor: toBool(b.editor_pick),
      editor_order: toInt(b.editor_order || 0, 0),
      coupon_style: b.coupon_style || "custom",
      special_msg_type: b.special_msg_type || "",
      special_msg: b.special_msg || "",
      push_to: b.push_to || "",
      level: b.level || "",
      home: toBool(b.home),
      is_brand_coupon: toBool(b.is_brand_coupon),
      is_publish: b.is_publish,
      click_count: b.click_count ? Number(b.click_count) : 0,
    };

    const created = await CouponsRepo.insert(payload);
    return res.status(201).json({ data: created, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error creating coupon",
        details: err?.message || err,
      },
    });
  }
}

// Update
export async function updateCoupon(req, res) {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const f = req.files || {};

    const patch = {
      merchant_id:
        b.store_id !== undefined
          ? b.store_id
            ? Number(b.store_id)
            : null
          : undefined,
      coupon_type: b.coupon_type ?? undefined,
      title: b.title ?? undefined,
      h_block: b.h_block ?? undefined,
      coupon_code:
        b.coupon_type === "coupon"
          ? (b.coupon_code ?? "")
          : b.coupon_type === "deal"
            ? ""
            : undefined,
      aff_url: b.aff_url ?? undefined,
      description: b.description ?? undefined,
      show_proof: b.show_proof !== undefined ? toBool(b.show_proof) : undefined,
      is_editor:
        b.editor_pick !== undefined ? toBool(b.editor_pick) : undefined,
      editor_order:
        b.editor_order !== undefined
          ? toInt(b.editor_order || 0, 0)
          : undefined,
      coupon_style: b.coupon_style ?? undefined,
      special_msg_type: b.special_msg_type ?? undefined,
      special_msg: b.special_msg ?? undefined,
      push_to: b.push_to ?? undefined,
      level: b.level ?? undefined,
      home: b.home !== undefined ? toBool(b.home) : undefined,
      is_brand_coupon:
        b.is_brand_coupon !== undefined ? toBool(b.is_brand_coupon) : undefined,
    };

    const updated = await CouponsRepo.update(id, patch);
    return res.json({ data: updated, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error updating coupon",
        details: err?.message || err,
      },
    });
  }
}

// Toggle publish
export async function togglePublish(req, res) {
  try {
    const { id } = req.params;
    const data = await CouponsRepo.togglePublish(id);
    return res.json({ data, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error toggling publish",
        details: err?.message || err,
      },
    });
  }
}

// Toggle editor pick
export async function toggleEditorPick(req, res) {
  try {
    const { id } = req.params;
    const data = await CouponsRepo.toggleEditorPick(id);
    return res.json({ data, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error toggling editor pick",
        details: err?.message || err,
      },
    });
  }
}

// Delete
export async function deleteCoupon(req, res) {
  try {
    const { id } = req.params;
    const ok = await CouponsRepo.remove(id);
    if (!ok)
      return res
        .status(500)
        .json({ data: null, error: { message: "Failed to delete coupon" } });
    return res.json({ data: { id }, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error deleting coupon",
        details: err?.message || err,
      },
    });
  }
}

// -----------------------------
// Fetch all proofs for a merchant
// GET /coupons/validation/:merchantId
// -----------------------------
export async function getMerchantProofs(req, res) {
  try {
    const merchantId = Number(req.params.merchantId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 10);

    const data = await CouponsRepo.fetchMerchantProofs(merchantId, page, limit);

    return res.json({ data, error: null });
  } catch (err) {
    return res.status(500).json({ data: null, error: err.message || err });
  }
}

// Requires: import sharp from "sharp"; at top of file
// Also requires BUCKET and PROOF_FOLDER constants defined (or use process.env)

export async function uploadMerchantProofs(req, res) {
  try {
    const merchantId = Number(req.params.merchantId);
    if (!merchantId) {
      return res
        .status(400)
        .json({ data: null, error: { message: "Invalid merchant ID" } });
    }

    const files = req.files || [];
    if (!files.length) {
      return res
        .status(400)
        .json({ data: null, error: { message: "No files uploaded" } });
    }

    // Convert & upload each file, collecting { filename, url } for repo.bulk insert
    const uploadedEntries = [];

    for (const file of files) {
      // --- Optional: convert to webp. Remove this block if you don't want conversion ---
      let bufferToUpload = file.buffer;
      try {
        // convert/resize => webp
        const MAX_WIDTH = 1600; // tweak or set to null to skip resize
        const WEBP_QUALITY = 80;
        let img = sharp(file.buffer);
        if (MAX_WIDTH)
          img = img.resize({ width: MAX_WIDTH, withoutEnlargement: true });
        bufferToUpload = await img.webp({ quality: WEBP_QUALITY }).toBuffer();
      } catch (convErr) {
        console.error(
          "Image conversion failed for",
          file.originalname,
          convErr,
        );
        // fallback: use original buffer
        bufferToUpload = file.buffer;
      }
      // -------------------------------------------------------------------------------

      // prepare filename (use .webp if conversion succeeded)
      const base = (file.originalname || "upload").replace(/\.[^/.]+$/, "");
      const ext = ".webp";
      const upName = `${base}${ext}`;
      const safeName = base.replace(/[^a-zA-Z0-9_-]/g, "_") + ext; // safe name for storage

      // upload to storage
      const { url, error: uploadErr } = await uploadImageBuffer(
        BUCKET || process.env.UPLOAD_BUCKET || "merchant-images",
        PROOF_FOLDER || "merchant-proofs",
        bufferToUpload,
        safeName,
        "image/webp",
      );

      if (uploadErr) {
        console.error("Storage upload failed:", uploadErr);
        return res.status(500).json({
          data: null,
          error: { message: "Storage upload failed", details: uploadErr },
        });
      }

      uploadedEntries.push({ filename: upName, url });
    }

    // Use existing repo helper (bulk insert)
    const inserted = await CouponsRepo.uploadProofs(
      merchantId,
      uploadedEntries,
    );

    return res.status(201).json({ data: inserted, error: null });
  } catch (err) {
    console.error("uploadMerchantProofs error:", err);
    return res.status(500).json({
      data: null,
      error: {
        message: "Error uploading proofs",
        details: err?.message || err,
      },
    });
  }
}

// -----------------------------
// Delete a proof
// DELETE /coupons/validation/proof/:proofId
// -----------------------------
export async function deleteProof(req, res) {
  try {
    const proofId = Number(req.params.proofId);
    if (!proofId)
      return res
        .status(400)
        .json({ data: null, error: { message: "Invalid proof ID" } });

    const deleted = await CouponsRepo.deleteProof(proofId, BUCKET);
    if (!deleted)
      return res
        .status(500)
        .json({ data: null, error: { message: "Failed to delete proof" } });

    return res.json({ data: { id: proofId }, error: null });
  } catch (err) {
    return res.status(500).json({
      data: null,
      error: {
        message: "Error deleting proof",
        details: err?.message || err,
      },
    });
  }
}
