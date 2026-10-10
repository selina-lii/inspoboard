//! HTTP(S) downloads with limits: a time limit, a size limit for each file, and a size budget for a page.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine as _;
use url::Url;

/// A desktop browser name: some sites send no content to unknown programs.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

pub struct Fetched {
    pub bytes: Vec<u8>,
    /// The media type without parameters, for example "image/png".
    pub mime: String,
    /// The charset parameter of the content type, if any.
    pub charset: Option<String>,
    /// The address after redirects.
    pub url: Url,
}

pub struct Fetcher {
    agent: ureq::Agent,
    /// Bytes that the page can still get for its files.
    budget: AtomicUsize,
}

impl Fetcher {
    pub fn new(budget: usize) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(40)))
            .user_agent(USER_AGENT)
            .build();
        Fetcher { agent: config.into(), budget: AtomicUsize::new(budget) }
    }

    /// Gets one file. Only http and https. `limit`: the largest size for this file.
    pub fn get(&self, url: &Url, limit: usize) -> Result<Fetched, String> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err(format!("Only http and https addresses: {url}"));
        }
        let mut response = self.agent.get(url.as_str()).call().map_err(|error| match error {
            ureq::Error::StatusCode(403 | 401) => format!("The site refused to send the page (error 403). Some sites send pages only to browsers: {url}"),
            ureq::Error::StatusCode(404) => format!("The page does not exist (error 404): {url}"),
            ureq::Error::StatusCode(code) => format!("The site answered with error {code}: {url}"),
            other => format!("{url}: {other}"),
        })?;
        let final_url = Url::parse(&ureq::ResponseExt::get_uri(&response).to_string()).unwrap_or_else(|_| url.clone());
        let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or("").to_string();
        let limit = limit.min(self.budget.load(Ordering::SeqCst));
        let bytes = response
            .body_mut()
            .with_config()
            .limit(limit as u64)
            .read_to_vec()
            .map_err(|error| format!("{url}: {error}"))?;
        // The budget can go below zero by a few parallel files. That is acceptable.
        let mut left = self.budget.load(Ordering::SeqCst);
        while let Err(now) = self.budget.compare_exchange(left, left.saturating_sub(bytes.len()), Ordering::SeqCst, Ordering::SeqCst) {
            left = now;
        }
        let (mime, charset) = parse_content_type(&content_type);
        Ok(Fetched { bytes, mime, charset, url: final_url })
    }

    pub fn budget_left(&self) -> usize {
        self.budget.load(Ordering::SeqCst)
    }
}

/// "text/html; charset=UTF-8" → ("text/html", Some("utf-8")).
pub fn parse_content_type(value: &str) -> (String, Option<String>) {
    let mut parts = value.split(';');
    let mime = parts.next().unwrap_or("").trim().to_ascii_lowercase();
    let charset = parts
        .filter_map(|part| part.trim().split_once('='))
        .find(|(key, _)| key.trim().eq_ignore_ascii_case("charset"))
        .map(|(_, value)| value.trim().trim_matches('"').to_ascii_lowercase());
    (mime, charset)
}

/// A data URL for file content. The media type comes from the server, or from the file name.
pub fn data_url(fetched: &Fetched) -> String {
    let mime = if fetched.mime.is_empty() || fetched.mime == "application/octet-stream" || fetched.mime == "binary/octet-stream" {
        guess_mime(fetched.url.path())
    } else {
        fetched.mime.as_str()
    };
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&fetched.bytes))
}

fn guess_mime(path: &str) -> &'static str {
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "css" => "text/css",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_content_types() {
        assert_eq!(parse_content_type("text/html; charset=\"GBK\""), ("text/html".to_string(), Some("gbk".to_string())));
        assert_eq!(parse_content_type("image/png"), ("image/png".to_string(), None));
    }

    #[test]
    fn guesses_mime_from_names() {
        assert_eq!(guess_mime("/a/b.WOFF2"), "font/woff2");
        assert_eq!(guess_mime("/a/b"), "application/octet-stream");
    }
}
