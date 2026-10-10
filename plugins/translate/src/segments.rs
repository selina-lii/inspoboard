//! Splits Markdown into lines to translate. The structure stays: code blocks, line markers
//! (headings, lists, quotes), and link targets do not go to the model.

/// One line of the text.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    /// The line stays as it is.
    Keep(String),
    /// `prefix` and `suffix` stay. `text` goes to the model. `targets` are the link targets that `text` refers to as `§1`, `§2`, ...
    Translate { prefix: String, text: String, suffix: String, targets: Vec<String> },
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
        lines.push(Line::Translate { prefix: prefix.to_string(), text, suffix: suffix.to_string(), targets });
    }
    lines
}

/// Joins the lines again. `translated` has one text for each `Translate` line, in order.
pub fn join(lines: &[Line], translated: &[String]) -> String {
    let mut next = translated.iter();
    let parts: Vec<String> = lines
        .iter()
        .map(|line| match line {
            Line::Keep(text) => text.clone(),
            Line::Translate { prefix, text, suffix, targets } => {
                let body = next.next().map(|value| one_line(value)).unwrap_or_else(|| text.clone());
                format!("{prefix}{}{suffix}", restore_targets(&body, targets))
            }
        })
        .collect();
    parts.join("\n")
}

/// The texts that go to the model.
pub fn texts(lines: &[Line]) -> Vec<&str> {
    lines
        .iter()
        .filter_map(|line| match line {
            Line::Translate { text, .. } => Some(text.as_str()),
            Line::Keep(_) => None,
        })
        .collect()
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
    fn task_and_nested_markers() {
        let lines = split("  - [x] done task\n> - quoted item");
        assert_eq!(texts(&lines), vec!["done task", "quoted item"]);
    }
}
