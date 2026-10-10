//! Style sheets: find the files they use (url() and @import), and put those files inside as data.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex::{Captures, Regex};
use url::Url;

static URL_REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)"#).expect("valid pattern"));
static IMPORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)\s;"']+))\s*\)?[^;]*;"#).expect("valid pattern"));

fn target(captures: &Captures) -> String {
    (1..=3).find_map(|index| captures.get(index)).map(|found| found.as_str().trim().to_string()).unwrap_or_default()
}

fn resolve(base: &Url, reference: &str) -> Option<Url> {
    if reference.is_empty() || reference.starts_with("data:") || reference.starts_with('#') {
        return None;
    }
    base.join(reference).ok().filter(|url| matches!(url.scheme(), "http" | "https"))
}

/// The style sheets that a style sheet imports.
pub fn imports(css: &str, base: &Url) -> Vec<Url> {
    IMPORT.captures_iter(css).filter_map(|captures| resolve(base, &target(&captures))).collect()
}

/// The files that a style sheet uses (images, fonts), without its imports.
pub fn files(css: &str, base: &Url) -> Vec<Url> {
    let without_imports = IMPORT.replace_all(css, "");
    URL_REF.captures_iter(&without_imports).filter_map(|captures| resolve(base, &target(&captures))).collect()
}

/// The files of the page: address → data URL. And the style sheets: address → (address after redirects, text).
pub struct Resources<'a> {
    pub files: &'a HashMap<String, String>,
    pub sheets: &'a HashMap<String, (Url, String)>,
}

/// The style sheet with its files inside as data, and its imports in place of the @import rules.
/// A file that is not in `files` gets an empty URL: the saved page never loads from the network.
pub fn inline(css: &str, base: &Url, resources: &Resources, seen: &mut HashSet<String>) -> String {
    let with_imports = IMPORT.replace_all(css, |captures: &Captures| {
        let Some(url) = resolve(base, &target(captures)) else { return String::new() };
        match resources.sheets.get(url.as_str()) {
            Some((final_url, text)) if seen.insert(url.to_string()) => inline(text, final_url, resources, seen),
            _ => String::new(),
        }
    });
    URL_REF
        .replace_all(&with_imports, |captures: &Captures| {
            let reference = target(captures);
            if reference.starts_with("data:") {
                return captures[0].to_string();
            }
            if reference.starts_with('#') {
                // A reference inside the document (for example an SVG filter).
                return captures[0].to_string();
            }
            match resolve(base, &reference).and_then(|url| resources.files.get(url.as_str())) {
                Some(data) => format!("url(\"{data}\")"),
                None => "url(\"\")".to_string(),
            }
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_inlines_files() {
        let base = Url::parse("https://a.example/css/site.css").unwrap();
        let css = r#"@import url("more.css") screen; body { background: url('../img/bg.png') } .x { src: url(data:font/woff2;base64,AA) } .y { background: url(#f) }"#;
        assert_eq!(imports(css, &base).iter().map(Url::as_str).collect::<Vec<_>>(), vec!["https://a.example/css/more.css"]);
        assert_eq!(files(css, &base).iter().map(Url::as_str).collect::<Vec<_>>(), vec!["https://a.example/img/bg.png"]);
        let files = HashMap::from([("https://a.example/img/bg.png".to_string(), "data:image/png;base64,QQ==".to_string())]);
        let sheets = HashMap::from([("https://a.example/css/more.css".to_string(), (Url::parse("https://a.example/css/more.css").unwrap(), "p { color: red }".to_string()))]);
        let result = inline(css, &base, &Resources { files: &files, sheets: &sheets }, &mut HashSet::new());
        assert!(result.starts_with("p { color: red }"));
        assert!(result.contains("url(\"data:image/png;base64,QQ==\")"));
        assert!(result.contains("url(data:font/woff2;base64,AA)"));
        assert!(result.contains("url(#f)"));
    }

    #[test]
    fn an_import_loop_stops() {
        let base = Url::parse("https://a.example/a.css").unwrap();
        let sheets = HashMap::from([("https://a.example/a.css".to_string(), (base.clone(), "@import 'a.css'; x{}".to_string()))]);
        let files = HashMap::new();
        let result = inline("@import 'a.css';", &base, &Resources { files: &files, sheets: &sheets }, &mut HashSet::new());
        assert_eq!(result, " x{}");
    }
}
