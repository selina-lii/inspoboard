//! Languages, script detection, and model routing.

pub struct Lang {
    pub code: &'static str,
    pub name: &'static str,
}

/// The languages in the menus. Mostly Europe and Asia. TranslateGemma knows all of them.
pub const LANGS: &[Lang] = &[
    Lang { code: "zh", name: "Chinese (Simplified)" },
    Lang { code: "zh-Hant", name: "Chinese (Traditional)" },
    Lang { code: "en", name: "English" },
    Lang { code: "ja", name: "Japanese" },
    Lang { code: "ko", name: "Korean" },
    Lang { code: "fr", name: "French" },
    Lang { code: "de", name: "German" },
    Lang { code: "es", name: "Spanish" },
    Lang { code: "pt", name: "Portuguese" },
    Lang { code: "it", name: "Italian" },
    Lang { code: "nl", name: "Dutch" },
    Lang { code: "sv", name: "Swedish" },
    Lang { code: "da", name: "Danish" },
    Lang { code: "nb", name: "Norwegian" },
    Lang { code: "fi", name: "Finnish" },
    Lang { code: "is", name: "Icelandic" },
    Lang { code: "pl", name: "Polish" },
    Lang { code: "cs", name: "Czech" },
    Lang { code: "sk", name: "Slovak" },
    Lang { code: "hu", name: "Hungarian" },
    Lang { code: "ro", name: "Romanian" },
    Lang { code: "bg", name: "Bulgarian" },
    Lang { code: "el", name: "Greek" },
    Lang { code: "hr", name: "Croatian" },
    Lang { code: "sr", name: "Serbian" },
    Lang { code: "sl", name: "Slovenian" },
    Lang { code: "et", name: "Estonian" },
    Lang { code: "lv", name: "Latvian" },
    Lang { code: "lt", name: "Lithuanian" },
    Lang { code: "uk", name: "Ukrainian" },
    Lang { code: "ru", name: "Russian" },
    Lang { code: "be", name: "Belarusian" },
    Lang { code: "tr", name: "Turkish" },
    Lang { code: "az", name: "Azerbaijani" },
    Lang { code: "ka", name: "Georgian" },
    Lang { code: "hy", name: "Armenian" },
    Lang { code: "kk", name: "Kazakh" },
    Lang { code: "uz", name: "Uzbek" },
    Lang { code: "mn", name: "Mongolian" },
    Lang { code: "fa", name: "Persian" },
    Lang { code: "ar", name: "Arabic" },
    Lang { code: "he", name: "Hebrew" },
    Lang { code: "ur", name: "Urdu" },
    Lang { code: "hi", name: "Hindi" },
    Lang { code: "bn", name: "Bengali" },
    Lang { code: "ta", name: "Tamil" },
    Lang { code: "th", name: "Thai" },
    Lang { code: "vi", name: "Vietnamese" },
    Lang { code: "id", name: "Indonesian" },
    Lang { code: "ms", name: "Malay" },
    Lang { code: "fil", name: "Filipino" },
    Lang { code: "km", name: "Khmer" },
    Lang { code: "my", name: "Burmese" },
];

/// Source option: detect the language of each text.
pub const DETECT: &str = "auto";
/// Target option: Chinese text goes to English, all other text goes to Chinese.
pub const ZH_EN_SWAP: &str = "zh-en";

pub fn name_of(code: &str) -> Option<&'static str> {
    LANGS.iter().find(|lang| lang.code == code).map(|lang| lang.name)
}

fn is_chinese(code: &str) -> bool {
    code == "zh" || code == "zh-Hant"
}

/// The language of a text, from its script. Latin script gives English: select the source for other Latin languages.
pub fn detect(text: &str) -> &'static str {
    let mut counts: [usize; 12] = [0; 12];
    const CODES: [&str; 12] = ["en", "zh", "ja", "ko", "ru", "ar", "he", "th", "el", "hi", "ka", "hy"];
    for c in text.chars() {
        let index = match c as u32 {
            0x3040..=0x30FF => 2,
            0xAC00..=0xD7AF | 0x1100..=0x11FF => 3,
            0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF => 1,
            0x0400..=0x04FF => 4,
            0x0600..=0x06FF => 5,
            0x0590..=0x05FF => 6,
            0x0E00..=0x0E7F => 7,
            0x0370..=0x03FF => 8,
            0x0900..=0x097F => 9,
            0x10A0..=0x10FF => 10,
            0x0530..=0x058F => 11,
            _ if c.is_alphabetic() => 0,
            _ => continue,
        };
        counts[index] += 1;
    }
    // Japanese text has kanji too. Any kana means Japanese.
    if counts[2] > 0 {
        return "ja";
    }
    // A Chinese or Korean character holds about as much as two Latin letters.
    counts[0] /= 2;
    let best = (0..counts.len()).max_by_key(|&index| (counts[index], index == 0)).unwrap_or(0);
    if counts[best] == 0 { "en" } else { CODES[best] }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Route {
    /// Source and target are the same: no translation.
    Same,
    /// Tencent Hy-MT: Chinese and English.
    ZhEn,
    /// Google TranslateGemma: all other pairs.
    Multi,
}

/// The source and target codes for a text, from the options.
pub fn resolve(source_option: &str, target_option: &str, text: &str) -> (String, String) {
    let source = if source_option == DETECT { detect(text).to_string() } else { source_option.to_string() };
    let target = if target_option == ZH_EN_SWAP {
        if is_chinese(&source) { "en" } else { "zh" }
    } else {
        target_option
    };
    (source, target.to_string())
}

pub fn route(source: &str, target: &str) -> Route {
    if source == target {
        Route::Same
    } else if (is_chinese(source) && target == "en") || (source == "en" && is_chinese(target)) {
        Route::ZhEn
    } else {
        Route::Multi
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_scripts() {
        assert_eq!(detect("Hello, world"), "en");
        assert_eq!(detect("你好，世界。Hello"), "zh");
        assert_eq!(detect("こんにちは世界"), "ja");
        assert_eq!(detect("안녕하세요"), "ko");
        assert_eq!(detect("Привет мир"), "ru");
        assert_eq!(detect("1234 !!"), "en");
    }

    #[test]
    fn routes_pairs() {
        assert_eq!(route("zh", "en"), Route::ZhEn);
        assert_eq!(route("en", "zh-Hant"), Route::ZhEn);
        assert_eq!(route("ja", "zh"), Route::Multi);
        assert_eq!(route("fr", "en"), Route::Multi);
        assert_eq!(route("en", "en"), Route::Same);
    }

    #[test]
    fn swap_target() {
        assert_eq!(resolve(DETECT, ZH_EN_SWAP, "你好"), ("zh".to_string(), "en".to_string()));
        assert_eq!(resolve(DETECT, ZH_EN_SWAP, "hello"), ("en".to_string(), "zh".to_string()));
        assert_eq!(resolve("fr", ZH_EN_SWAP, "bonjour"), ("fr".to_string(), "zh".to_string()));
        assert_eq!(resolve(DETECT, "de", "hello"), ("en".to_string(), "de".to_string()));
    }

    #[test]
    fn every_language_has_a_name() {
        assert!(LANGS.iter().all(|lang| name_of(lang.code).is_some()));
    }
}
