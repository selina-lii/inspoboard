//! Prompt templates for each model. They follow the model cards.
//! A prompt is a list of parts: model tokens (special) and user text (never parsed for special tokens).
//! Thus a note that contains "<end_of_turn>" cannot change the prompt.

use crate::langs::{Route, name_of};

#[derive(Debug, PartialEq, Eq)]
pub enum Part {
    /// Template text. Special tokens in it are parsed.
    Template(String),
    /// User text. Special tokens in it are plain text.
    User(String),
}

/// True if the tokenizer must add the start token (Gemma). Hy-MT has it in its template.
pub fn add_start_token(route: Route) -> bool {
    route == Route::Multi
}

pub fn build(route: Route, source: &str, target: &str, text: &str) -> Vec<Part> {
    match route {
        Route::ZhEn => hy_mt(target, text),
        Route::Multi | Route::Same => translate_gemma(source, target, text),
    }
}

/// Tencent Hy-MT 1.5: the prompt for ZH <=> XX, in the chat format of the model card.
fn hy_mt(target: &str, text: &str) -> Vec<Part> {
    let target_name = match target {
        "en" => "英语",
        "zh-Hant" => "繁体中文",
        _ => "中文",
    };
    vec![
        Part::Template(format!("<｜hy_begin▁of▁sentence｜><｜hy_User｜>将以下文本翻译为{target_name}，注意只需要输出翻译后的结果，不要额外解释：\n\n")),
        Part::User(text.trim().to_string()),
        Part::Template("<｜hy_Assistant｜>".to_string()),
    ]
}

/// Google TranslateGemma: the text prompt of its chat template.
fn translate_gemma(source: &str, target: &str, text: &str) -> Vec<Part> {
    let source_name = name_of(source).unwrap_or(source);
    let target_name = name_of(target).unwrap_or(target);
    vec![
        Part::Template(format!(
            "<start_of_turn>user\nYou are a professional {source_name} ({source}) to {target_name} ({target}) translator. \
             Your goal is to accurately convey the meaning and nuances of the original {source_name} text while adhering to \
             {target_name} grammar, vocabulary, and cultural sensitivities.\nProduce only the {target_name} translation, \
             without any additional explanations or commentary. Please translate the following {source_name} text into {target_name}:\n\n\n"
        )),
        Part::User(text.trim().to_string()),
        Part::Template("<end_of_turn>\n<start_of_turn>model\n".to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hy_mt_uses_chinese_names() {
        let parts = build(Route::ZhEn, "zh", "en", " 你好 ");
        assert!(matches!(&parts[0], Part::Template(text) if text.contains("翻译为英语")));
        assert_eq!(parts[1], Part::User("你好".to_string()));
    }

    #[test]
    fn gemma_names_both_languages() {
        let parts = build(Route::Multi, "fr", "de", "Bonjour");
        assert!(matches!(&parts[0], Part::Template(text) if text.contains("French (fr) to German (de)")));
        assert!(matches!(&parts[2], Part::Template(text) if text.ends_with("<start_of_turn>model\n")));
    }
}
