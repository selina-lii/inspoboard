//! Inspoboard compare plugin (lab): the differences between two texts, side by side.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - Capability "compare-text": the app sends two texts (two items, two passages, the text of a saved web page or
//!   PDF). The plugin compares them word by word, not line by line: spaces and line breaks are not compared, so two
//!   PDFs with the same words and a different layout are the same. Hyphens inside words are not compared either
//!   ("trans-\nduction" at a line end, "self-attention", and "selfattention" are the same).
//! - The reply gives the changes in order: the part of each text that differs (UTF-16 indexes, as JavaScript counts).
//!   Small equal parts between two changes join the changes, so a changed sentence is one change, not scattered words.
//! - Offline. No files.

use std::io::{BufRead, Write};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use similar::{Algorithm, DiffOp, capture_diff_slices_deadline};

/// A diff that takes longer stops at this time and gives a coarser result (very long texts).
const DEADLINE: Duration = Duration::from_secs(5);

fn info() -> Value {
    json!({
        "title": "Compare",
        "icon": "compare",
        "description": "Shows the differences between two items side by side, word by word. Spaces and line breaks are not compared, so two PDFs with the same text and a different layout are the same. Lab: experimental.",
        "options": [
            { "key": "detail", "label": "Compare", "default": "word", "choices": [
                { "value": "word", "label": "Word by word" },
                { "value": "char", "label": "Character by character" }
            ] },
            { "key": "case", "label": "Upper and lower case", "default": "compare", "choices": [
                { "value": "compare", "label": "Compare" },
                { "value": "ignore", "label": "Ignore" }
            ] }
        ],
        "actions": [],
    })
}

struct Options {
    chars: bool,
    ignore_case: bool,
}

fn options_of(params: &Value) -> Options {
    let option = |key: &str| params.get("options").and_then(|options| options.get(key)).and_then(Value::as_str).unwrap_or("");
    Options { chars: option("detail") == "char", ignore_case: option("case") == "ignore" }
}

/// One compared unit: a word, a CJK character, or a punctuation mark. `start`, `end`: its place in the text (UTF-16).
#[derive(Debug)]
struct Token {
    key: String,
    start: usize,
    end: usize,
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xAC00..=0xD7AF | 0x20000..=0x2FFFF)
}

fn is_word(c: char) -> bool {
    (c.is_alphanumeric() || c == '_') && !is_cjk(c)
}

/// The same key for marks that look the same (PDFs and web pages often use one or the other).
fn key_char(c: char, options: &Options) -> String {
    let c = match c {
        '‘' | '’' | '′' => '\'',
        '“' | '”' | '″' => '"',
        '‐' | '‑' => '-',
        _ => c,
    };
    if options.ignore_case { c.to_lowercase().collect() } else { c.to_string() }
}

fn tokens(text: &str, options: &Options) -> Vec<Token> {
    let mut chars: Vec<(char, usize, usize)> = Vec::new();
    let mut at = 0;
    for c in text.chars() {
        let length = c.len_utf16();
        chars.push((c, at, at + length));
        at += length;
    }
    let mut out: Vec<Token> = Vec::new();
    // The word that is being read: it goes on while word characters follow.
    let mut word: Option<Token> = None;
    let mut index = 0;
    while index < chars.len() {
        let (c, start, end) = chars[index];
        index += 1;
        // A soft hyphen is never seen.
        if c == '\u{AD}' {
            continue;
        }
        // A hyphen inside a word does not count: "self-attention", "self-\nattention" (a line end), and
        // "selfattention" are the same word. The layout of a PDF often adds or moves these hyphens.
        if !options.chars && (c == '-' || c == '‐') && word.is_some() {
            let mut next = index;
            while next < chars.len() && chars[next].0.is_whitespace() && chars[next].0 != '\n' {
                next += 1;
            }
            if next < chars.len() && chars[next].0 == '\n' {
                while next < chars.len() && chars[next].0.is_whitespace() {
                    next += 1;
                }
            } else {
                next = index;
            }
            if next < chars.len() && is_word(chars[next].0) {
                index = next;
                continue;
            }
        }
        if c.is_whitespace() {
            out.extend(word.take());
            continue;
        }
        if !options.chars && is_word(c) {
            match word.as_mut() {
                Some(w) => {
                    w.key.push_str(&key_char(c, options));
                    w.end = end;
                }
                None => word = Some(Token { key: key_char(c, options), start, end }),
            }
            continue;
        }
        out.extend(word.take());
        out.push(Token { key: key_char(c, options), start, end });
    }
    out.extend(word);
    out
}

/// A part of the diff: equal tokens, or a change (the tokens on each side; one side can have none).
#[derive(Debug, Clone, Copy)]
struct Part {
    equal: bool,
    left: (usize, usize),
    right: (usize, usize),
}

fn size(range: (usize, usize)) -> usize {
    range.1 - range.0
}

/// The parts of the diff of two token lists: equal parts and changes, one after the other, with no two changes next
/// to each other.
fn parts_of(left: &[Token], right: &[Token]) -> Vec<Part> {
    let left_keys: Vec<&str> = left.iter().map(|token| token.key.as_str()).collect();
    let right_keys: Vec<&str> = right.iter().map(|token| token.key.as_str()).collect();
    let ops = capture_diff_slices_deadline(Algorithm::Patience, &left_keys, &right_keys, Some(Instant::now() + DEADLINE));
    let mut parts: Vec<Part> = Vec::new();
    for op in ops {
        let (l, r) = (op.old_range(), op.new_range());
        let equal = matches!(op, DiffOp::Equal { .. });
        push(&mut parts, Part { equal, left: (l.start, l.end), right: (r.start, r.end) });
    }
    cleanup(parts)
}

