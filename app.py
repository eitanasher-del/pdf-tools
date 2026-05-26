"""
app.py — Flask web server for PDF Tools.
Run via run.bat or: python app.py
"""

import logging
import os
import shutil
import threading
import time
import uuid

from flask import Flask, jsonify, render_template, request, send_file

import pdf_operations as ops

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Startup cleanup
# ---------------------------------------------------------------------------

def clean_stale_uploads(max_age_seconds: int = 3600) -> None:
    """Delete upload subfolders older than max_age_seconds."""
    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR)
        return
    cutoff = time.time() - max_age_seconds
    for entry in os.scandir(UPLOAD_DIR):
        if entry.is_dir() and entry.stat().st_mtime < cutoff:
            shutil.rmtree(entry.path, ignore_errors=True)
            logger.info("Cleaned stale upload dir: %s", entry.path)


clean_stale_uploads()

# ---------------------------------------------------------------------------
# Per-request helpers
# ---------------------------------------------------------------------------

def make_session_dir() -> str:
    """Create and return a unique temp directory for this request."""
    path = os.path.join(UPLOAD_DIR, str(uuid.uuid4()))
    os.makedirs(path, exist_ok=True)
    return path


def cleanup_later(path: str, delay: int = 30) -> None:
    """Delete path in a background thread after delay seconds."""
    def _delete():
        time.sleep(delay)
        shutil.rmtree(path, ignore_errors=True)
    threading.Thread(target=_delete, daemon=True).start()


def save_upload(file_storage, dest_dir: str, index: int = 0) -> str:
    """Save a Werkzeug FileStorage to dest_dir. Returns the saved path."""
    original_name = file_storage.filename or f"file_{index}"
    # Sanitise filename (keep only safe characters)
    safe_name = "".join(c for c in original_name if c.isalnum() or c in "._- ")
    if not safe_name:
        safe_name = f"file_{index}.pdf"
    dest = os.path.join(dest_dir, f"{index:03d}_{safe_name}")
    file_storage.save(dest)
    return dest


def validate_pdf_files(files, min_count: int = 1) -> None:
    """Raise 400 if the required number of PDF files aren't present."""
    pdfs = [f for f in files if f and f.filename]
    if len(pdfs) < min_count:
        raise ops.PDFOperationError(
            f"Please select at least {min_count} PDF file(s)."
        )
    for f in pdfs:
        name = f.filename.lower()
        if not name.endswith(".pdf"):
            raise ops.PDFOperationError(
                f"'{f.filename}' is not a PDF. Only .pdf files are accepted here."
            )


def validate_image_files(files, min_count: int = 1) -> None:
    """Raise 400 if the required number of image files aren't present."""
    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".tif", ".webp"}
    imgs = [f for f in files if f and f.filename]
    if len(imgs) < min_count:
        raise ops.PDFOperationError(
            f"Please select at least {min_count} image file(s)."
        )
    for f in imgs:
        ext = os.path.splitext(f.filename.lower())[1]
        if ext not in IMAGE_EXTS:
            raise ops.PDFOperationError(
                f"'{f.filename}' is not a supported image. "
                "Accepted formats: JPG, PNG, BMP, GIF, TIFF."
            )


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(ops.PDFOperationError)
def handle_pdf_error(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. Maximum combined upload size is 500 MB."}), 413


@app.errorhandler(Exception)
def handle_unexpected(e):
    logger.exception("Unexpected error during request")
    return jsonify({"error": "Processing failed.", "detail": str(e)}), 500


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/merge", methods=["POST"])
def api_merge():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=2)

    session_dir = make_session_dir()
    try:
        input_paths = [save_upload(f, session_dir, i) for i, f in enumerate(files)]
        output_path = os.path.join(session_dir, "merged.pdf")
        ops.merge_pdfs(input_paths, output_path)
        cleanup_later(session_dir)
        return send_file(output_path, mimetype="application/pdf",
                         as_attachment=True, download_name="merged.pdf")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/split", methods=["POST"])
