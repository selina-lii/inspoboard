//! PDF pages drawn by PDFium (SPEC 7.8): the reader shows each page as an image from the URI scheme `pdfpage`, so
//! the drawing runs here, on one thread of its own, not on the main thread of the window. pdf.js (in the window)
//! still makes the text layer: selection, find, highlights, and read aloud do not change.
//! - `pdfpage://localhost/<key>/<page>?w=<pixels>[&crop=<left>,<top>,<width>,<height>]` (Windows:
//!   `http://pdfpage.localhost/...`): page 1, 2, … of `web/<key>.pdf` of the open vault, `w` pixels wide, as PNG.
//!   `crop`: a part of the page in page units (PDF points from the top left), for the formula plugin.
//! - PDFium is not thread-safe: one render thread owns it. The newest request is done first (when the user scrolls,
//!   the pages in view now come first). The last OPEN_DOCUMENTS PDFs stay open; the last page image stays for crops.
//! - The library is a resource of the app (scripts/fetch-pdfium.mjs). Without it the scheme answers 503 and the
//!   reader draws with pdf.js.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock, mpsc};
use std::time::Instant;

use image::DynamicImage;
use pdfium_render::prelude::*;

const OPEN_DOCUMENTS: usize = 3;
const MAX_WIDTH: u32 = 6000;

/// A part of a page in page units (PDF points), from the top left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

struct Request {
    file: PathBuf,
    /// 0-based.
    page: u16,
    width: u32,
    crop: Option<Crop>,
    reply: mpsc::Sender<Result<Vec<u8>, String>>,
}

#[derive(Default)]
struct Queue {
    requests: Mutex<Vec<Request>>,
    ready: Condvar,
}

/// The render thread (started at the first request), or None if the PDFium library is missing.
fn queue() -> Option<&'static Arc<Queue>> {
    static QUEUE: OnceLock<Option<Arc<Queue>>> = OnceLock::new();
    QUEUE
        .get_or_init(|| {
            let folder = LIBRARY_FOLDER.get()?.clone();
            let queue = Arc::new(Queue::default());
            let worker = queue.clone();
            // The thread loads the library itself (the bindings stay on that thread), then tells if it could.
            let (loaded, started) = mpsc::channel();
            std::thread::Builder::new()
                .name("pdfium".into())
                .spawn(move || match Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&folder)) {
                    Ok(bindings) => {
                        let _ = loaded.send(true);
                        run(Box::leak(Box::new(Pdfium::new(bindings))), &worker);
                    }
                    Err(error) => {
                        crate::debug_log::write("pdf", &format!("PDFium could not load from {}: {error}. PDFs draw with pdf.js.", folder.display()));
                        let _ = loaded.send(false);
                    }
                })
                .ok()?;
            started.recv().unwrap_or(false).then_some(queue)
        })
        .as_ref()
}

