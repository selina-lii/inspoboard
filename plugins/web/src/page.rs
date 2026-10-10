//! Saves a web page as one HTML file.
//! 1. Get the page. Read it one time to find its style sheets and images.
//! 2. Get the style sheets (and their imports), then all images and fonts, in parallel, within a size budget.
//! 3. Write the page again: files inside as data, no scripts, no frames, no event attributes, absolute links.
//!    A content security policy in the page blocks all network access when the app shows it.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use lol_html::html_content::{ContentType, Element};
use lol_html::{RewriteStrSettings, element, rewrite_str, text};
use url::Url;

use crate::css::{self, Resources};
use crate::fetch::{Fetched, Fetcher, data_url};

const MAX_HTML: usize = 15 * 1024 * 1024;
const MAX_FILE: usize = 4 * 1024 * 1024;
/// All files of one page together (before base64: the saved page is about 4/3 of this).
const BUDGET: usize = 24 * 1024 * 1024;
/// The largest saved page. The app refuses larger files.
const MAX_SAVED: usize = 55 * 1024 * 1024;
/// Image data in the page together. A page can show the same image many times: each time is a copy.
/// After this size, more images keep only their text (alt).
const MAX_INLINE_IMAGES: usize = 32 * 1024 * 1024;
/// The widest image to save: the reading view is narrower.
const MAX_IMAGE_WIDTH: f32 = 1100.0;
const WORKERS: usize = 8;
const IMPORT_DEPTH: usize = 3;

/// Elements that the saved page never has.
const REMOVED: &str = "script, noscript, iframe, frame, frameset, object, embed, applet, base, portal, picture > source, video > source, audio > source, track";

pub struct Saved {
    pub title: String,
    pub url: String,
    pub html: String,
    /// A PDF: its bytes (then `html` is empty).
    pub pdf: Option<Vec<u8>>,
}

const MAX_PDF: usize = 55 * 1024 * 1024;

type Progress<'a> = &'a (dyn Fn(usize, usize) + Sync);

pub fn save(address: &str, cancel: &AtomicBool, progress: Progress) -> Result<Saved, String> {
    let url = Url::parse(address.trim()).map_err(|_| format!("\"{address}\" is not a web address."))?;
    let fetcher = Fetcher::new(BUDGET);
    let page = fetcher.get(&url, MAX_PDF)?;
    // A PDF: the app shows it with its PDF reader.
    if page.mime == "application/pdf" || page.bytes.starts_with(b"%PDF-") {
        let name = page.url.path_segments().and_then(|mut parts| parts.next_back().map(str::to_string)).filter(|name| !name.is_empty()).unwrap_or_else(|| page.url.to_string());
        return Ok(Saved { title: name, url: page.url.to_string(), html: String::new(), pdf: Some(page.bytes) });
    }
    if !page.mime.is_empty() && !page.mime.contains("html") {
        return Err(format!("This address is not a web page: it gives \"{}\".", page.mime));
    }
    if page.bytes.len() > MAX_HTML {
        return Err("The page is larger than 15 MB.".to_string());
    }
    let html = decode(&page.bytes, page.charset.as_deref());
    let found = collect(&html, &page.url)?;
    let base = found.base.clone().unwrap_or_else(|| page.url.clone());
    let counter = Counter { done: AtomicUsize::new(0), total: AtomicUsize::new(found.sheets.len() + found.images.len()), progress };

    // Style sheets and their imports.
    let mut sheets: HashMap<String, (Url, String)> = HashMap::new();
    let mut next: Vec<Url> = unique(found.sheets.clone());
    for _ in 0..IMPORT_DEPTH {
        next.retain(|url| !sheets.contains_key(url.as_str()));
        if next.is_empty() {
            break;
        }
        let fetched = fetch_all(&fetcher, &next, cancel, &counter);
        let mut imports = Vec::new();
        for (url, result) in next.iter().zip(fetched) {
            let Some(result) = result else { continue };
            let text = String::from_utf8_lossy(&result.bytes).into_owned();
            imports.extend(css::imports(&text, &result.url));
            sheets.insert(url.to_string(), (result.url, text));
        }
        counter.total.fetch_add(imports.len(), Ordering::SeqCst);
        next = unique(imports);
    }
    check(cancel)?;

    // Images first, then the files of the styles (backgrounds, fonts).
    let mut files: Vec<Url> = found.images.clone();
    for text in &found.inline_css {
        files.extend(css::files(text, &base));
    }
    for (final_url, text) in sheets.values() {
        files.extend(css::files(text, final_url));
    }
    let files = unique(files);
    counter.total.store(counter.done.load(Ordering::SeqCst) + files.len(), Ordering::SeqCst);
    let fetched = fetch_all(&fetcher, &files, cancel, &counter);
    check(cancel)?;
    let data: HashMap<String, String> = files.iter().zip(fetched).filter_map(|(url, result)| result.map(|result| (url.to_string(), data_url(&result)))).collect();

    let html = rewrite(&html, &base, &page.url, &Resources { files: &data, sheets: &sheets })?;
    if html.len() > MAX_SAVED {
        return Err(format!("The saved page is too large ({} MB).", html.len() / 1_000_000));
    }
    let title = found.title.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(Saved { title: if title.is_empty() { page.url.to_string() } else { title }, url: page.url.to_string(), html, pdf: None })
}

fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) { Err("Cancelled.".to_string()) } else { Ok(()) }
}

fn unique(urls: Vec<Url>) -> Vec<Url> {
    let mut seen = HashSet::new();
    urls.into_iter().filter(|url| seen.insert(url.to_string())).collect()
}

struct Counter<'a> {
    done: AtomicUsize,
    total: AtomicUsize,
    progress: Progress<'a>,
}

/// Gets the files in parallel. A file that fails (or does not fit in the budget) gives None.
fn fetch_all(fetcher: &Fetcher, urls: &[Url], cancel: &AtomicBool, counter: &Counter) -> Vec<Option<Fetched>> {
    let results: Mutex<Vec<Option<Fetched>>> = Mutex::new((0..urls.len()).map(|_| None).collect());
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..WORKERS.min(urls.len()) {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    if index >= urls.len() || cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let result = if fetcher.budget_left() > 0 { fetcher.get(&urls[index], MAX_FILE).ok() } else { None };
                    if let Ok(mut slots) = results.lock() {
                        slots[index] = result;
                    }
                    let done = counter.done.fetch_add(1, Ordering::SeqCst) + 1;
                    (counter.progress)(done, counter.total.load(Ordering::SeqCst).max(done));
                }
            });
        }
    });
    results.into_inner().unwrap_or_default()
}

/// The text of the page. The charset: from the server, else from a meta tag, else UTF-8 (a BOM wins).
pub fn decode(bytes: &[u8], charset: Option<&str>) -> String {
    let label = charset.map(str::to_string).or_else(|| sniff_charset(bytes)).unwrap_or_else(|| "utf-8".to_string());
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

fn sniff_charset(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).to_ascii_lowercase();
    let at = head.find("charset=")? + "charset=".len();
    let value: String = head[at..].trim_start_matches(['"', '\'']).chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).collect();
    (!value.is_empty()).then_some(value)
}

struct Found {
    title: String,
    base: Option<Url>,
    sheets: Vec<Url>,
    images: Vec<Url>,
    inline_css: Vec<String>,
}

