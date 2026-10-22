//! Text of the recognizer: token ids → LaTeX, and a cleanup of the LaTeX.
//! - The tokenizer is byte-level BPE (as GPT-2): each token is a string of byte symbols.
//! - The cleanup follows Pix2Text (`LatexOCR.post_process`), and adds one step: letters with spaces in a name
//!   (`\mathrm{s o f t m a x}`) become one word (`\mathrm{softmax}`), so that the words of the formula are correct.
//!   A period between letters (`\beta. \xi`) becomes a multiplication dot.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

pub struct Tokenizer {
    /// Token id → token string (byte symbols).
    tokens: Vec<String>,
    /// Byte symbol → byte.
    bytes: HashMap<char, u8>,
    special: Vec<bool>,
}

impl Tokenizer {
    /// Reads `tokenizer.json` of Hugging Face (a BPE model with byte-level decoding).
    pub fn from_json(text: &str) -> Result<Tokenizer, String> {
        let json: Value = serde_json::from_str(text).map_err(|error| format!("The tokenizer file is not correct: {error}"))?;
        let vocab = json.pointer("/model/vocab").and_then(Value::as_object).ok_or("The tokenizer file has no vocabulary.")?;
        let mut tokens = vec![String::new(); vocab.len()];
        for (token, id) in vocab {
            let id = id.as_u64().ok_or("The tokenizer file is not correct.")? as usize;
            if id >= tokens.len() {
                tokens.resize(id + 1, String::new());
            }
            tokens[id] = token.clone();
        }
        let mut special = vec![false; tokens.len()];
        for added in json.get("added_tokens").and_then(Value::as_array).into_iter().flatten() {
            if added.get("special").and_then(Value::as_bool) == Some(true)
                && let Some(id) = added.get("id").and_then(Value::as_u64)
                && (id as usize) < special.len()
            {
                special[id as usize] = true;
            }
        }
        Ok(Tokenizer { tokens, bytes: byte_symbols(), special })
    }

    /// The text of token ids. Special tokens (start, end, padding) are left out.
    pub fn decode(&self, ids: &[i64]) -> String {
        let mut bytes = Vec::new();
        for &id in ids {
            let Some(token) = self.tokens.get(id as usize) else { continue };
            if self.special[id as usize] {
                continue;
            }
            for symbol in token.chars() {
                match self.bytes.get(&symbol) {
                    Some(&byte) => bytes.push(byte),
                    None => bytes.extend(symbol.to_string().as_bytes()),
                }
            }
        }
        String::from_utf8_lossy(&bytes).trim().to_string()
    }
}

/// The byte symbols of byte-level BPE (GPT-2 `bytes_to_unicode`): printable bytes are themselves, others are moved
/// to 256 and up.
fn byte_symbols() -> HashMap<char, u8> {
    let printable = |byte: u32| (33..=126).contains(&byte) || (161..=172).contains(&byte) || (174..=255).contains(&byte);
    let mut map = HashMap::new();
    let mut next = 0u32;
    for byte in 0u32..256 {
        let symbol = if printable(byte) {
            byte
        } else {
            next += 1;
            255 + next
        };
        map.insert(char::from_u32(symbol).expect("valid symbol"), byte as u8);
    }
    map
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid pattern")
}

static LEADING_SCRIPT: LazyLock<[Regex; 2]> = LazyLock::new(|| [re(r"^\^\s*\{\s*(.*?)\s*\}"), re(r"^_\s*\{\s*(.*?)\s*\}")]);
static TRAILING_SPACE: LazyLock<Regex> = LazyLock::new(|| re(r"(?:\\ +|\\quad\s*|\\qquad\s*|\\,\s*|\\:\s*|\\;\s*|\\enspace\s*|\\thinspace\s*|\\!\s*)+$"));
static EMPTY: LazyLock<Regex> = LazyLock::new(|| re(r"\\(?:hat|text|tilde|bar|vec|acute|grave|breve|overline|dot|ddot|widehat|widetilde)\s*\{\s*\}|\^\s*\{\s*\}|_\s*\{\s*\}"));
static NAME: LazyLock<Regex> = LazyLock::new(|| re(r"\\(mathrm|operatorname\*?|text|textrm|textbf|textit|mathit|mathbf|mathsf|mathtt)\s*\{([^{}]*)\}"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));
static COMMAND_SPACE: LazyLock<Regex> = LazyLock::new(|| re(r"\\([a-zA-Z]+)\s+([^a-zA-Z\s])"));
static BRACE_SPACE: LazyLock<[Regex; 2]> = LazyLock::new(|| [re(r"\{\s+"), re(r"\s+\}")]);
static OPERATOR_SPACE: LazyLock<Regex> = LazyLock::new(|| re(r"([^\\\s])\s*([+=-])\s*"));
static SCRIPT_SPACE: LazyLock<Regex> = LazyLock::new(|| re(r"\s*([\^_])\s*"));
/// A period between two letters or symbols (`\beta. \xi. q`): the recognizer reads a multiplication dot as a period.
static PERIOD_DOT: LazyLock<Regex> = LazyLock::new(|| re(r"([A-Za-z}])\s*\.\s*(\\[A-Za-z]+|[A-Za-z])"));

