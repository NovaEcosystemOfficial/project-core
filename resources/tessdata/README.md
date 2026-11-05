# Tesseract language data (DDT OCR)

Place `ita.traineddata` in this folder for Italian OCR offline.

Download (Apache 2.0) from the official tessdata repository, for example:

- https://github.com/tesseract-ocr/tessdata/raw/main/ita.traineddata

Without this file, ProjectCore still imports DDT files and extracts native PDF text.
Image OCR and scanned-PDF OCR are skipped with a clear Italian error message — they never invent results or register stock automatically.

For packaged Electron builds, ship this folder under `resources/tessdata` (or `process.resourcesPath/tessdata`).
Optional: install the native `canvas` package if you need OCR on scanned multi-page PDFs (page rasterization). Textual PDFs and images do not require `canvas`.
