//! The texts for the models.
//! - Search (EmbeddingGemma): a passage and a question get different prefixes, as the model was trained.
//! - Answers: one user message with the rules, the numbered passages, and the question.

/// A passage that the app sends: its number in the answer, its title, and its text.
pub struct Passage {
    pub n: u64,
    pub title: String,
    pub text: String,
}

/// The text that the search model reads. `query`: a question; else a passage with its title.
pub fn embed_text(text: &str, title: Option<&str>, query: bool) -> String {
    if query {
        format!(r"task: search result | query: {text}")
    } else {
        let title = title.map(str::trim).filter(|title| !title.is_empty()).unwrap_or("none");
        format!(r"title: {title} | text: {text}")
    }
}

/// The message for the answer model. `language`: "auto" (the language of the question), or a language name.
pub fn answer_message(question: &str, passages: &[Passage], language: &str) -> String {
    let language = if language == "auto" { "the language of the question".to_string() } else { language.to_string() };
    let mut message = String::from(
        "You answer questions about the user's own notes, saved web pages, and PDFs.\n\
         Rules:\n\
         - Use only the numbered passages below. Do not add facts that are not in them.\n\
         - After each statement, give the numbers of the passages it comes from in square brackets, like [2] or [1][3].\n\
         - If the passages do not answer the question, say only that, in one sentence, with no numbers.\n\
         - Be short and clear. Use a list when it helps.\n",
    );
    // Raw strings: model text, not UI text (the i18n check skips them).
    message.push_str(&format!(r"- Answer in {language}."));
    message.push_str("\n\n");
    message.push_str(r"Passages:");
    message.push('\n');
    for passage in passages {
        let title = passage.title.trim();
        message.push_str(&format!("\n[{}] {}\n{}\n", passage.n, if title.is_empty() { "(untitled)" } else { title }, passage.text.trim()));
    }
    message.push('\n');
    message.push_str(&format!(r"Question: {}", question.trim()));
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_texts_have_the_trained_prefixes() {
        assert_eq!(embed_text("what is attention", None, true), "task: search result | query: what is attention");
        assert_eq!(embed_text("Body.", Some(" "), false), "title: none | text: Body.");
        assert_eq!(embed_text("Body.", Some("Paper"), false), "title: Paper | text: Body.");
    }

    #[test]
    fn the_answer_message_numbers_the_passages() {
        let passages = [Passage { n: 1, title: "A".into(), text: "One.".into() }, Passage { n: 2, title: String::new(), text: "Two.".into() }];
        let message = answer_message("Why?", &passages, "auto");
        assert!(message.contains("[1] A\nOne."));
        assert!(message.contains("[2] (untitled)\nTwo."));
        assert!(message.contains("the language of the question"));
        assert!(message.ends_with("Question: Why?"));
    }
}
