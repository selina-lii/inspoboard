//! The two models of Pix2Text 1.5, on ONNX Runtime (CPU).
//! - Detection (MFD, a YOLO model): the boxes of the formulas on a page image. Two kinds: "inline" (in a line of text)
//!   and "display" (a formula on its own line).
//! - Recognition (MFR, a TrOCR model: image encoder + text decoder): the LaTeX of one formula image.
//! The steps follow Pix2Text and Ultralytics (resize, padding, thresholds), so the results are the same as theirs.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, Rgb, RgbImage};
use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;

use crate::latex::{self, Tokenizer};
use crate::models;

#[derive(Clone, Debug)]
pub struct Found {
    /// Left, top, right, bottom in pixels of the image.
    pub bounds: [f32; 4],
    pub display: bool,
    pub score: f32,
}

pub struct Engine {
    detector: Option<Session>,
    encoder: Option<Session>,
    decoder: Option<Session>,
    tokenizer: Option<Tokenizer>,
}

/// The width of the image for detection (Pix2Text: 768). The height keeps the aspect ratio.
const DETECT_WIDTH: u32 = 768;
const STRIDE: u32 = 32;
const MIN_SCORE: f32 = 0.25;
const NMS_OVERLAP: f32 = 0.7;
/// Pix2Text drops a box if this part of it (or more) is in a box with a higher place in the order.
const DEDUP_OVERLAP: f32 = 0.1;
/// The size of the image for recognition (DeiT encoder: 384 × 384).
const RECOGNIZE_SIZE: u32 = 384;
const START_TOKEN: i64 = 1;
const END_TOKEN: i64 = 2;
/// The longest LaTeX (tokens). Pix2Text allows 1024; a page formula is much shorter.
const MAX_TOKENS: usize = 512;

fn ort_error(error: impl std::fmt::Display) -> String {
    format!("The formula engine failed: {error}")
}

fn session(path: &Path) -> Result<Session, String> {
    let threads = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(4).min(8);
    Session::builder()
        .map_err(ort_error)?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(ort_error)?
        .with_intra_threads(threads)
        .map_err(ort_error)?
        .commit_from_file(path)
        .map_err(|error| format!("{}: {error}", path.display()))
}

impl Engine {
    pub fn new() -> Engine {
        Engine { detector: None, encoder: None, decoder: None, tokenizer: None }
    }

    /// Frees the models (before their files are deleted).
    pub fn unload(&mut self) {
        *self = Engine::new();
    }

    fn load(&mut self, folder: &Path) -> Result<(), String> {
        if !models::is_installed(folder) {
            return Err("The formula models are not installed. Download them in Settings → Plugins.".to_string());
        }
        if self.detector.is_none() {
            self.detector = Some(session(&models::path_of(folder, models::DETECTOR))?);
        }
        if self.encoder.is_none() {
            self.encoder = Some(session(&models::path_of(folder, models::ENCODER))?);
        }
        if self.decoder.is_none() {
            self.decoder = Some(session(&models::path_of(folder, models::DECODER))?);
        }
        if self.tokenizer.is_none() {
            let path = models::path_of(folder, models::TOKENIZER);
            let text = std::fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
            self.tokenizer = Some(Tokenizer::from_json(&text)?);
        }
        Ok(())
    }

    /// The formulas on an image: boxes, top to bottom, then left to right.
    pub fn detect(&mut self, folder: &Path, image: &DynamicImage) -> Result<Vec<Found>, String> {
        self.load(folder)?;
        let detector = self.detector.as_mut().expect("loaded");
        let (width, height) = image.dimensions();
        if width == 0 || height == 0 {
            return Ok(Vec::new());
        }
        // Ultralytics letterbox: the size is a multiple of the stride; the image is in the middle, gray around it.
        let target_w = DETECT_WIDTH;
        let target_h = (((height as f32 * DETECT_WIDTH as f32 / width as f32) as u32).max(1)).div_ceil(STRIDE) * STRIDE;
        let ratio = (target_h as f32 / height as f32).min(target_w as f32 / width as f32);
        let new_w = ((width as f32 * ratio).round() as u32).max(1);
        let new_h = ((height as f32 * ratio).round() as u32).max(1);
        let pad_left = ((target_w - new_w) as f32 / 2.0 - 0.1).round().max(0.0) as u32;
        let pad_top = ((target_h - new_h) as f32 / 2.0 - 0.1).round().max(0.0) as u32;
        let resized = image.to_rgb8();
        let resized = image::imageops::resize(&resized, new_w, new_h, FilterType::Triangle);
        let mut canvas = RgbImage::from_pixel(target_w, target_h, Rgb([114, 114, 114]));
        image::imageops::overlay(&mut canvas, &resized, pad_left as i64, pad_top as i64);
        let input = planar(&canvas, |value| value as f32 / 255.0);
        let tensor = Tensor::from_array(([1usize, 3, target_h as usize, target_w as usize], input)).map_err(ort_error)?;
        let outputs = detector.run(ort::inputs!["images" => tensor]).map_err(ort_error)?;
        let (shape, values) = outputs[0].try_extract_tensor::<f32>().map_err(ort_error)?;
        // Output: [1, 4 + classes, boxes]. Rows: center x, center y, width, height, then a score for each class.
        let rows = shape[1] as usize;
        let count = shape[2] as usize;
        let mut found: Vec<Found> = Vec::new();
        for index in 0..count {
            let at = |row: usize| values[row * count + index];
            let (class, score) = (4..rows).map(|row| (row - 4, at(row))).fold((0, f32::MIN), |best, next| if next.1 > best.1 { next } else { best });
            if score < MIN_SCORE {
                continue;
            }
            let (cx, cy, w, h) = (at(0), at(1), at(2), at(3));
            let back = |x: f32, pad: u32, limit: u32| ((x - pad as f32) / ratio).clamp(0.0, limit as f32);
            found.push(Found {
                bounds: [back(cx - w / 2.0, pad_left, width), back(cy - h / 2.0, pad_top, height), back(cx + w / 2.0, pad_left, width), back(cy + h / 2.0, pad_top, height)],
                // Classes of the model: 0 "embedding" (inline), 1 "isolated" (display).
                display: class == 1,
                score,
            });
        }
        let kept = non_max_suppression(found);
        let mut sorted = kept;
        sorted.sort_by(|a, b| reading_order(a, b));
        Ok(dedup(sorted))
    }

