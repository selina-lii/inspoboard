//! Audio helpers: pitch change by resampling, and WAV encoding.

/// Resamples by `factor` with linear interpolation. Played at the old rate, the pitch goes up by `factor`
/// and the duration goes down by `factor`. The caller makes the speech slower by the same factor first.
pub fn resample(samples: &[f32], factor: f32) -> Vec<f32> {
    if (factor - 1.0).abs() < 1e-4 || samples.len() < 2 {
        return samples.to_vec();
    }
    let length = ((samples.len() as f32) / factor) as usize;
    (0..length)
        .map(|index| {
            let position = index as f32 * factor;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let weight = position - left as f32;
            samples[left] * (1.0 - weight) + samples[right] * weight
        })
        .collect()
}

/// 16-bit PCM WAV, one channel.
pub fn wav(samples: &[f32], sample_rate: u32, volume: f32) -> Vec<u8> {
    let data_length = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_length as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_length).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_length.to_le_bytes());
    for sample in samples {
        let value = (sample * volume).clamp(-1.0, 1.0);
        out.extend_from_slice(&((value * i16::MAX as f32) as i16).to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_changes_length() {
        let samples: Vec<f32> = (0..1000).map(|index| index as f32).collect();
        assert_eq!(resample(&samples, 2.0).len(), 500);
        assert_eq!(resample(&samples, 1.0).len(), 1000);
    }

    #[test]
    fn wav_header() {
        let bytes = wav(&[0.0, 1.0, -1.0], 24_000, 1.0);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 6);
        assert_eq!(i16::from_le_bytes([bytes[46], bytes[47]]), i16::MAX);
    }
}