/// The first read: title, base address, style sheets, images, and inline styles.
fn collect(html: &str, page_url: &Url) -> Result<Found, String> {
    let title = RefCell::new(String::new());
    let title_done = Cell::new(false);
    let base: RefCell<Option<Url>> = RefCell::new(None);
    let sheets = RefCell::new(Vec::new());
    let images = RefCell::new(Vec::new());
    let inline_css = RefCell::new(Vec::new());
    let style = RefCell::new(String::new());
    let current_base = || base.borrow().clone().unwrap_or_else(|| page_url.clone());
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!("base[href]", |el| {
                    if base.borrow().is_none() {
                        *base.borrow_mut() = el.get_attribute("href").and_then(|href| page_url.join(&href).ok());
                    }
                    Ok(())
                }),
                // Only the page title: SVG images also have <title> elements.
                text!("head > title", |chunk| {
                    if !title_done.get() {
                        title.borrow_mut().push_str(chunk.as_str());
                        if chunk.last_in_text_node() {
                            title_done.set(true);
                        }
                    }
                    Ok(())
                }),
                element!("link[href]", |el| {
                    if is_stylesheet(el)
                        && let Some(url) = absolute(&current_base(), &el.get_attribute("href").unwrap_or_default())
                    {
                        sheets.borrow_mut().push(url);
                    }
                    Ok(())
                }),
                element!("img, video[poster], input[type=image]", |el| {
                    let found = if el.tag_name() == "video" { el.get_attribute("poster").and_then(|poster| absolute(&current_base(), &poster)) } else { image_source(el, &current_base()) };
                    images.borrow_mut().extend(found);
                    Ok(())
                }),
                element!("[style]", |el| {
                    inline_css.borrow_mut().push(el.get_attribute("style").unwrap_or_default());
                    Ok(())
                }),
                text!("style", |chunk| {
                    style.borrow_mut().push_str(chunk.as_str());
                    if chunk.last_in_text_node() {
                        inline_css.borrow_mut().push(std::mem::take(&mut *style.borrow_mut()));
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|error| format!("The page could not be read: {error}"))?;
    Ok(Found { title: title.into_inner(), base: base.into_inner(), sheets: sheets.into_inner(), images: images.into_inner(), inline_css: inline_css.into_inner() })
}

/// The second read: writes the page for offline reading.
fn rewrite(html: &str, base: &Url, page_url: &Url, resources: &Resources) -> Result<String, String> {
    let style = RefCell::new(String::new());
    let has_head = Cell::new(false);
    let inlined = Cell::new(0usize);
    // An image as data, if the budget for image copies allows it.
    let image_data = |url: Option<Url>| -> Option<String> {
        let data = resources.files.get(url?.as_str())?;
        if inlined.get() + data.len() > MAX_INLINE_IMAGES {
            return None;
        }
        inlined.set(inlined.get() + data.len());
        Some(data.clone())
    };
    let head = head_tags(page_url);
    let sheet_html = |url: &Url| -> String {
        match resources.sheets.get(url.as_str()) {
            Some((final_url, text)) => format!("<style>{}</style>", safe_style(&css::inline(text, final_url, resources, &mut HashSet::new()))),
            None => String::new(),
        }
    };
    let output = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!(REMOVED, |el| {
                    el.remove();
                    Ok(())
                }),
                element!("meta", |el| {
                    if el.has_attribute("charset") || el.has_attribute("http-equiv") {
                        el.remove();
                    }
                    Ok(())
                }),
                element!("link", |el| {
                    let sheet = if is_stylesheet(el) { absolute(base, &el.get_attribute("href").unwrap_or_default()) } else { None };
                    match sheet {
                        Some(url) => el.replace(&sheet_html(&url), ContentType::Html),
                        None => el.remove(),
                    }
                    Ok(())
                }),
                element!("*", |el| {
                    let names: Vec<String> = el.attributes().iter().map(|attribute| attribute.name()).collect();
                    for name in names {
                        if name.starts_with("on") || matches!(name.as_str(), "integrity" | "nonce" | "srcdoc" | "ping" | "formaction") {
                            el.remove_attribute(&name);
                        }
                    }
                    if let Some(value) = el.get_attribute("style") {
                        let _ = el.set_attribute("style", &css::inline(&value, base, resources, &mut HashSet::new()));
                    }
                    Ok(())
                }),
                element!("img, input[type=image]", |el| {
                    let source = image_data(image_source(el, base));
                    for name in ["src", "srcset", "sizes", "loading", "decoding", "data-src", "data-srcset", "data-lazy-src", "data-original"] {
                        el.remove_attribute(name);
                    }
                    if let Some(data) = source {
                        let _ = el.set_attribute("src", &data);
                        // Lazy-load scripts show an image when they mark it loaded. The saved page has no scripts:
                        // mark it loaded here (else a style such as ".lazyload { display: none }" hides it).
                        if let Some(class) = el.get_attribute("class") {
                            let _ = el.set_attribute("class", &loaded_classes(&class));
                        }
                    }
                    Ok(())
                }),
                element!("video, audio", |el| {
                    el.remove_attribute("src");
                    let poster = image_data(el.get_attribute("poster").and_then(|poster| absolute(base, &poster)));
                    el.remove_attribute("poster");
                    if let Some(data) = poster {
                        let _ = el.set_attribute("poster", &data);
                    }
                    Ok(())
                }),
                element!("a[href], area[href]", |el| {
                    let href = el.get_attribute("href").unwrap_or_default();
                    if href.trim_start().to_ascii_lowercase().starts_with("javascript:") {
                        el.remove_attribute("href");
                    } else if !href.starts_with('#')
                        && let Ok(url) = base.join(&href)
                    {
                        let _ = el.set_attribute("href", url.as_str());
                    }
                    el.remove_attribute("target");
                    Ok(())
                }),
                element!("form", |el| {
                    el.remove_attribute("action");
                    Ok(())
                }),
                element!("head", |el| {
                    has_head.set(true);
                    el.prepend(&head, ContentType::Html);
                    Ok(())
                }),
                text!("style", |chunk| {
                    style.borrow_mut().push_str(chunk.as_str());
                    if chunk.last_in_text_node() {
                        let text = std::mem::take(&mut *style.borrow_mut());
                        chunk.replace(&safe_style(&css::inline(&text, base, resources, &mut HashSet::new())), ContentType::Html);
                    } else {
                        chunk.remove();
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|error| format!("The page could not be written: {error}"))?;
    Ok(if has_head.get() { output } else { format!("{head}{output}") })
}

/// Tags at the start of the saved page: UTF-8, no network access, and the source address.
fn head_tags(page_url: &Url) -> String {
    let source = page_url.as_str().replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    let saved = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0);
    format!(
        "<meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:\"><meta name=\"inspoboard-source\" content=\"{source}\"><meta name=\"inspoboard-saved\" content=\"{saved}\">"
    )
}

/// CSS inside a <style> element must not end the element.
fn safe_style(css: &str) -> String {
    css.replace("</style", "<\\/style").replace("</STYLE", "<\\/STYLE")
}

fn is_stylesheet(el: &Element) -> bool {
    el.get_attribute("rel").is_some_and(|rel| rel.split_whitespace().any(|part| part.eq_ignore_ascii_case("stylesheet")))
}

fn absolute(base: &Url, reference: &str) -> Option<Url> {
    let reference = reference.trim();
    if reference.is_empty() || reference.starts_with("data:") {
        return None;
    }
    base.join(reference).ok().filter(|url| matches!(url.scheme(), "http" | "https"))
}

/// Classes that lazy-load scripts use before an image loads. They are replaced with "lazyloaded".
const LAZY_CLASSES: [&str; 7] = ["lazyload", "lazyloading", "lazy", "lazy-load", "js-lazy", "b-lazy", "lozad"];

/// The class list of a saved image: without lazy-load classes, and with "lazyloaded" if it had one.
pub fn loaded_classes(class: &str) -> String {
    let mut lazy = false;
    let mut kept: Vec<&str> = class
        .split_whitespace()
        .filter(|name| {
            let found = LAZY_CLASSES.contains(&name.to_ascii_lowercase().as_str());
            lazy |= found;
            !found
        })
        .collect();
    if lazy && !kept.contains(&"lazyloaded") {
        kept.push("lazyloaded");
    }
    kept.join(" ")
}

/// The image to save for an <img>: a lazy-load source, the best srcset entry, or src.
fn image_source(el: &Element, base: &Url) -> Option<Url> {
    let src = el.get_attribute("src").unwrap_or_default();
    // Lazy-load pages keep the real address in a data attribute and a small placeholder in src.
    let placeholder = src.trim().is_empty() || src.starts_with("data:");
    let lazy = ["data-src", "data-lazy-src", "data-original"].iter().find_map(|name| el.get_attribute(name)).filter(|value| !value.trim().is_empty());
    let srcset = el.get_attribute("srcset").or_else(|| el.get_attribute("data-srcset")).and_then(|value| best_candidate(&value));
    let choice = if placeholder { lazy.or(srcset).unwrap_or(src) } else { srcset.unwrap_or(src) };
    absolute(base, &choice)
}

/// The best entry of a srcset: the widest up to MAX_IMAGE_WIDTH (else the smallest), or 2x density at most.
pub fn best_candidate(srcset: &str) -> Option<String> {
    let mut entries: Vec<(String, f32, bool)> = Vec::new();
    for part in srcset.split(", ").flat_map(|part| part.split(",\n")) {
        let mut words = part.split_whitespace();
        let Some(url) = words.next() else { continue };
        if url.starts_with("data:") {
            continue;
        }
        let descriptor = words.next().unwrap_or("1x");
        let (number, is_width) = match descriptor.strip_suffix('w') {
            Some(width) => (width.parse().unwrap_or(0.0), true),
            None => (descriptor.trim_end_matches('x').parse().unwrap_or(1.0), false),
        };
        entries.push((url.trim_end_matches(',').to_string(), number, is_width));
    }
    let fits = entries.iter().filter(|entry| if entry.2 { entry.1 <= MAX_IMAGE_WIDTH } else { entry.1 <= 2.0 }).max_by(|a, b| a.1.total_cmp(&b.1));
    fits.or_else(|| entries.iter().min_by(|a, b| a.1.total_cmp(&b.1))).map(|entry| entry.0.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resources<'a>(files: &'a HashMap<String, String>, sheets: &'a HashMap<String, (Url, String)>) -> Resources<'a> {
        Resources { files, sheets }
    }

    #[test]
    fn marks_lazy_images_loaded() {
        assert_eq!(loaded_classes("highwire-fragment fragment-image lazyload"), "highwire-fragment fragment-image lazyloaded");
        assert_eq!(loaded_classes("photo"), "photo");
        assert_eq!(loaded_classes("Lazy lazyloaded"), "lazyloaded");
    }

    #[test]
    fn picks_srcset_entries() {
        assert_eq!(best_candidate("a.jpg 400w, b.jpg 1000w, c.jpg 2400w").as_deref(), Some("b.jpg"));
        assert_eq!(best_candidate("a.jpg 1x, b.jpg 2x").as_deref(), Some("b.jpg"));
        assert_eq!(best_candidate("c.jpg 2400w, d.jpg 3000w").as_deref(), Some("c.jpg"));
    }

    #[test]
    fn decodes_other_charsets() {
        let (bytes, _, _) = encoding_rs::GBK.encode("<meta charset=\"gbk\"><p>你好</p>");
        assert!(decode(&bytes, None).contains("你好"));
        assert!(decode("é".as_bytes(), Some("utf-8")).contains('é'));
    }

    #[test]
    fn finds_files_and_writes_a_safe_page() {
        let page = Url::parse("https://a.example/post/1").unwrap();
        let html = r#"<html><head><title> A  page </title><meta charset="x"><link rel="stylesheet" href="/s.css"><link rel="icon" href="/i.png"><script>alert(1)</script></head>
<body onload="x()"><img src="data:," data-src="/big.png" alt="A"><a href="/next" target="_blank" onclick="y()">Next</a><a href="javascript:z()">Z</a>
<iframe src="https://ads.example"></iframe><p style="background:url(/bg.png)">Text</p><style>p{color:red}</style></body></html>"#;
        let found = collect(html, &page).unwrap();
        assert_eq!(found.title.trim(), "A  page");
        assert_eq!(found.sheets.iter().map(Url::as_str).collect::<Vec<_>>(), vec!["https://a.example/s.css"]);
        assert_eq!(found.images.iter().map(Url::as_str).collect::<Vec<_>>(), vec!["https://a.example/big.png"]);
        let files = HashMap::from([
            ("https://a.example/big.png".to_string(), "data:image/png;base64,QQ==".to_string()),
            ("https://a.example/bg.png".to_string(), "data:image/png;base64,Qg==".to_string()),
        ]);
        let sheets = HashMap::from([("https://a.example/s.css".to_string(), (Url::parse("https://a.example/s.css").unwrap(), "h1{font-weight:700}".to_string()))]);
        let out = rewrite(html, &page, &page, &resources(&files, &sheets)).unwrap();
        assert!(!out.contains("<script") && !out.contains("alert") && !out.contains("<iframe"));
        assert!(!out.contains("onload") && !out.contains("onclick") && !out.contains("javascript:") && !out.contains("target="));
        assert!(out.contains("<style>h1{font-weight:700}</style>"));
        assert!(!out.contains("i.png"));
        assert!(out.contains(r#"src="data:image/png;base64,QQ==""#));
        assert!(out.contains(r#"href="https://a.example/next""#));
        assert!(out.contains("url(&quot;data:image/png;base64,Qg==&quot;)") || out.contains("url(\"data:image/png;base64,Qg==\")"));
        assert!(out.contains("Content-Security-Policy") && !out.contains("charset=\"x\""));
        assert!(out.contains("<style>p{color:red}</style>"));
    }
}
