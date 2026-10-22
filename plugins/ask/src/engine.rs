//! The model engine (llama.cpp): the search model (vectors of passages and questions) and the answer model.
//! Both can be in memory: the search model is small. The answer model is freed when it is not used for some time.
//! Decoding is greedy with a small repeat penalty: the same question and passages give the same answer.

use std::num::NonZeroU32;
use std::path::Path;
use std::time::Instant;

use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

/// Tokens of one search batch. The search model sees each passage as a whole (one micro-batch).
const EMBED_BATCH_TOKENS: u32 = 4096;
/// Passages in one search batch.
const EMBED_SEQUENCES: usize = 16;
/// The search model reads at most this many tokens of a passage (EmbeddingGemma: 2048).
const EMBED_MAX_TOKENS: usize = 2048;
/// Tokens of the answer context: the question, the passages, and the answer.
const CHAT_CONTEXT_TOKENS: u32 = 8192;

pub struct Engine {
    backend: LlamaBackend,
    embed: Option<LlamaModel>,
    chat: Option<LlamaModel>,
    /// The last use of the answer model.
    pub chat_used: Instant,
}

impl Engine {
    pub fn new() -> Result<Self, String> {
        let mut backend = LlamaBackend::init().map_err(|error| format!("The engine could not start: {error}"))?;
        // llama.cpp writes much to stderr. Keep the app log clean.
        backend.void_logs();
        Ok(Engine { backend, embed: None, chat: None, chat_used: Instant::now() })
    }

    /// Frees the models, for example before a file is deleted.
    pub fn unload(&mut self) {
        self.embed = None;
        self.chat = None;
    }

    /// Frees the answer model only (it is the large one).
    pub fn unload_chat(&mut self) {
        self.chat = None;
    }

    pub fn has_chat(&self) -> bool {
        self.chat.is_some()
    }