/// The cleanup of a recognized formula.
pub fn clean(text: &str) -> String {
    let mut text = text.trim().to_string();
    for pattern in LEADING_SCRIPT.iter() {
        text = pattern.replace(&text, "$1").trim().to_string();
    }
    text = TRAILING_SPACE.replace(&text, "").trim().to_string();
    // "\." "\=" "\-" "\~" are not commands in math: a space keeps the symbol.
    for symbol in [".", "=", "-", "~"] {
        text = text.replace(&format!("\\{symbol}"), &format!("\\ {symbol}"));
    }
    for _ in 0..10 {
        let next = EMPTY.replace_all(&text, "").trim().to_string();
        if next == text {
            break;
        }
        text = next;
    }
    text = join_spelled_names(&text);
    for _ in 0..10 {
        let next = PERIOD_DOT.replace_all(&text, "$1 \\cdot $2").to_string();
        if next == text {
            break;
        }
        text = next;
    }
    text = match_left_right(&text);
    text = SPACES.replace_all(&text, " ").to_string();
    text = COMMAND_SPACE.replace_all(&text, "\\$1$2").to_string();
    text = BRACE_SPACE[0].replace_all(&text, "{").to_string();
    text = BRACE_SPACE[1].replace_all(&text, "}").to_string();
    text = OPERATOR_SPACE.replace_all(&text, "$1$2").to_string();
    text = SCRIPT_SPACE.replace_all(&text, "$1").to_string();
    text.trim().to_string()
}

/// `\mathrm{s o f t m a x}` → `\mathrm{softmax}`; `\mathrm{T h e n ~ d e t}` → `\mathrm{Then~det}`. Only if each part
/// between the spaces is one letter (or `~`): `\text{a b}` (two words of one letter) is the same as `\text{ab}` in
/// the recognizer output anyway.
fn join_spelled_names(text: &str) -> String {
    NAME.replace_all(text, |captures: &regex::Captures| {
        let inner = &captures[2];
        let parts: Vec<&str> = inner.split_whitespace().collect();
        let spelled = parts.len() > 1 && parts.iter().all(|part| part.chars().count() == 1);
        if spelled { format!("\\{}{{{}}}", &captures[1], parts.concat()) } else { captures[0].to_string() }
    })
    .to_string()
}

/// A `\left` without a `\right` (or the reverse) is an error in LaTeX: such a command goes (its bracket stays).
fn match_left_right(text: &str) -> String {
    static COMMAND: LazyLock<Regex> = LazyLock::new(|| re(r"\\(left|right)\b"));
    let found: Vec<(usize, usize, bool)> = COMMAND.captures_iter(text).map(|captures| {
        let whole = captures.get(0).expect("match");
        (whole.start(), whole.end(), &captures[1] == "left")
    }).collect();
    let mut keep = vec![false; found.len()];
    let mut open: Vec<usize> = Vec::new();
    for (index, &(_, _, left)) in found.iter().enumerate() {
        if left {
            open.push(index);
        } else if let Some(start) = open.pop() {
            keep[start] = true;
            keep[index] = true;
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (index, &(start, end, _)) in found.iter().enumerate() {
        if !keep[index] {
            out.push_str(&text[at..start]);
            at = end;
        }
    }
    out.push_str(&text[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_spelled_names() {
        assert_eq!(clean(r"\mathrm{s o f t m a x} ( x )"), r"\mathrm{softmax} ( x )");
        assert_eq!(clean(r"\operatorname{s i n} \theta"), r"\operatorname{sin} \theta");
        assert_eq!(clean(r"\mathrm{~ T h e n ~ d e t ~} A"), r"\mathrm{~Then~det~} A");
        assert_eq!(clean(r"\mathrm{d x}"), r"\mathrm{dx}");
        assert_eq!(clean(r"\text{if and}"), r"\text{if and}");
    }

    #[test]
    fn follows_pix2text_cleanup() {
        assert_eq!(clean(r"a^{2} + b^{2} = c^{2} \quad"), r"a^{2}+b^{2}=c^{2}");
        assert_eq!(clean(r"^ { x } y"), r"x y");
        assert_eq!(clean(r"\hat { } x _ { }"), r"x");
        assert_eq!(clean(r"\left( x \right) \left[ y"), r"\left( x \right) [ y");
        assert_eq!(clean(r"x \right)"), r"x )");
        // A multiplication dot read as a period. A decimal point stays.
        assert_eq!(clean(r"\beta. \xi. q"), r"\beta\cdot \xi\cdot q");
        assert_eq!(clean(r"1.5 x"), r"1.5 x");
    }

    #[test]
    fn decodes_byte_level_tokens() {
        let json = r#"{"model":{"vocab":{"<s>":0,"</s>":1,"\\fr":2,"ac":3,"Ġ{":4,"Ã©":5}},"added_tokens":[{"id":0,"special":true},{"id":1,"special":true}]}"#;
        let tokenizer = Tokenizer::from_json(json).unwrap();
        assert_eq!(tokenizer.decode(&[0, 2, 3, 4, 5, 1]), "\\frac {é");
    }
}
