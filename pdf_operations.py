"""
pdf_operations.py — Pure PDF processing functions (no HTTP concerns).
All functions accept file paths, write output to disk, and return output path(s).
"""

import os
import re
import zipfile

import fitz  # PyMuPDF
from PIL import Image


class PDFOperationError(Exception):
    """Raised for expected, user-facing errors during PDF processing."""
    pass


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------

def parse_page_spec(spec: str, total_pages: int) -> list:
    """
    Convert a human-readable page spec string to a sorted list of 0-indexed page numbers.

    Examples:
        "1-3, 5, 7-9"  (total=10) → [0, 1, 2, 4, 6, 7, 8]
        "all"           (total=5)  → [0, 1, 2, 3, 4]
        "2"             (total=5)  → [1]

    Raises PDFOperationError for invalid syntax or out-of-range pages.
    """
    spec = spec.strip()
    if spec.lower() == "all":
        return list(range(total_pages))

    pages = set()
    segments = re.split(r"[,;]+", spec)
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        range_match = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", seg)
        single_match = re.fullmatch(r"(\d+)", seg)
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            if start < 1:
                raise PDFOperationError(f"Page numbers start at 1, got '{seg}'.")
            if start > end:
                raise PDFOperationError(f"Range start must be ≤ end in '{seg}'.")
            if end > total_pages:
                raise PDFOperationError(
                    f"Page {end} is out of range — this PDF has {total_pages} page(s)."
                )
            pages.update(range(start - 1, end))
        elif single_match:
            p = int(single_match.group(1))
            if p < 1 or p > total_pages:
                raise PDFOperationError(
                    f"Page {p} is out of range — this PDF has {total_pages} page(s)."
                )
            pages.add(p - 1)
        else:
            raise PDFOperationError(
                f"Invalid page specification: '{seg}'. Use numbers and ranges like '1-3, 5, 7'."
            )

    if not pages:
        raise PDFOperationError("No pages selected.")

    return sorted(pages)