    /// The LaTeX of each formula image (a crop with one formula), and a score (0 to 1). Stops at a cancel.
    pub fn recognize(&mut self, folder: &Path, images: &[DynamicImage], cancel: &AtomicBool, done: &mut dyn FnMut(usize)) -> Result<Vec<(String, f32)>, String> {
        self.load(folder)?;
        let mut results = Vec::with_capacity(images.len());
        for (index, image) in images.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Err("Cancelled.".to_string());
            }
            results.push(self.recognize_one(image)?);
            done(index + 1);
        }
        Ok(results)
    }

    fn recognize_one(&mut self, image: &DynamicImage) -> Result<(String, f32), String> {
        if image.width() < 2 || image.height() < 2 {
            return Ok((String::new(), 0.0));
        }
        let encoder = self.encoder.as_mut().expect("loaded");
        // DeiT: a plain resize to 384 × 384 (bicubic), then (value / 255 − 0.5) / 0.5.
        let resized = image::imageops::resize(&image.to_rgb8(), RECOGNIZE_SIZE, RECOGNIZE_SIZE, FilterType::CatmullRom);
        let input = planar(&resized, |value| (value as f32 / 255.0 - 0.5) / 0.5);
        let size = RECOGNIZE_SIZE as usize;
        let tensor = Tensor::from_array(([1usize, 3, size, size], input)).map_err(ort_error)?;
        let outputs = encoder.run(ort::inputs!["pixel_values" => tensor]).map_err(ort_error)?;
        let (shape, hidden) = outputs[0].try_extract_tensor::<f32>().map_err(ort_error)?;
        let hidden_shape: Vec<usize> = shape.iter().map(|&value| value as usize).collect();
        let hidden = hidden.to_vec();
        drop(outputs);

        // Greedy decoding (Pix2Text: no beams). The decoder has no cache: each step reads all tokens so far.
        let decoder = self.decoder.as_mut().expect("loaded");
        let mut ids: Vec<i64> = vec![START_TOKEN];
        let mut log_sum = 0.0f64;
        while ids.len() <= MAX_TOKENS {
            let tokens = Tensor::from_array(([1usize, ids.len()], ids.clone())).map_err(ort_error)?;
            let states = Tensor::from_array((hidden_shape.clone(), hidden.clone())).map_err(ort_error)?;
            let outputs = decoder.run(ort::inputs!["input_ids" => tokens, "encoder_hidden_states" => states]).map_err(ort_error)?;
            let (shape, logits) = outputs[0].try_extract_tensor::<f32>().map_err(ort_error)?;
            let vocab = shape[2] as usize;
            let last = &logits[(ids.len() - 1) * vocab..ids.len() * vocab];
            let (best, best_logit) = last.iter().enumerate().fold((0usize, f32::MIN), |acc, (id, &value)| if value > acc.1 { (id, value) } else { acc });
            // The probability of the chosen token (softmax), for the score.
            let total: f64 = last.iter().map(|&value| ((value - best_logit) as f64).exp()).sum();
            log_sum += (1.0 / total + 1e-8).ln();
            ids.push(best as i64);
            if best as i64 == END_TOKEN {
                break;
            }
        }
        let steps = (ids.len() - 1).max(1) as f64;
        let score = (log_sum / steps).exp() as f32;
        let tokenizer = self.tokenizer.as_ref().expect("loaded");
        Ok((latex::clean(&tokenizer.decode(&ids)), score))
    }
}

