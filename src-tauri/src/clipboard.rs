//! Images on the system clipboard. The WebView does not always give a pasted image to the page (WebKit hides some
//! clipboard types, and a file copied in Finder comes only as its name), so the backend reads the clipboard itself.

use std::path::PathBuf;

/// An image on the clipboard.
pub enum ClipImage {
    /// An image file (copied in Finder).
    File(PathBuf),
    /// Image bytes (a screenshot, an image copied from an app or a web page), with their file extension.
    Bytes(Vec<u8>, &'static str),
}

/// The images on the clipboard, in order. Empty if there are none (or on systems other than macOS, for now).
#[cfg(target_os = "macos")]
pub fn images() -> Vec<ClipImage> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardTypeTIFF};
    use objc2_foundation::{NSString, NSURL};

    let jpeg = NSString::from_str("public.jpeg");
    let mut found = Vec::new();
    let Some(items) = NSPasteboard::generalPasteboard().pasteboardItems() else { return found };
    for item in items.iter() {
        // A copied file: its path (Finder gives a file reference URL; `filePathURL` makes it a normal path).
        if let Some(text) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
            let path = NSURL::URLWithString(&text).and_then(|url| url.filePathURL()).and_then(|url| url.path());
            if let Some(path) = path {
                found.push(ClipImage::File(PathBuf::from(path.to_string())));
            }
            continue;
        }
        let kinds: [(&NSString, &'static str); 3] = [(unsafe { NSPasteboardTypePNG }, "png"), (&jpeg, "jpg"), (unsafe { NSPasteboardTypeTIFF }, "tiff")];
        if let Some((data, extension)) = kinds.iter().find_map(|(kind, extension)| item.dataForType(kind).map(|data| (data, *extension))) {
            found.push(ClipImage::Bytes(data.to_vec(), extension));
        }
    }
    found
}

#[cfg(not(target_os = "macos"))]
pub fn images() -> Vec<ClipImage> {
    Vec::new()
}

/// TIFF bytes (the macOS clipboard type of many images) as PNG bytes. A text holds only PNG, JPEG, GIF, or WebP.
pub fn tiff_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Tiff).map_err(|error| format!("The image could not be read: {error}"))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).map_err(|error| format!("The image could not be converted: {error}"))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiff_becomes_png() {
        let mut tiff = std::io::Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255])).write_to(&mut tiff, image::ImageFormat::Tiff).unwrap();
        let png = tiff_to_png(tiff.get_ref()).unwrap();
        let back = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        assert_eq!((back.width(), back.height()), (3, 2));
        assert!(tiff_to_png(b"not an image").is_err());
    }
}