/// Adds a part; it joins the last part if both are changes (or both equal).
fn push(parts: &mut Vec<Part>, part: Part) {
    if size(part.left) == 0 && size(part.right) == 0 {
        return;
    }
    match parts.last_mut() {
        Some(last) if last.equal == part.equal => {
            last.left.1 = part.left.1;
            last.right.1 = part.right.1;
        }
        _ => parts.push(part),
    }
}

/// An equal part between two changes that is not longer than each of the two changes becomes a part of one change
/// (as the "semantic cleanup" of diff-match-patch). So "the", "a", "," between changed words do not split a change.
fn cleanup(mut parts: Vec<Part>) -> Vec<Part> {
    loop {
        let mut joined = false;
        let mut out: Vec<Part> = Vec::new();
        let mut index = 0;
        while index < parts.len() {
            let part = parts[index];
            if part.equal && index > 0 && index + 1 < parts.len() && !out.is_empty() {
                let before = out.last().copied().unwrap();
                let after = parts[index + 1];
                let length = size(part.left);
                let wide = |p: Part| size(p.left).max(size(p.right));
                if !before.equal && !after.equal && length <= wide(before) && length <= wide(after) {
                    let last = out.last_mut().unwrap();
                    last.left.1 = after.left.1;
                    last.right.1 = after.right.1;
                    index += 2;
                    joined = true;
                    continue;
                }
            }
            push(&mut out, part);
            index += 1;
        }
        parts = out;
        if !joined {
            return parts;
        }
    }
}

fn compare(params: &Value) -> Result<Value, String> {
    let left = params.get("left").and_then(Value::as_str).ok_or("The call has no left text.")?;
    let right = params.get("right").and_then(Value::as_str).ok_or("The call has no right text.")?;
    let options = options_of(params);
    let left_tokens = tokens(left, &options);
    let right_tokens = tokens(right, &options);
    // The text range of tokens [from, to); `after`: the end of the token before (the gap before the part starts there).
    let range = |list: &[Token], (from, to): (usize, usize)| -> Value {
        let after = if from == 0 { 0 } else { list[from - 1].end };
        if from == to {
            return json!({ "from": after, "start": after, "end": after });
        }
        json!({ "from": after, "start": list[from].start, "end": list[to - 1].end })
    };
    let changes: Vec<Value> = parts_of(&left_tokens, &right_tokens)
        .into_iter()
        .filter(|part| !part.equal)
        .map(|part| json!({ "left": range(&left_tokens, part.left), "right": range(&right_tokens, part.right) }))
        .collect();
    Ok(json!({ "changes": changes, "words": [left_tokens.len(), right_tokens.len()] }))
}

fn handle(method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "info" => Ok(info()),
        "compare" => compare(params),
        // Each call ends by its deadline: nothing to stop.
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

    fn run(left: &str, right: &str, options: Value) -> Vec<Value> {
        compare(&json!({ "left": left, "right": right, "options": options })).unwrap()["changes"].as_array().unwrap().clone()
    }

    fn marked(text: &str, side: &Value) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[side["start"].as_u64().unwrap() as usize..side["end"].as_u64().unwrap() as usize]).unwrap()
    }

    #[test]
    fn the_layout_does_not_count() {
        let left = "Attention is all you need.\nThe dominant sequence trans-\nduction models are based on\n\ncomplex recurrent networks.";
        let right = "Attention   is all you need. The dominant sequence transduction models\nare based on complex recurrent networks.";
        assert!(run(left, right, json!({})).is_empty());
        assert!(run("English-\nto-German self-attention", "English-to-German selfattention", json!({})).is_empty());
        // A dash between words is still compared.
        assert_eq!(run("one - two", "one two", json!({})).len(), 1);
    }

    #[test]
    fn marks_the_changed_words() {
        let left = "the quick red fox jumps";
        let right = "the quick 紅 fox jumps";
        let changes = run(left, right, json!({}));
        assert_eq!(changes.len(), 1);
        assert_eq!(marked(left, &changes[0]["left"]), "red");
        assert_eq!(marked(right, &changes[0]["right"]), "紅");
    }

    #[test]
    fn small_equal_parts_join_a_change() {
        let left = "We trained the model on eight GPUs for twelve hours.";
        let right = "We trained a network on two TPUs for three days.";
        let changes = run(left, right, json!({}));
        assert_eq!(changes.len(), 1);
        assert_eq!(marked(left, &changes[0]["left"]), "the model on eight GPUs for twelve hours");
    }

    #[test]
    fn added_and_removed_text() {
        let left = "one two three";
        let right = "one two three four";
        let changes = run(left, right, json!({}));
        assert_eq!(changes[0]["left"], json!({ "from": 13, "start": 13, "end": 13 }));
        assert_eq!(marked(right, &changes[0]["right"]), "four");
        assert_eq!(changes[0]["right"]["from"], 13);
    }

    #[test]
    fn chinese_differs_by_character() {
        let left = "我喜歡蘋果和茶";
        let changes = run(left, "我喜歡香蕉和茶", json!({}));
        assert_eq!(marked(left, &changes[0]["left"]), "蘋果");
    }

    #[test]
    fn utf16_indexes_and_case() {
        let left = "😀 a";
        let changes = run(left, "😀 b", json!({ "detail": "char" }));
        assert_eq!(changes[0]["left"]["start"], 3);
        assert!(run("Hello World", "hello world", json!({ "case": "ignore" })).is_empty());
        assert!(run("it’s “here”", "it's \"here\"", json!({})).is_empty());
    }

    #[test]
    fn empty_texts() {
        assert!(run("", "", json!({})).is_empty());
        assert_eq!(run("", "x", json!({})).len(), 1);
    }
}
