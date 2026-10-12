//! Splits Markdown into lines to translate. The structure stays: code blocks, line markers
//! (headings, lists, quotes), and link targets do not go to the model.
//! A long line (a paragraph) goes to the model one sentence at a time: each sentence is fast, so results
//! show while the rest is translated, and the model can work on many sentences in parallel.

/// One line of the text.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    /// The line stays as it is.
    Keep(String),
    /// `prefix` and `suffix` stay. `sentences` go to the model, one at a time; `gaps` are the spaces after each one.
    /// `targets` are the link targets that the sentences refer to as `§1`, `§2`, ...
    Translate { prefix: String, sentences: Vec<String>, gaps: Vec<String>, suffix: String, targets: Vec<String> },
}

pub fn split(body: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut fence: Option<&str> = None;
    for raw in body.split('\n') {
        let trimmed = raw.trim_start();
        if let Some(open) = fence {
            if trimmed.starts_with(open) {
                fence = None;
            }
            lines.push(Line::Keep(raw.to_string()));
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = Some(&trimmed[..3]);
            lines.push(Line::Keep(raw.to_string()));
            continue;
        }
        let (line, suffix) = match raw.strip_suffix('\r') {
            Some(line) => (line, "\r"),
            None => (raw, ""),
        };
        let prefix_length = marker_length(line);
        let (prefix, rest) = line.split_at(prefix_length);
        if !rest.chars().any(char::is_alphabetic) {
            lines.push(Line::Keep(raw.to_string()));
            continue;
        }
        let (text, targets) = protect_targets(rest);
        let (sentences, gaps) = sentences(&text);
        lines.push(Line::Translate { prefix: prefix.to_string(), sentences, gaps, suffix: suffix.to_string(), targets });
    }
    lines
}

/// Joins the lines again. `translated` has one text for each sentence of the `Translate` lines, in order.
pub fn join(lines: &[Line], translated: &[String]) -> String {
    let mut next = translated.iter();
    let parts: Vec<String> = lines
        .iter()
        .map(|line| match line {
            Line::Keep(text) => text.clone(),
            Line::Translate { prefix, sentences, gaps, suffix, targets } => {
                let mut body = String::new();
                for (sentence, gap) in sentences.iter().zip(gaps) {
                    let part = next.next().map(|value| one_line(value)).unwrap_or_else(|| sentence.clone());
                    body.push_str(&part);
                    // CJK sentences follow each other without a space.
                    if !gap.is_empty() && !ends_wide(&part) {
                        body.push_str(gap);
                    }
                }
                format!("{prefix}{}{suffix}", restore_targets(body.trim_end(), targets))
            }
        })
        .collect();
    parts.join("\n")
}

/// The texts that go to the model: the sentences of each line.
pub fn texts(lines: &[Line]) -> Vec<&str> {
    lines
        .iter()
        .flat_map(|line| match line {
            Line::Translate { sentences, .. } => sentences.iter().map(String::as_str).collect::<Vec<_>>(),
            Line::Keep(_) => Vec::new(),
        })
        .collect()
}

/// Words with a full stop that do not end a sentence.
const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "cf", "al", "fig", "figs", "eq", "eqs", "no", "nos",
    "vol", "pp", "p", "ch", "sec", "ed", "eds", "approx", "ca", "inc", "ltd", "co", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec", "u.s", "u.k",
];

/// A sentence shorter than this joins the next one (for example "Yes." or a numbered step). A CJK character counts 3.
const MIN_SENTENCE: usize = 24;

fn is_wide(c: char) -> bool {
    matches!(c as u32, 0x2e80..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff | 0xff00..=0xffef)
}

fn ends_wide(text: &str) -> bool {
    text.trim_end().chars().last().is_some_and(is_wide)
}

/// Splits a line into sentences, and the spaces after each one. The parts joined again give the line.
pub fn sentences(text: &str) -> (Vec<String>, Vec<String>) {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut cuts: Vec<(usize, usize)> = Vec::new(); // (end of the sentence, start of the next one)
    let mut index = 0;
    while index < chars.len() {
        let (at, c) = chars[index];
        let wide_end = matches!(c, '。' | '！' | '？' | '；');
        let latin_end = matches!(c, '.' | '!' | '?');
        if !wide_end && !latin_end {
            index += 1;
            continue;
        }
        // Closing quotes and brackets stay with the sentence.
        let mut end = index + 1;
        while end < chars.len() && matches!(chars[end].1, '"' | '\'' | '”' | '’' | ')' | '）' | '」' | '』' | '】' | '.' | '!' | '?' | '。' | '！' | '？') {
            end += 1;
        }
        let mut next = end;
        while next < chars.len() && chars[next].1.is_whitespace() {
            next += 1;
        }
        let byte = |position: usize| chars.get(position).map_or(text.len(), |entry| entry.0);
        if next >= chars.len() {
            break;
        }
        let ok = if wide_end {
            true
        } else {
            // Latin: a space after it, then not a lowercase letter, and the word before it is not an abbreviation.
            let word_start = text[..at].rfind(|c: char| c.is_whitespace() || c == '(').map_or(0, |found| found + 1);
            let word = text[word_start..at].to_lowercase();
            let single_letter = word.chars().count() == 1 && word.chars().all(char::is_alphabetic);
            next > end && !chars[next].1.is_lowercase() && !ABBREVIATIONS.contains(&word.as_str()) && !single_letter
        };
        if ok {
            cuts.push((byte(end), byte(next)));
        }
        index = next.max(index + 1);
    }
    let mut sentences = Vec::new();
    let mut gaps = Vec::new();
    let mut start = 0;
    for (end, next) in cuts {
        // A short sentence joins the next one.
        if text[start..end].chars().map(|c| if is_wide(c) { 3 } else { 1 }).sum::<usize>() < MIN_SENTENCE {
            continue;
        }
        sentences.push(text[start..end].to_string());
        gaps.push(text[end..next].to_string());
        start = next;
    }
    sentences.push(text[start..].to_string());
    gaps.push(String::new());
    (sentences, gaps)
}

