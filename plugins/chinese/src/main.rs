//! Inspoboard Chinese script plugin: Simplified ↔ Traditional Chinese, offline and fast.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - Capability "convert-text": the app calls "transform" and writes the result into the item names and texts
//!   (one command; undo gives the texts back). Each character (or fixed phrase) is replaced: no translation.
//! - Text that is not Chinese stays as it is. Notations (punctuation and symbols, for example 「」) stay as they are.
//! - The rules (OpenCC and MediaWiki) are in the program. No network, no files.

use std::io::{BufRead, Write};

use serde_json::{Value, json};
use zhconv::{Variant, zhconv};

/// The target scripts: option value, label, variant.
const TARGETS: [(&str, &str, Variant); 4] = [
    ("hant", "Traditional", Variant::ZhHant),
    ("hans", "Simplified", Variant::ZhHans),
    ("tw", "Traditional (Taiwan)", Variant::ZhTW),
    ("hk", "Traditional (Hong Kong)", Variant::ZhHK),
];

fn info() -> Value {
    let choices: Vec<Value> = TARGETS.iter().map(|(value, label, _)| json!({ "value": value, "label": label })).collect();
    json!({
        "title": "Simplified ↔ Traditional Chinese conversion",
        "icon": "han",
        "description": "Simplified ↔ Traditional Chinese, character by character. Offline and fast. It changes the text in place (undo gives it back).",
        "options": [{ "key": "target", "label": "To", "default": "hant", "choices": choices }],
        "actions": [],
    })
}

fn transform(params: &Value) -> Result<Value, String> {
    let texts = params.get("texts").and_then(Value::as_array).ok_or("\"texts\" is missing.")?;
    let target = params.get("options").and_then(|options| options.get("target")).and_then(Value::as_str).unwrap_or("hant");
    let variant = TARGETS.iter().find(|(value, _, _)| *value == target).map(|(_, _, variant)| *variant).ok_or_else(|| format!("Unknown target \"{target}\"."))?;
    let output: Vec<String> = texts.iter().map(|text| convert(text.as_str().unwrap_or(""), variant)).collect();
    Ok(json!({ "texts": output }))
}

/// Converts a text. Code blocks and link targets of Markdown stay as they are.
fn convert(text: &str, variant: Variant) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_fence = false;
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 {
            out.push('\n');
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
        } else if in_fence {
            out.push_str(line);
        } else {
            out.push_str(&convert_line(line, variant));
        }
    }
    out
}

/// Converts a line, but not the targets of Markdown links "](...)".
fn convert_line(line: &str, variant: Variant) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(start) = rest.find("](") {
        let Some(length) = rest[start + 2..].find(')') else { break };
        out.push_str(&convert_words(&rest[..start + 2], variant));
        out.push_str(&rest[start + 2..start + 2 + length + 1]);
        rest = &rest[start + 2 + length + 1..];
    }
    out.push_str(&convert_words(rest, variant));
    out
}

/// Converts the letters of a text. The notations (each character that is not a letter, a digit or a space) stay as
/// they are: the rules would change 「」 into “” in Simplified Chinese.
fn convert_words(text: &str, variant: Variant) -> String {
    let mut out = String::with_capacity(text.len());
    let mut start = 0;
    for (index, character) in text.char_indices() {
        if character.is_alphanumeric() || character.is_whitespace() {
            continue;
        }
        if start < index {
            out.push_str(&zhconv(&text[start..index], variant));
        }
        out.push(character);
        start = index + character.len_utf8();
    }
    if start < text.len() {
        out.push_str(&zhconv(&text[start..], variant));
    }
    out
}

fn handle(method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "info" => Ok(info()),
        "transform" => transform(params),
        // Each call is fast: nothing to stop.
        "cancel" => Ok(Value::Null),
        _ => Err(format!("Unknown method \"{method}\".")),
    }
}

fn main() {
    let mut out = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<Value>(&line) else { continue };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let reply = match handle(method, &params) {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(message) => json!({ "id": id, "error": { "message": message } }),
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_both_ways_and_keeps_markdown_parts() {
        assert_eq!(convert("简体中文", Variant::ZhHant), "簡體中文");
        assert_eq!(convert("繁體中文", Variant::ZhHans), "繁体中文");
        let text = "# 头发\n[链接](https://例子.com/头)\n```\n头发\n```\nEnglish stays.";
        assert_eq!(convert(text, Variant::ZhHant), "# 頭髮\n[鏈接](https://例子.com/头)\n```\n头发\n```\nEnglish stays.");
    }

    #[test]
    fn keeps_notations() {
        assert_eq!(convert("「繁體」與『引號』", Variant::ZhHans), "「繁体」与『引号』");
        assert_eq!(convert("“简体”", Variant::ZhHant), "“簡體”");
    }

    #[test]
    fn replies_one_text_for_each_text() {
        let reply = transform(&json!({ "texts": ["软件", ""], "options": { "target": "tw" } })).unwrap();
        assert_eq!(reply["texts"].as_array().unwrap().len(), 2);
        assert!(transform(&json!({ "texts": [], "options": { "target": "x" } })).is_err());
    }
}
