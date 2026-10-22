//! "media_info": the title, the artist, the cover, the kind, and the length of a media link (a song, an album, a
//! video, a playlist). Only for the link that the user asks about, on a click in the app. No login, no key.
//!
//! It reads public data that sites put in their pages for link previews, the same for all sites (no site rules):
//! - Open Graph and Twitter tags (`og:title`, `og:image`, `og:type`, `music:musician_description`, durations);
//! - the oEmbed link of the page (`<link type="application/json+oembed">`): `title`, `author_name`, `thumbnail_url`.
//!   A page with no preview tags and no oEmbed link: the usual oEmbed place of its site, "/oembed?url=<link>".
//!
//! The cover comes back as bytes (base64) with its type. The app saves it in the vault: the card works offline.

use base64::Engine as _;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::LazyLock;
use url::Url;

use crate::fetch::Fetcher;
use crate::page::decode;

const PAGE_LIMIT: usize = 4 * 1024 * 1024;
const JSON_LIMIT: usize = 512 * 1024;
const COVER_LIMIT: usize = 12 * 1024 * 1024;
/// Cover types that the vault can hold.
const COVER_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<(meta|link)\b([^>]*)>").unwrap());
static ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#).unwrap());
static TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap());

/// What the page says about itself.
#[derive(Debug, Default, PartialEq)]
pub struct PageMedia {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub image: Option<Url>,
    pub kind: Option<&'static str>,
    pub duration: Option<u64>,
    pub oembed: Option<Url>,
}

/// Reads the preview tags of a page.
pub fn read_page(html: &str, base: &Url) -> PageMedia {
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut oembed = None;
    for tag in TAG.captures_iter(html) {
        let attributes: HashMap<String, String> = ATTRIBUTE
            .captures_iter(&tag[2])
            .map(|attribute| {
                let value = attribute.get(2).or(attribute.get(3)).or(attribute.get(4)).map_or("", |m| m.as_str());
                (attribute[1].to_ascii_lowercase(), unescape(value))
            })
            .collect();
        if tag[1].eq_ignore_ascii_case("meta") {
            let key = attributes.get("property").or(attributes.get("name")).map(|key| key.to_ascii_lowercase());
            if let (Some(key), Some(content)) = (key, attributes.get("content")) {
                if !content.trim().is_empty() {
                    meta.entry(key).or_insert_with(|| content.trim().to_string());
                }
            }
        } else if oembed.is_none()
            && attributes.get("type").is_some_and(|kind| kind.eq_ignore_ascii_case("application/json+oembed"))
            && let Some(href) = attributes.get("href")
        {
            oembed = base.join(href).ok();
        }
    }
    let first = |keys: &[&str]| keys.iter().find_map(|key| meta.get(*key).cloned());
    let og_type = meta.get("og:type").map(|kind| kind.to_ascii_lowercase()).unwrap_or_default();
    let kind = if og_type.starts_with("music") {
        Some("audio")
    } else if og_type.starts_with("video") || meta.contains_key("og:video") || meta.contains_key("og:video:url") {
        Some("video")
    } else {
        None
    };
    PageMedia {
        title: first(&["og:title", "twitter:title"]).or_else(|| TITLE.captures(html).map(|title| unescape(title[1].trim())).filter(|title| !title.is_empty())),
        artist: first(&["music:musician_description", "twitter:audio:artist_name", "music:creator", "author"]),
        image: first(&["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]).and_then(|image| base.join(&image).ok()),
        kind,
        duration: first(&["music:duration", "video:duration", "og:video:duration"]).and_then(|value| value.parse::<f64>().ok()).filter(|value| value.is_finite() && *value >= 0.0).map(|value| value.round() as u64),
        oembed,
    }
}

/// The answer of "media_info".
pub fn media_info(address: &str) -> Result<Value, String> {
    let url = Url::parse(address.trim()).map_err(|_| format!("This is not a web address: {address}"))?;
    let fetcher = Fetcher::new(PAGE_LIMIT + JSON_LIMIT + COVER_LIMIT);
    let page = fetcher.get(&url, PAGE_LIMIT)?;
    let html = decode(&page.bytes, page.charset.as_deref());
    let found = read_page(&html, &page.url);

    // oEmbed: the site's own short description of the item. Its title and author are often cleaner.
    // No oEmbed link in the page (some sites send a page shell to programs): the usual place "/oembed?url=…" of the
    // same site. A site without it answers with an error, and nothing changes.
    let guessed = || {
        let mut link = page.url.join("/oembed").ok()?;
        link.query_pairs_mut().append_pair("url", url.as_str()).append_pair("format", "json");
        Some(link)
    };
    let link = found.oembed.clone().or_else(|| if found.image.is_none() { guessed() } else { None });
    let embed = link.and_then(|link| fetcher.get(&link, JSON_LIMIT).ok()).and_then(|reply| serde_json::from_slice::<Value>(&reply.bytes).ok()).unwrap_or(Value::Null);
    let text = |key: &str| embed.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string);
    let title = text("title").or(found.title);
    let artist = found.artist.or_else(|| text("author_name"));
    let image = found.image.or_else(|| text("thumbnail_url").and_then(|link| page.url.join(&link).ok()));

    let mut result = json!({});
    if let Some(title) = title {
        result["title"] = json!(title);
    }
    if let Some(artist) = artist {
        result["artist"] = json!(artist);
    }
    if let Some(kind) = found.kind {
        result["kind"] = json!(kind);
    }
    if let Some(duration) = found.duration {
        result["duration"] = json!(duration);
    }
    if let Some(image) = image
        && let Ok(cover) = fetcher.get(&image, COVER_LIMIT)
        && COVER_TYPES.contains(&cover.mime.as_str())
    {
        result["cover"] = json!(base64::engine::general_purpose::STANDARD.encode(&cover.bytes));
        result["coverType"] = json!(cover.mime);
    }
    Ok(result)
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_graph_and_oembed_tags() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Blue in Green">
            <meta property="og:type" content="music.song">
            <meta name="music:musician_description" content="Miles Davis">
            <meta property="og:image" content="/covers/kind-of-blue.jpg">
            <meta property="music:duration" content="337">
            <link rel="alternate" type="application/json+oembed" href="https://example.org/oembed?url=x&amp;format=json">
            </head></html>"#;
        let page = read_page(html, &Url::parse("https://music.example.org/song/1").unwrap());
        assert_eq!(page.title.as_deref(), Some("Blue in Green"));
        assert_eq!(page.artist.as_deref(), Some("Miles Davis"));
        assert_eq!(page.kind, Some("audio"));
        assert_eq!(page.duration, Some(337));
        assert_eq!(page.image.unwrap().as_str(), "https://music.example.org/covers/kind-of-blue.jpg");
        assert_eq!(page.oembed.unwrap().as_str(), "https://example.org/oembed?url=x&format=json");
    }

    #[test]
    fn falls_back_to_the_page_title_and_finds_videos() {
        let html = "<title>A &amp; B</title><meta content='https://v.example/1.mp4' property='og:video'>";
        let page = read_page(html, &Url::parse("https://v.example/watch").unwrap());
        assert_eq!(page.title.as_deref(), Some("A & B"));
        assert_eq!(page.kind, Some("video"));
        assert_eq!(page.artist, None);
    }
}