def _create_zip(file_paths: list, zip_path: str) -> str:
    """Zip a list of file paths into zip_path. Returns zip_path."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in file_paths:
            zf.write(fp, arcname=os.path.basename(fp))
    return zip_path


# ---------------------------------------------------------------------------
# 1. Merge
# ---------------------------------------------------------------------------

def merge_pdfs(input_paths: list, output_path: str) -> str:
    """
    Merge multiple PDF files into one.

    Args:
        input_paths: Ordered list of input PDF paths (≥ 2).
        output_path: Destination path for the merged PDF.

    Returns:
        output_path
    """
    if len(input_paths) < 2:
        raise PDFOperationError("Please provide at least 2 PDF files to merge.")

    result = fitz.open()
    for path in input_paths:
        try:
            src = fitz.open(path)
        except Exception:
            raise PDFOperationError(f"Could not open '{os.path.basename(path)}' — is it a valid PDF?")
        result.insert_pdf(src)
        src.close()

    result.save(output_path, garbage=4, deflate=True)
    result.close()
    return output_path


# ---------------------------------------------------------------------------
# 2. Split
# ---------------------------------------------------------------------------

def split_pdf(input_path: str, output_dir: str, mode: str, ranges: str = None) -> str:
    """
    Split a PDF into multiple files.

    Args:
        input_path: Source PDF path.
        output_dir:  Directory for output files.
        mode:        "pages" (one file per page) | "ranges" (one file per range).
        ranges:      Required when mode="ranges". E.g. "1-3, 5, 7-9".

    Returns:
        Path to a ZIP archive containing all output PDFs.
    """
    try:
        src = fitz.open(input_path)
    except Exception:
        raise PDFOperationError("Could not open the PDF file — is it a valid PDF?")

    total = src.page_count
    if total == 0:
        raise PDFOperationError("The PDF has no pages.")

    output_files = []

    if mode == "pages":
        # One file per page
        digits = len(str(total))
        for i in range(total):
            new_doc = fitz.open()
            new_doc.insert_pdf(src, from_page=i, to_page=i)
            out_path = os.path.join(output_dir, f"page_{str(i + 1).zfill(digits)}.pdf")
            new_doc.save(out_path, garbage=4, deflate=True)
            new_doc.close()
            output_files.append(out_path)

    elif mode == "ranges":
        if not ranges or not ranges.strip():
            raise PDFOperationError("Please enter page ranges for splitting.")

        # Parse each comma-separated segment individually as a range
        segments = [s.strip() for s in re.split(r"[,;]+", ranges) if s.strip()]
        if not segments:
            raise PDFOperationError("No valid ranges provided.")

        digits = len(str(len(segments)))
        for idx, seg in enumerate(segments):
            page_indices = parse_page_spec(seg, total)
            new_doc = fitz.open()
            for p in page_indices:
                new_doc.insert_pdf(src, from_page=p, to_page=p)
            label = seg.replace(" ", "").replace("-", "_")
            out_path = os.path.join(output_dir, f"part_{str(idx + 1).zfill(digits)}_pages_{label}.pdf")
            new_doc.save(out_path, garbage=4, deflate=True)
            new_doc.close()
            output_files.append(out_path)
    else:
        raise PDFOperationError(f"Unknown split mode: '{mode}'.")

    src.close()

    if not output_files:
        raise PDFOperationError("Split produced no output files.")

    zip_path = os.path.join(output_dir, "split_result.zip")
    return _create_zip(output_files, zip_path)


# ---------------------------------------------------------------------------
# 3. Rotate
# ---------------------------------------------------------------------------

def rotate_pages(
    input_path: str,
    output_path: str,
    angle: int,
    page_spec: str = "all",
) -> str:
    """
    Rotate pages in a PDF.

    Args:
        input_path:  Source PDF path.
        output_path: Destination path.
        angle:       Degrees to rotate (90, 180, or 270).
        page_spec:   "all" or a page range string.

    Returns:
        output_path
    """
    if angle not in (90, 180, 270):
        raise PDFOperationError("Rotation angle must be 90, 180, or 270 degrees.")

    try:
        doc = fitz.open(input_path)
    except Exception:
        raise PDFOperationError("Could not open the PDF file — is it a valid PDF?")

    total = doc.page_count
    target_pages = set(parse_page_spec(page_spec, total))

    for i, page in enumerate(doc):
        if i in target_pages:
            current = page.rotation
            page.set_rotation((current + angle) % 360)

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    return output_path


# ---------------------------------------------------------------------------
# 4. Extract Pages
# ---------------------------------------------------------------------------

def extract_pages(input_path: str, output_path: str, page_spec: str) -> str:
    """
    Extract specific pages into a new PDF.

    Args:
        input_path:  Source PDF path.
        output_path: Destination path.
        page_spec:   Page range string, e.g. "1-3, 5, 7-9".

    Returns:
        output_path
    """
    if not page_spec or not page_spec.strip():
        raise PDFOperationError("Please enter the page range(s) to extract.")

    try:
        src = fitz.open(input_path)
    except Exception:
        raise PDFOperationError("Could not open the PDF file — is it a valid PDF?")

    total = src.page_count
    page_indices = parse_page_spec(page_spec, total)

    new_doc = fitz.open()
    for p in page_indices:
        new_doc.insert_pdf(src, from_page=p, to_page=p)

    new_doc.save(output_path, garbage=4, deflate=True)
    new_doc.close()
    src.close()
    return output_path


# ---------------------------------------------------------------------------
# 5. Compress
# ---------------------------------------------------------------------------

def compress_pdf(input_path: str, output_path: str, image_quality: int = 60) -> str:
    """
    Reduce PDF file size by compressing streams and re-encoding embedded images.

    Args:
        input_path:    Source PDF path.
        output_path:   Destination path.
        image_quality: JPEG quality for re-encoded images (1-100, default 60).

    Returns:
        output_path
    """
    if not (1 <= image_quality <= 100):
        raise PDFOperationError("Image quality must be between 1 and 100.")

    try:
        doc = fitz.open(input_path)
    except Exception:
        raise PDFOperationError("Could not open the PDF file — is it a valid PDF?")

    # Re-compress embedded images
    for page in doc:
        image_list = page.get_images(full=True)
        for img_info in image_list:
            xref = img_info[0]
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                img_ext = base_image.get("ext", "png").lower()

                # Only re-compress non-JPEG images or images we can lossily compress
                if img_ext in ("png", "bmp", "tiff", "tif"):
                    pil_img = Image.open(__import__("io").BytesIO(image_bytes))
                    if pil_img.mode in ("RGBA", "LA", "P"):
                        pil_img = pil_img.convert("RGB")
                    buf = __import__("io").BytesIO()
                    pil_img.save(buf, format="JPEG", quality=image_quality, optimize=True)
                    new_bytes = buf.getvalue()
                    # Replace only if smaller
                    if len(new_bytes) < len(image_bytes):
                        doc.update_stream(xref, new_bytes)
            except Exception:
                # Skip images we can't process; don't fail the whole operation
                continue

    doc.save(
        output_path,
        garbage=4,       # remove unused objects, consolidate duplicates
        deflate=True,    # compress streams
        clean=True,      # sanitize content streams
    )
    doc.close()
    return output_path


# ---------------------------------------------------------------------------
# 6. PDF → Images
# ---------------------------------------------------------------------------

def pdf_to_images(
    input_path: str,
    output_dir: str,
    fmt: str = "jpg",
    dpi: int = 150,
) -> str:
    """
    Render each PDF page as an image and return them in a ZIP archive.

    Args:
        input_path:  Source PDF path.
        output_dir:  Directory for image files.
        fmt:         Output format: "jpg" or "png".
        dpi:         Render resolution (72–300).

    Returns:
        Path to a ZIP archive containing all images.
    """
    fmt = fmt.lower().strip()
    if fmt not in ("jpg", "jpeg", "png"):
        raise PDFOperationError("Image format must be 'jpg' or 'png'.")
    if not (72 <= dpi <= 300):
        raise PDFOperationError("DPI must be between 72 and 300.")

    try:
        doc = fitz.open(input_path)
    except Exception:
        raise PDFOperationError("Could not open the PDF file — is it a valid PDF?")

    total = doc.page_count
    digits = len(str(total))
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    ext = "jpg" if fmt in ("jpg", "jpeg") else "png"
    output_files = []

    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        out_path = os.path.join(output_dir, f"page_{str(i + 1).zfill(digits)}.{ext}")
        pix.save(out_path)
        output_files.append(out_path)

    doc.close()

    zip_path = os.path.join(output_dir, "pdf_images.zip")
    return _create_zip(output_files, zip_path)


# ---------------------------------------------------------------------------
# 7. Images → PDF
# ---------------------------------------------------------------------------

def images_to_pdf(
    image_paths: list,
    output_path: str,
    page_size: str = "auto",
) -> str:
    """
    Combine image files into a single PDF.

    Args:
        image_paths: Ordered list of image file paths (JPG, PNG, BMP, GIF, etc.).
        output_path: Destination PDF path.
        page_size:   "auto" (match image dimensions) | "a4" | "letter".

    Returns:
        output_path
    """
    if not image_paths:
        raise PDFOperationError("Please provide at least one image file.")

    # Page size presets in points (72 pt = 1 inch)
    SIZES = {
        "a4":     (595, 842),
        "letter": (612, 792),
    }

    doc = fitz.open()

    for img_path in image_paths:
        try:
            pil_img = Image.open(img_path)
        except Exception:
            raise PDFOperationError(
                f"Could not open image '{os.path.basename(img_path)}'. "
                "Supported formats: JPG, PNG, BMP, GIF, TIFF."
            )

        # Normalize to RGB (PDFs don't support RGBA/palette modes directly)
        if pil_img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", pil_img.size, (255, 255, 255))
            if pil_img.mode == "P":
                pil_img = pil_img.convert("RGBA")
            bg.paste(pil_img, mask=pil_img.split()[-1] if "A" in pil_img.mode else None)
            pil_img = bg
        elif pil_img.mode != "RGB":
            pil_img = pil_img.convert("RGB")

        img_w, img_h = pil_img.size  # pixels

        if page_size.lower() == "auto":
            # Use image dimensions as page dimensions (at 72 dpi = 1 px per point)
            page_w, page_h = float(img_w), float(img_h)
        else:
            page_w, page_h = SIZES.get(page_size.lower(), SIZES["a4"])
            # Scale image to fit page while preserving aspect ratio
            scale = min(page_w / img_w, page_h / img_h)
            img_w = int(img_w * scale)
            img_h = int(img_h * scale)
            pil_img = pil_img.resize((img_w, img_h), Image.LANCZOS)

        # Convert PIL image to bytes
        import io
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=92, optimize=True)
        img_bytes = buf.getvalue()

        # Create page and insert image
        page = doc.new_page(width=page_w, height=page_h)
        # Center image on page
        x_offset = (page_w - img_w) / 2
        y_offset = (page_h - img_h) / 2
        rect = fitz.Rect(x_offset, y_offset, x_offset + img_w, y_offset + img_h)
        page.insert_image(rect, stream=img_bytes)

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    return output_path


# ---------------------------------------------------------------------------
# 8. Merge Images → single JPEG
# ---------------------------------------------------------------------------

def merge_images(
    image_paths: list,
    output_path: str,
    layout: str = "vertical",
) -> str:
    """
    Stitch multiple images into a single JPEG.

    Args:
        image_paths: Ordered list of image file paths.
        output_path: Destination JPEG path.
        layout:      "vertical" (stack top-to-bottom, same width)
                     | "horizontal" (side by side, same height).

    Returns:
        output_path
    """
    if len(image_paths) < 2:
        raise PDFOperationError("Please provide at least 2 images to merge.")
    if layout not in ("vertical", "horizontal"):
        raise PDFOperationError("Layout must be 'vertical' or 'horizontal'.")

    images = []
    for path in image_paths:
        try:
            img = Image.open(path).convert("RGB")
            images.append(img)
        except Exception:
            raise PDFOperationError(
                f"Could not open '{os.path.basename(path)}'. "
                "Supported formats: JPG, PNG, BMP, GIF, TIFF."
            )

    if layout == "vertical":
        # Scale all images to the width of the widest one
        target_w = max(img.width for img in images)
        resized = []
        for img in images:
            if img.width != target_w:
                scale = target_w / img.width
                img = img.resize((target_w, int(img.height * scale)), Image.LANCZOS)
            resized.append(img)
        total_h = sum(img.height for img in resized)
        canvas = Image.new("RGB", (target_w, total_h), (255, 255, 255))
        y = 0
        for img in resized:
            canvas.paste(img, (0, y))
            y += img.height

    else:  # horizontal
        # Scale all images to the height of the tallest one
        target_h = max(img.height for img in images)
        resized = []
        for img in images:
            if img.height != target_h:
                scale = target_h / img.height
                img = img.resize((int(img.width * scale), target_h), Image.LANCZOS)
            resized.append(img)
        total_w = sum(img.width for img in resized)
        canvas = Image.new("RGB", (total_w, target_h), (255, 255, 255))
        x = 0
        for img in resized:
            canvas.paste(img, (x, 0))
            x += img.width

    canvas.save(output_path, format="JPEG", quality=92, optimize=True)
    return output_path
