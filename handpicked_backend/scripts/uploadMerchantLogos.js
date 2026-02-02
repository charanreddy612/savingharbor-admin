import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import axios from "axios";
import sharp from "sharp";
import { supabase } from "../dbhelper/dbclient.js";
import { uploadImageBuffer } from "../services/storageService.js";

const EXCEL_PATH = path.resolve(process.cwd(), "stores.xlsx");
const BUCKET = "merchant-images";
const FOLDER = "merchants";

function getFileNameFromUrl(url) {
  try {
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    return `logo-${Date.now()}`;
  }
}

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  return {
    buffer: Buffer.from(res.data),
    contentType: res.headers["content-type"] || "",
  };
}

async function convertToWebp(buffer) {
  return sharp(buffer).webp({ quality: 85 }).toBuffer();
}

async function run() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error("stores.xlsx not found");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.worksheets[0];

  console.log(`📄 Loaded Excel: ${sheet.rowCount - 1} rows\n`);

  // Build header -> column index map
  const headerRow = sheet.getRow(1);
  const colIndex = {};

  headerRow.eachCell((cell, colNumber) => {
    if (cell.value) {
      colIndex[String(cell.value).trim().toLowerCase()] = colNumber;
    }
  });

  // Validate required columns
  if (!colIndex.store_name || !colIndex.logo_url) {
    throw new Error("Excel must contain 'store_name' and 'logo_url' columns");
  }

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);

    const storeName = String(
      row.getCell(colIndex.store_name).value || ""
    ).trim();

    const logoUrl = String(row.getCell(colIndex.logo_url).value || "").trim();

    if (!storeName || !logoUrl) {
      console.log(`⏭️  Skipped row ${i} (missing store_name or logo_url)`);
      continue;
    }

    console.log(`🔄 [${i - 1}] Processing: ${storeName}`);

    try {
      // 1. Download image
      const { buffer } = await downloadImage(logoUrl);

      // 2. Convert to WEBP
      const webpBuffer = await convertToWebp(buffer);

      // 3. Upload to Supabase
      const filename = getFileNameFromUrl(logoUrl).replace(
        /\.(png|jpg|jpeg|webp)$/i,
        ".webp"
      );

      const { url: publicUrl, error } = await uploadImageBuffer(
        BUCKET,
        FOLDER,
        webpBuffer,
        filename,
        "image/webp"
      );

      if (error || !publicUrl) {
        throw error || new Error("Upload failed");
      }

      // 4. Update merchants table
      const { error: dbError } = await supabase
        .from("merchants")
        .update({ logo_url: publicUrl })
        .eq("name", storeName);

      if (dbError) throw dbError;

      console.log(`✅ Updated logo for "${storeName}"`);
    } catch (err) {
      console.error(`❌ Failed for "${storeName}": ${err.message}`);
    }
  }

  console.log("\n🎉 Logo migration completed");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
