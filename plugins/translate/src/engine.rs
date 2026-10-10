//! The model engine (llama.cpp). One model is in memory at a time.
//! Decoding is greedy with a small repeat penalty: the same text gives the same translation.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;

use crate::prompts::Part;

/// Tokens of the shared KV cache. All sequences that run at the same time share it.
const CONTEXT_TOKENS: u32 = 8192;
/// Sequences (lines) that decode at the same time. The GPU does them in one step.
/// Measured on an Apple M4 with Hy-MT 1.8B: 6 at a time is about 1.6 times faster than 1 at a time.
const PARALLEL: usize = 6;
/// Output limit: some tokens for each input token, plus a margin. Stops a model that repeats itself.
const OUTPUT_PER_INPUT: usize = 2;
const OUTPUT_MARGIN: usize = 32;

pub struct Engine {
    backend: LlamaBackend,
    /// The pack ID and its model.
    loaded: Option<(String, LlamaModel)>,
}

impl Engine {
    pub fn new() -> Result<Self, String> {
        let mut backend = LlamaBackend::init().map_err(|error| format!("The engine could not start: {error}"))?;
        // llama.cpp writes much to stderr. Keep the app log clean.
        backend.void_logs();
        Ok(Engine { backend, loaded: None })
    }

    /// Frees the model, for example before its file is deleted.
    pub fn unload(&mut self) {
        self.loaded = None;
    }

    /// Runs the prompts, several at the same time. `on_result` gets the index and the output text
    /// (None if the prompt is too long). Results can come in any order. A cancel stops all: Err("Cancelled.").
    pub fn run(
        &mut self,
        pack_id: &str,
        path: &Path,
        add_start: bool,
        prompts: &[Vec<Part>],
        cancel: &AtomicBool,
        on_result: &mut dyn FnMut(usize, Option<String>),
    ) -> Result<(), String> {
        let Engine { backend, loaded } = self;
        let model = load(backend, loaded, pack_id, path)?;
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(CONTEXT_TOKENS))
            .with_n_batch(CONTEXT_TOKENS)
            .with_n_seq_max(PARALLEL as u32)
            .with_kv_unified(true);
        let mut context = model.new_context(backend, params).map_err(|error| format!("The engine could not start: {error}"))?;
        let vocab = model.vocab();
        let mut batch = LlamaBatch::new(CONTEXT_TOKENS as usize, PARALLEL as i32);