def api_split():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=1)

    mode = request.form.get("mode", "pages").strip()
    if mode not in ("pages", "ranges"):
        raise ops.PDFOperationError("Split mode must be 'pages' or 'ranges'.")

    ranges = request.form.get("ranges", "").strip()

    session_dir = make_session_dir()
    try:
        input_path = save_upload(files[0], session_dir, 0)
        zip_path = ops.split_pdf(input_path, session_dir, mode, ranges or None)
        cleanup_later(session_dir)
        return send_file(zip_path, mimetype="application/zip",
                         as_attachment=True, download_name="split_pages.zip")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/rotate", methods=["POST"])
def api_rotate():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=1)

    try:
        angle = int(request.form.get("angle", 90))
    except ValueError:
        raise ops.PDFOperationError("Rotation angle must be a number.")
    if angle not in (90, 180, 270):
        raise ops.PDFOperationError("Rotation angle must be 90, 180, or 270.")

    page_spec = request.form.get("page_spec", "all").strip() or "all"

    session_dir = make_session_dir()
    try:
        input_path = save_upload(files[0], session_dir, 0)
        output_path = os.path.join(session_dir, "rotated.pdf")
        ops.rotate_pages(input_path, output_path, angle, page_spec)
        cleanup_later(session_dir)
        return send_file(output_path, mimetype="application/pdf",
                         as_attachment=True, download_name="rotated.pdf")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/extract", methods=["POST"])
def api_extract():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=1)

    page_spec = request.form.get("page_spec", "").strip()
    if not page_spec:
        raise ops.PDFOperationError("Please enter the page range(s) to extract, e.g. '1-3, 5'.")

    session_dir = make_session_dir()
    try:
        input_path = save_upload(files[0], session_dir, 0)
        output_path = os.path.join(session_dir, "extracted.pdf")
        ops.extract_pages(input_path, output_path, page_spec)
        cleanup_later(session_dir)
        return send_file(output_path, mimetype="application/pdf",
                         as_attachment=True, download_name="extracted_pages.pdf")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/compress", methods=["POST"])
def api_compress():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=1)

    try:
        quality = int(request.form.get("quality", 60))
    except ValueError:
        raise ops.PDFOperationError("Image quality must be a number between 1 and 100.")
    if not (1 <= quality <= 100):
        raise ops.PDFOperationError("Image quality must be between 1 and 100.")

    session_dir = make_session_dir()
    try:
        input_path = save_upload(files[0], session_dir, 0)
        output_path = os.path.join(session_dir, "compressed.pdf")
        ops.compress_pdf(input_path, output_path, quality)
        cleanup_later(session_dir)
        return send_file(output_path, mimetype="application/pdf",
                         as_attachment=True, download_name="compressed.pdf")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/pdf-to-images", methods=["POST"])
def api_pdf_to_images():
    files = request.files.getlist("files")
    validate_pdf_files(files, min_count=1)

    fmt = request.form.get("format", "jpg").strip().lower()
    if fmt not in ("jpg", "jpeg", "png"):
        raise ops.PDFOperationError("Format must be 'jpg' or 'png'.")

    try:
        dpi = int(request.form.get("dpi", 150))
    except ValueError:
        raise ops.PDFOperationError("DPI must be a number.")
    if not (72 <= dpi <= 300):
        raise ops.PDFOperationError("DPI must be between 72 and 300.")

    session_dir = make_session_dir()
    try:
        input_path = save_upload(files[0], session_dir, 0)
        zip_path = ops.pdf_to_images(input_path, session_dir, fmt, dpi)
        cleanup_later(session_dir)
        return send_file(zip_path, mimetype="application/zip",
                         as_attachment=True, download_name="pdf_images.zip")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


@app.route("/api/images-to-pdf", methods=["POST"])
def api_images_to_pdf():
    files = request.files.getlist("files")
    validate_image_files(files, min_count=1)

    page_size = request.form.get("page_size", "auto").strip().lower()
    if page_size not in ("auto", "a4", "letter"):
        raise ops.PDFOperationError("Page size must be 'auto', 'a4', or 'letter'.")

    session_dir = make_session_dir()
    try:
        image_paths = [save_upload(f, session_dir, i) for i, f in enumerate(files)]
        output_path = os.path.join(session_dir, "combined.pdf")
        ops.images_to_pdf(image_paths, output_path, page_size)
        cleanup_later(session_dir)
        return send_file(output_path, mimetype="application/pdf",
                         as_attachment=True, download_name="combined.pdf")
    except ops.PDFOperationError:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("PDF Tools server starting on http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