    /// The vectors of the texts (unit length), in order. `cancelled` is checked between batches.
    pub fn embed(&mut self, path: &Path, texts: &[String], cancelled: &dyn Fn() -> bool) -> Result<Vec<Vec<f32>>, String> {
        let Engine { backend, embed, .. } = self;
        let model = load(backend, embed, path)?;
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(EMBED_BATCH_TOKENS))
            .with_n_batch(EMBED_BATCH_TOKENS)
            .with_n_ubatch(EMBED_BATCH_TOKENS)
            .with_n_seq_max(EMBED_SEQUENCES as u32)
            .with_embeddings(true)
            .with_pooling_type(LlamaPoolingType::Mean);
        let mut context = model.new_context(backend, params).map_err(|error| format!("The engine could not start: {error}"))?;
        let vocab = model.vocab();
        let limit = EMBED_MAX_TOKENS.min(EMBED_BATCH_TOKENS as usize);
        let tokens: Vec<_> = texts
            .iter()
            .map(|text| {
                let mut tokens = vocab.tokenize(text.as_bytes(), true, false);
                tokens.truncate(limit);
                tokens
            })
            .collect();
        let mut vectors = Vec::with_capacity(texts.len());
        let mut batch = LlamaBatch::new(EMBED_BATCH_TOKENS as usize, EMBED_SEQUENCES as i32);
        let mut next = 0;
        while next < tokens.len() {
            if cancelled() {
                return Err("Cancelled.".to_string());
            }
            batch.clear();
            let mut count = 0usize;
            let mut used = 0usize;
            while next + count < tokens.len() && count < EMBED_SEQUENCES && used + tokens[next + count].len() <= EMBED_BATCH_TOKENS as usize {
                let sequence = &tokens[next + count];
                for (position, token) in sequence.iter().enumerate() {
                    batch.add(*token, position as i32, &[count as i32], true).map_err(|error| error.to_string())?;
                }
                used += sequence.len();
                count += 1;
            }
            context.clear_kv_cache();
            context.decode(&mut batch).map_err(|error| format!("The model failed: {error}"))?;
            for seq in 0..count {
                let values = context.embeddings_seq_ith(seq as i32).map_err(|error| format!("The model failed: {error}"))?;
                vectors.push(normalized(values));
            }
            next += count;
        }
        Ok(vectors)
    }

    /// Writes the answer to one user message. `on_text` gets the text so far (whole characters only). `cancelled`
    /// is checked at each token.
    pub fn answer(&mut self, path: &Path, message: &str, max_tokens: usize, cancelled: &dyn Fn() -> bool, on_text: &mut dyn FnMut(&str)) -> Result<String, String> {
        self.chat_used = Instant::now();
        let Engine { backend, chat, .. } = self;
        let model = load(backend, chat, path)?;
        let template = model.chat_template(None).map_err(|error| format!("The model has no chat template: {error}"))?;
        let user = LlamaChatMessage::new("user".to_string(), message.to_string()).map_err(|error| error.to_string())?;
        let prompt = model.apply_chat_template(&template, &[user], true).map_err(|error| error.to_string())?;
        let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(CHAT_CONTEXT_TOKENS)).with_n_batch(CHAT_CONTEXT_TOKENS);
        let mut context = model.new_context(backend, params).map_err(|error| format!("The engine could not start: {error}"))?;
        let vocab = model.vocab();
        let tokens = vocab.tokenize(prompt.as_bytes(), true, true);
        if tokens.len() + max_tokens > CHAT_CONTEXT_TOKENS as usize {
            return Err("The question and its passages are too long for the model.".to_string());
        }
        let mut batch = LlamaBatch::new(CHAT_CONTEXT_TOKENS as usize, 1);
        let last = tokens.len() - 1;
        for (position, token) in tokens.iter().enumerate() {
            batch.add(*token, position as i32, &[0], position == last).map_err(|error| error.to_string())?;
        }
        context.decode(&mut batch).map_err(|error| format!("The model failed: {error}"))?;
        let mut sampler = LlamaSampler::chain_simple([LlamaSampler::penalties(vocab.n_tokens(), 64, 1.05, 0.0, 0.0), LlamaSampler::greedy()]);
        let mut output: Vec<u8> = Vec::new();
        let mut position = tokens.len() as i32;
        let mut logits_at = batch.n_tokens() - 1;
        for _ in 0..max_tokens {
            if cancelled() {
                return Err("Cancelled.".to_string());
            }
            let token = sampler.sample(&context, logits_at);
            if vocab.is_eog(token) {
                break;
            }
            output.extend(vocab.token_to_piece(token, false, None));
            on_text(whole_characters(&output));
            batch.clear();
            batch.add(token, position, &[0], true).map_err(|error| error.to_string())?;
            position += 1;
            logits_at = 0;
            context.decode(&mut batch).map_err(|error| format!("The model failed: {error}"))?;
        }
        self.chat_used = Instant::now();
        Ok(String::from_utf8_lossy(&output).trim().to_string())
    }
}

/// The valid UTF-8 start of the bytes: a token can end in the middle of a character.
fn whole_characters(bytes: &[u8]) -> &str {
    match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => std::str::from_utf8(&bytes[..error.valid_up_to()]).unwrap_or(""),
    }
}

fn normalized(values: &[f32]) -> Vec<f32> {
    let length = values.iter().map(|value| value * value).sum::<f32>().sqrt().max(1e-12);
    values.iter().map(|value| value / length).collect()
}

/// The model of the file. It loads the model if none is in memory.
fn load<'a>(backend: &LlamaBackend, slot: &'a mut Option<LlamaModel>, path: &Path) -> Result<&'a LlamaModel, String> {
    if slot.is_none() {
        let params = LlamaModelParams::default().with_n_gpu_layers(1000);
        let model = LlamaModel::load_from_file(backend, path, &params).map_err(|error| format!("{}: {error}", path.display()))?;
        *slot = Some(model);
    }
    Ok(slot.as_ref().expect("model is loaded"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_at_whole_characters() {
        let text = "知道".as_bytes();
        assert_eq!(whole_characters(&text[..4]), "知");
        assert_eq!(whole_characters(text), "知道");
    }

    #[test]
    fn normalizes_to_unit_length() {
        let vector = normalized(&[3.0, 4.0]);
        assert!((vector[0] - 0.6).abs() < 1e-6 && (vector[1] - 0.8).abs() < 1e-6);
    }
}