        struct Slot {
            index: usize,
            seq: i32,
            /// Prompt tokens that are not decoded yet (only before the first step).
            prompt: Vec<LlamaToken>,
            /// The token to feed in the next step.
            next: Option<LlamaToken>,
            position: i32,
            output: Vec<u8>,
            produced: usize,
            limit: usize,
            budget: usize,
            sampler: LlamaSampler,
            logits_at: i32,
        }
        let mut slots: Vec<Slot> = Vec::new();
        let mut free: Vec<i32> = (0..PARALLEL as i32).rev().collect();
        let mut reserved = 0usize;
        let mut next_prompt = 0usize;
        context.clear_kv_cache();
        // INSPOBOARD_DEBUG=1 writes a timing line to stderr.
        let debug = std::env::var_os("INSPOBOARD_DEBUG").is_some();
        let started = std::time::Instant::now();
        let (mut steps, mut slot_steps) = (0usize, 0usize);

        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("Cancelled.".to_string());
            }
            // Start new sequences while a sequence ID and enough cache are free.
            while next_prompt < prompts.len() && !free.is_empty() {
                let tokens = tokenize(&vocab, &prompts[next_prompt], add_start);
                let limit = tokens.user * OUTPUT_PER_INPUT + OUTPUT_MARGIN;
                let budget = tokens.all.len() + limit;
                if budget > CONTEXT_TOKENS as usize {
                    on_result(next_prompt, None);
                    next_prompt += 1;
                    continue;
                }

                if reserved + budget > CONTEXT_TOKENS as usize {
                    break;
                }
                reserved += budget;
                let seq = free.pop().expect("a sequence is free");
                let sampler = LlamaSampler::chain_simple([LlamaSampler::penalties(vocab.n_tokens(), 64, 1.05, 0.0, 0.0), LlamaSampler::greedy()]);
                slots.push(Slot { index: next_prompt, seq, prompt: tokens.all, next: None, position: 0, output: Vec::new(), produced: 0, limit, budget, sampler, logits_at: -1 });
                next_prompt += 1;
            }
            if slots.is_empty() {
                if debug {
                    eprintln!("engine: {} prompts, {steps} steps, {:.2} active per step, {:.1} s", prompts.len(), slot_steps as f64 / steps.max(1) as f64, started.elapsed().as_secs_f64());
                }
                return Ok(());
            }
            steps += 1;
            slot_steps += slots.len();

            // One step: the prompts of new sequences, and one token for each running sequence.
            batch.clear();
            for slot in &mut slots {
                if !slot.prompt.is_empty() {
                    let last = slot.prompt.len() - 1;
                    for (offset, token) in slot.prompt.iter().enumerate() {
                        batch.add(*token, slot.position + offset as i32, &[slot.seq], offset == last).map_err(|error| error.to_string())?;
                    }
                    slot.position += slot.prompt.len() as i32;
                    slot.prompt.clear();
                } else if let Some(token) = slot.next.take() {
                    batch.add(token, slot.position, &[slot.seq], true).map_err(|error| error.to_string())?;
                    slot.position += 1;
                }
                slot.logits_at = batch.n_tokens() - 1;
            }
            context.decode(&mut batch).map_err(|error| format!("The model failed: {error}"))?;

            // Sample one token for each sequence. A finished sequence gives its result and frees its place.
            let mut finished: Vec<usize> = Vec::new();
            for (at, slot) in slots.iter_mut().enumerate() {
                let token = slot.sampler.sample(&context, slot.logits_at);
                if vocab.is_eog(token) || slot.produced >= slot.limit {
                    finished.push(at);
                    continue;
                }
                slot.output.extend(vocab.token_to_piece(token, false, None));
                slot.produced += 1;
                slot.next = Some(token);
            }
            for at in finished.into_iter().rev() {
                let slot = slots.remove(at);
                let _ = context.clear_kv_cache_seq(Some(slot.seq as u32), None, None);
                reserved -= slot.budget;
                free.push(slot.seq);
                on_result(slot.index, Some(String::from_utf8_lossy(&slot.output).trim().to_string()));
            }
        }
    }
}

struct Tokens {
    all: Vec<LlamaToken>,
    /// Tokens of the user text only.
    user: usize,
}

/// Template parts can have special tokens. User text never does.
fn tokenize(vocab: &llama_cpp_2::vocab::LlamaVocab<'_>, prompt: &[Part], add_start: bool) -> Tokens {
    let mut all = Vec::new();
    let mut user = 0;
    for (index, part) in prompt.iter().enumerate() {
        let add_special = add_start && index == 0;
        match part {
            Part::Template(text) => all.extend(vocab.tokenize(text.as_bytes(), add_special, true)),
            Part::User(text) => {
                let tokens = vocab.tokenize(text.as_bytes(), add_special, false);
                user += tokens.len();
                all.extend(tokens);
            }
        }
    }
    Tokens { all, user }
}

/// The model of the pack. It loads the model if a different one (or none) is in memory.
fn load<'a>(backend: &LlamaBackend, loaded: &'a mut Option<(String, LlamaModel)>, pack_id: &str, path: &Path) -> Result<&'a LlamaModel, String> {
    if loaded.as_ref().is_none_or(|(id, _)| id != pack_id) {
        // Free the old model first: two models may not fit in memory.
        *loaded = None;
        let params = LlamaModelParams::default().with_n_gpu_layers(1000);
        let model = LlamaModel::load_from_file(backend, path, &params).map_err(|error| format!("{}: {error}", path.display()))?;
        *loaded = Some((pack_id.to_string(), model));
    }
    Ok(&loaded.as_ref().expect("model is loaded").1)
}