/// A model can give more than one line. The line structure of the note must stay.
fn one_line(text: &str) -> String {
    text.trim().split('\n').map(str::trim).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Length of the leading Markdown markers: space, `#`, `>`, list bullets, numbers, task boxes.
fn marker_length(line: &str) -> usize {
    let bytes = line.as_bytes();
    let mut at = 0;
    loop {
        let start = at;
        while at < bytes.len() && (bytes[at] == b' ' || bytes[at] == b'\t') {
            at += 1;
        }
        let rest = &line[at..];
        if let Some(length) = heading(rest).or_else(|| simple_marker(rest)).or_else(|| numbered(rest)) {
            at += length;
        }
        if at == start {
            return at;
        }
    }
}

fn heading(rest: &str) -> Option<usize> {
    let hashes = rest.bytes().take_while(|&b| b == b'#').count();
    ((1..=6).contains(&hashes) && rest[hashes..].starts_with(' ')).then_some(hashes + 1)
}

fn simple_marker(rest: &str) -> Option<usize> {
    for marker in ["> ", "- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ ", ">"] {
        if rest.starts_with(marker) {
            return Some(marker.len());
        }
    }
    None
}

fn numbered(rest: &str) -> Option<usize> {
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let after = &rest[digits..];
    (after.starts_with(". ") || after.starts_with(") ")).then_some(digits + 2)
}

/// Replaces each `](target)` with `](§n)`. Item IDs and URLs must not change.
fn protect_targets(text: &str) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut targets = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find("](") {
        let after = &rest[open + 2..];
        let Some(close) = after.find(')') else { break };
        targets.push(after[..close].to_string());
        out.push_str(&rest[..open]);
        out.push_str(&format!("](§{})", targets.len()));
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    (out, targets)
}

fn restore_targets(text: &str, targets: &[String]) -> String {
    let mut out = text.to_string();
    // Replace the largest numbers first, so that "§1" does not match the start of "§10".
    for (index, target) in targets.iter().enumerate().rev() {
        out = out.replace(&format!("§{}", index + 1), target);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upper(lines: &[Line]) -> Vec<String> {
        texts(lines).iter().map(|text| text.to_uppercase()).collect()
    }

    #[test]
    fn keeps_structure() {
        let body = "# Title\n\n- first [link](item:abc123def456) here\n12. second\n```\ncode stays\n```\n> quote\n---\r\nend\r";
        let lines = split(body);
        assert_eq!(texts(&lines), vec!["Title", "first [link](§1) here", "second", "quote", "end"]);
        let joined = join(&lines, &upper(&lines));
        assert_eq!(joined, "# TITLE\n\n- FIRST [LINK](item:abc123def456) HERE\n12. SECOND\n```\ncode stays\n```\n> QUOTE\n---\r\nEND\r");
    }

    #[test]
    fn model_lines_become_one_line() {
        let lines = split("- a");
        assert_eq!(join(&lines, &["x\n\ny ".to_string()]), "- x y");
    }

    #[test]
    fn missing_results_keep_the_original() {
        let lines = split("a\nb");
        assert_eq!(join(&lines, &["A".to_string()]), "A\nb");
    }

    #[test]
    fn long_lines_go_by_sentence() {
        let lines = split("- First sentence is here, e.g. with an example. Second one comes next! Ok. Third: see Fig. 2 for it.");
        assert_eq!(texts(&lines), vec!["First sentence is here, e.g. with an example.", "Second one comes next! Ok.", "Third: see Fig. 2 for it."]);
        let joined = join(&lines, &["一句。".to_string(), "二句！".to_string(), "三句。".to_string()]);
        assert_eq!(joined, "- 一句。二句！三句。");
        let joined = join(&lines, &["A.".to_string(), "B!".to_string(), "C.".to_string()]);
        assert_eq!(joined, "- A. B! C.");
        let (parts, _) = sentences("这是第一句话，内容比较长一些的句子。这是第二句话，内容也比较长一些的句子。");
        assert_eq!(parts.len(), 2);
        assert_eq!(sentences("Version 3.5 is out. Nothing else to say here really.").0.len(), 1);
    }

    #[test]
    fn task_and_nested_markers() {
        let lines = split("  - [x] done task\n> - quoted item");
        assert_eq!(texts(&lines), vec!["done task", "quoted item"]);
    }
}