static LIBRARY_FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// The folder of the PDFium library: the app resources, or (a development build) src-tauri/pdfium.
pub fn set_library_folder(resources: Option<PathBuf>) {
    let candidates = resources.into_iter().map(|folder| folder.join("pdfium")).chain(std::iter::once(Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium")));
    for folder in candidates {
        if Pdfium::pdfium_platform_library_name_at_path(&folder).is_file() {
            let _ = LIBRARY_FOLDER.set(folder);
            return;
        }
    }
}

/// A page as PNG (waits for the render thread). Err: no PDFium, or the page could not be drawn.
pub fn render(file: PathBuf, page: u16, width: u32, crop: Option<Crop>) -> Result<Vec<u8>, String> {
    let queue = queue().ok_or_else(|| "PDFium is not available.".to_string())?;
    let (reply, answer) = mpsc::channel();
    queue.requests.lock().map_err(|_| "Internal lock error.")?.push(Request { file, page, width: width.clamp(16, MAX_WIDTH), crop, reply });
    queue.ready.notify_one();
    answer.recv().map_err(|_| "The PDF render thread stopped.".to_string())?
}

fn run(pdfium: &'static Pdfium, queue: &Queue) {
    let mut documents: VecDeque<(PathBuf, PdfDocument<'static>)> = VecDeque::new();
    // The last page image (file, page, width): crops of one page use it.
    let mut last: Option<((PathBuf, u16, u32), DynamicImage)> = None;
    loop {
        let request = {
            let Ok(mut requests) = queue.requests.lock() else { return };
            while requests.is_empty() {
                requests = match queue.ready.wait(requests) {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
            }
            // The newest first.
            requests.pop().expect("not empty")
        };
        let started = Instant::now();
        let key = (request.file.clone(), request.page, request.width);
        let result = (|| -> Result<Vec<u8>, String> {
            let image = match &last {
                Some((known, image)) if *known == key => image.clone(),
                _ => {
                    let image = draw(pdfium, &mut documents, &request.file, request.page, request.width)?;
                    last = Some((key.clone(), image.clone()));
                    image
                }
            };
            let part = match request.crop {
                Some(crop) => cut(&image, request.width, page_width(&mut documents, &request.file, request.page)?, crop),
                None => image,
            };
            png(&part)
        })();
        let ms = started.elapsed().as_millis();
        match &result {
            Err(error) => crate::debug_log::write("pdf", &format!("Page {} of {} could not be drawn: {error}", request.page + 1, request.file.display())),
            Ok(_) if ms >= 150 => crate::debug_log::write("pdf", &format!("PDFium drew page {} in {ms} ms ({} px)", request.page + 1, request.width)),
            Ok(_) => {}
        }
        let _ = request.reply.send(result);
    }
}

fn open<'a>(pdfium: &'static Pdfium, documents: &'a mut VecDeque<(PathBuf, PdfDocument<'static>)>, file: &Path) -> Result<&'a PdfDocument<'static>, String> {
    if let Some(at) = documents.iter().position(|(path, _)| path == file) {
        let entry = documents.remove(at).expect("present");
        documents.push_back(entry);
    } else {
        let document = pdfium.load_pdf_from_file(file, None).map_err(|error| format!("{error}"))?;
        documents.push_back((file.to_path_buf(), document));
        while documents.len() > OPEN_DOCUMENTS {
            documents.pop_front();
        }
    }
    Ok(&documents.back().expect("just added").1)
}

fn draw(pdfium: &'static Pdfium, documents: &mut VecDeque<(PathBuf, PdfDocument<'static>)>, file: &Path, page: u16, width: u32) -> Result<DynamicImage, String> {
    let document = open(pdfium, documents, file)?;
    let page = document.pages().get(page).map_err(|error| format!("{error}"))?;
    // A white page under the drawing (a PDF page can be transparent), as pdf.js draws it.
    let config = PdfRenderConfig::new().set_target_width(width as Pixels).set_clear_color(PdfColor::WHITE);
    let bitmap = page.render_with_config(&config).map_err(|error| format!("{error}"))?;
    Ok(bitmap.as_image())
}

fn page_width(documents: &mut VecDeque<(PathBuf, PdfDocument<'static>)>, file: &Path, page: u16) -> Result<f32, String> {
    let (_, document) = documents.iter().find(|(path, _)| path == file).ok_or("The PDF is not open.")?;
    Ok(document.pages().get(page).map_err(|error| format!("{error}"))?.width().value)
}

/// A part of a page image. `width`: the image width in pixels; `page_width`: the page width in page units.
fn cut(image: &DynamicImage, width: u32, page_width: f32, crop: Crop) -> DynamicImage {
    let scale = width as f32 / page_width.max(1.0);
    let left = ((crop.left * scale).floor().max(0.0) as u32).min(image.width().saturating_sub(1));
    let top = ((crop.top * scale).floor().max(0.0) as u32).min(image.height().saturating_sub(1));
    let w = ((crop.width * scale).ceil() as u32).clamp(1, image.width() - left);
    let h = ((crop.height * scale).ceil() as u32).clamp(1, image.height() - top);
    image.crop_imm(left, top, w, h)
}

fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = std::io::Cursor::new(Vec::new());
    image.to_rgb8().write_to(&mut out, image::ImageFormat::Png).map_err(|error| error.to_string())?;
    Ok(out.into_inner())
}

/// The parts of a `pdfpage` address: (key, page 1-based, width, crop). None if it is not one.
pub fn parse(path: &str, query: Option<&str>) -> Option<(String, u16, u32, Option<Crop>)> {
    let mut parts = path.trim_start_matches('/').split('/');
    let key = parts.next()?.to_string();
    let page: u16 = parts.next()?.parse().ok().filter(|page| *page >= 1)?;
    if parts.next().is_some() {
        return None;
    }
    let mut width = None;
    let mut crop = None;
    for pair in query.unwrap_or("").split('&') {
        match pair.split_once('=') {
            Some(("w", value)) => width = value.parse::<u32>().ok(),
            Some(("crop", value)) => {
                let numbers: Vec<f32> = value.split(',').filter_map(|number| number.parse().ok()).collect();
                if let [left, top, width, height] = numbers[..] {
                    crop = Some(Crop { left, top, width, height });
                }
            }
            _ => {}
        }
    }
    Some((key, page, width?, crop))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_page_addresses() {
        assert_eq!(parse("/a1b2c3d4e5f6/3", Some("w=1224")), Some(("a1b2c3d4e5f6".to_string(), 3, 1224, None)));
        assert_eq!(
            parse("/a1b2c3d4e5f6/1", Some("w=1536&crop=10,20.5,30,40")),
            Some(("a1b2c3d4e5f6".to_string(), 1, 1536, Some(Crop { left: 10.0, top: 20.5, width: 30.0, height: 40.0 })))
        );
        assert_eq!(parse("/a1b2c3d4e5f6/0", Some("w=10")), None);
        assert_eq!(parse("/a1b2c3d4e5f6/2/x", Some("w=10")), None);
        assert_eq!(parse("/a1b2c3d4e5f6/2", None), None);
    }

    #[test]
    fn cuts_a_part_in_page_units() {
        let image = DynamicImage::new_rgb8(200, 100);
        // The page is 100 units wide, the image 200 pixels: a factor of 2.
        let part = cut(&image, 200, 100.0, Crop { left: 10.0, top: 5.0, width: 20.0, height: 10.0 });
        assert_eq!((part.width(), part.height()), (40, 20));
        // A part out of the image is kept inside it.
        let edge = cut(&image, 200, 100.0, Crop { left: 95.0, top: 45.0, width: 20.0, height: 20.0 });
        assert_eq!((edge.width(), edge.height()), (10, 10));
    }

    /// Draws a real PDF with the library of src-tauri/pdfium (skipped if it is not there).
    #[test]
    fn draws_a_page_with_the_library() {
        set_library_folder(None);
        if LIBRARY_FOLDER.get().is_none() {
            return;
        }
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("one.pdf");
        std::fs::write(&file, ONE_PAGE_PDF).unwrap();
        let bytes = render(file.clone(), 0, 300, None).unwrap();
        let image = image::load_from_memory(&bytes).unwrap();
        assert_eq!(image.width(), 300);
        assert_eq!(image.height(), 150);
        let part = image::load_from_memory(&render(file, 0, 300, Some(Crop { left: 0.0, top: 0.0, width: 100.0, height: 50.0 })).unwrap()).unwrap();
        assert_eq!((part.width(), part.height()), (150, 75));
        assert!(render(folder.path().join("missing.pdf"), 0, 300, None).is_err());
    }

    /// A one-page PDF, 200 × 100 points, with no content.
    const ONE_PAGE_PDF: &[u8] = b"%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj
trailer << /Root 1 0 R >>
%%EOF";
}