/// An RGB image as planar values (all red, then all green, then all blue).
fn planar(image: &RgbImage, value: impl Fn(u8) -> f32) -> Vec<f32> {
    let (width, height) = image.dimensions();
    let plane = (width * height) as usize;
    let mut out = vec![0.0f32; plane * 3];
    for (index, pixel) in image.pixels().enumerate() {
        out[index] = value(pixel[0]);
        out[plane + index] = value(pixel[1]);
        out[2 * plane + index] = value(pixel[2]);
    }
    out
}

fn area(bounds: &[f32; 4]) -> f32 {
    (bounds[2] - bounds[0]).max(0.0) * (bounds[3] - bounds[1]).max(0.0)
}

fn intersection(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let w = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let h = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    w * h
}

/// Ultralytics NMS (one class at a time): a box goes if it overlaps a better box of its class too much.
fn non_max_suppression(mut found: Vec<Found>) -> Vec<Found> {
    found.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept: Vec<Found> = Vec::new();
    for candidate in found {
        let overlaps = kept.iter().any(|other| {
            if other.display != candidate.display {
                return false;
            }
            let shared = intersection(&other.bounds, &candidate.bounds);
            shared / (area(&other.bounds) + area(&candidate.bounds) - shared + 1e-6) > NMS_OVERLAP
        });
        if !overlaps {
            kept.push(candidate);
        }
        if kept.len() >= 300 {
            break;
        }
    }
    kept
}

/// Top to bottom; on the same line (the tops are near), left to right.
fn reading_order(a: &Found, b: &Found) -> std::cmp::Ordering {
    let line = ((a.bounds[3] - a.bounds[1]).min(b.bounds[3] - b.bounds[1]) / 2.0).max(1.0);
    if (a.bounds[1] - b.bounds[1]).abs() < line { a.bounds[0].total_cmp(&b.bounds[0]) } else { a.bounds[1].total_cmp(&b.bounds[1]) }
}

/// Pix2Text `dedup_boxes`: of two boxes that overlap, the one with the larger part in the other goes.
fn dedup(found: Vec<Found>) -> Vec<Found> {
    let mut keep = vec![true; found.len()];
    for index in 0..found.len() {
        if !keep[index] {
            continue;
        }
        for other in index + 1..found.len() {
            if !keep[other] {
                continue;
            }
            let shared = intersection(&found[index].bounds, &found[other].bounds);
            let part_of_other = shared / (area(&found[other].bounds) + 1e-6);
            let part_of_this = shared / (area(&found[index].bounds) + 1e-6);
            if part_of_other >= part_of_this {
                if part_of_other >= DEDUP_OVERLAP {
                    keep[other] = false;
                }
            } else if part_of_this >= DEDUP_OVERLAP {
                keep[index] = false;
                break;
            }
        }
    }
    found.into_iter().zip(keep).filter_map(|(item, keep)| keep.then_some(item)).collect()
}

/// The part of the image in the bounds (rounded down/up to whole pixels, as Pix2Text).
pub fn crop(image: &DynamicImage, bounds: &[f32; 4]) -> DynamicImage {
    let (width, height) = image.dimensions();
    let left = (bounds[0].max(0.0) as u32).min(width.saturating_sub(1));
    let top = (bounds[1].max(0.0) as u32).min(height.saturating_sub(1));
    let right = (bounds[2] as u32).clamp(left + 1, width);
    let bottom = (bounds[3] as u32).clamp(top + 1, height);
    image.crop_imm(left, top, right - left, bottom - top)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(bounds: [f32; 4], score: f32) -> Found {
        Found { bounds, display: false, score }
    }

    #[test]
    fn suppression_keeps_the_best_box() {
        let kept = non_max_suppression(vec![found([0.0, 0.0, 10.0, 10.0], 0.5), found([0.0, 0.0, 10.0, 9.0], 0.9), found([20.0, 0.0, 30.0, 10.0], 0.4)]);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].score, 0.9);
    }

    #[test]
    fn dedup_drops_a_box_inside_another() {
        let kept = dedup(vec![found([0.0, 0.0, 100.0, 20.0], 0.9), found([10.0, 2.0, 30.0, 18.0], 0.8)]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].bounds[2], 100.0);
    }

    #[test]
    fn reading_order_is_by_line_then_left() {
        let mut list = vec![found([50.0, 1.0, 60.0, 11.0], 0.5), found([0.0, 40.0, 10.0, 50.0], 0.5), found([0.0, 0.0, 10.0, 10.0], 0.5)];
        list.sort_by(reading_order);
        assert_eq!(list.iter().map(|item| item.bounds[0] as i32).collect::<Vec<_>>(), vec![0, 50, 0]);
    }
}
