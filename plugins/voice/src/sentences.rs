//! Splits Markdown into sentences to read. Each sentence has its range in the text
//! (UTF-16 indexes, as JavaScript counts them) and the words to say (without Markdown marks).

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Sentence {
    pub start: usize,
    pub end: usize,
    pub speech: String,
}

pub fn split(text: &str) -> Vec<Sentence> {
    let mut result = Vec::new();
    let mut in_fence = false;
    let mut line_start = 0;
    for line in text.split('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        } else if !in_fence {
            let content = marker_length(line);
            split_line(text, line_start + content, &line[content..], &mut result);
        }
        line_start += line.len() + 1;
    }
    result
}

/// Splits one line (without its markers) at the end of each sentence.
fn split_line(text: &str, offset: usize, line: &str, out: &mut Vec<Sentence>) {
    let mut start = 0;
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    for (index, &(at, c)) in chars.iter().enumerate() {
        let next = chars.get(index + 1).map(|&(_, c)| c);
        let ends = matches!(c, '。' | '！' | '？') || (matches!(c, '.' | '!' | '?' | '…') && next.is_none_or(char::is_whitespace));
        if ends {
            push(text, offset + start, offset + at + c.len_utf8(), out);
            start = at + c.len_utf8();
        }
    }
    push(text, offset + start, offset + line.len(), out);
}

fn push(text: &str, start: usize, end: usize, out: &mut Vec<Sentence>) {
    let part = &text[start..end];
    let lead = part.len() - part.trim_start().len();
    let trail = part.len() - part.trim_end().len();
    let (start, end) = (start + lead, end - trail);
    if start >= end {
        return;
    }
    let speech = plain(&text[start..end]);
    if !speech.chars().any(char::is_alphanumeric) {
        return;
    }
    out.push(Sentence { start: utf16(text, start), end: utf16(text, end), speech });
}

fn utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

/// The words of a sentence: links give their label, emphasis and code marks go away.
pub fn plain(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let Some(close) = after.find("](") else { break };
        let Some(end) = after[close + 2..].find(')') else { break };
        let before = &rest[..open];
        out.push_str(before.strip_suffix('!').unwrap_or(before));
        out.push_str(&after[..close]);
        rest = &after[close + 2 + end + 1..];
    }
    out.push_str(rest);
    let cleaned: String = out.chars().filter(|c| !matches!(c, '*' | '_' | '`' | '~' | '#' | '<' | '>')).collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Length of the leading Markdown markers: space, `#`, `>`, list bullets, numbers, task boxes.
fn marker_length(line: &str) -> usize {
    let mut at = 0;
    loop {
        let start = at;
        at += line[at..].len() - line[at..].trim_start_matches([' ', '\t']).len();
        let rest = &line[at..];
        let hashes = rest.bytes().take_while(|&b| b == b'#').count();
        if (1..=6).contains(&hashes) && rest[hashes..].starts_with(' ') {
            at += hashes + 1;
        } else if let Some(marker) = ["> ", "- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ ", ">"].iter().find(|marker| rest.starts_with(**marker)) {
            at += marker.len();
        } else {
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits > 0 && digits < 10 && (rest[digits..].starts_with(". ") || rest[digits..].starts_with(") ")) {
                at += digits + 2;
            }
        }
        if at == start {
            return at;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slice16(text: &str, sentence: &Sentence) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[sentence.start..sentence.end]).unwrap()
    }

    #[test]
    fn splits_sentences_and_lines() {
        let text = "# Title\n\nFirst one. Second one!\n- A [linked](item:abc) **item**\n```\ncode. here.\n```\n3.14 stays";
        let found = split(text);
        let speech: Vec<&str> = found.iter().map(|sentence| sentence.speech.as_str()).collect();
        assert_eq!(speech, vec!["Title", "First one.", "Second one!", "A linked item", "3.14 stays"]);
        assert_eq!(slice16(text, &found[3]), "A [linked](item:abc) **item**");
    }

    #[test]
    fn ranges_count_utf16_units() {
        let text = "😀 Hi there. Bye.";
        let found = split(text);
        assert_eq!(found.len(), 2);
        assert_eq!(slice16(text, &found[1]), "Bye.");
    }

    #[test]
    fn skips_lines_without_words() {
        assert!(split("---\n\n***\n").is_empty());
    }
}
