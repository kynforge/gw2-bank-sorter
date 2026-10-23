//! Slot fingerprints: the central half of a slot (or icon), averaged down to 8×8 RGB.
//! The screen capture and the API's item icon go through the same function, so they compare fairly.

pub const GRID: usize = 8;
pub const LEN: usize = GRID * GRID * 3;

/// The background a transparent icon pixel sits on in game: a dark slot.
const SLOT_BG: [f32; 3] = [24.0, 24.0, 24.0];

/// `rgba` is `w × h` pixels, 4 bytes each, rows top to bottom.
pub fn fingerprint(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let (w, h) = (w as usize, h as usize);
    // The central half: away from stack counts in the corners and rarity borders at the edges.
    let (x0, x1, y0, y1) = (w / 4, w - w / 4, h / 4, h - h / 4);
    let (cw, ch) = (x1 - x0, y1 - y0);
    if cw == 0 || ch == 0 || rgba.len() < w * h * 4 {
        return vec![0; LEN];
    }
    let mut sums = [[0u64; 3]; GRID * GRID];
    let mut counts = [0u64; GRID * GRID];
    for y in y0..y1 {
        for x in x0..x1 {
            let cell = ((y - y0) * GRID / ch) * GRID + (x - x0) * GRID / cw;
            let i = (y * w + x) * 4;
            for c in 0..3 {
                sums[cell][c] += rgba[i + c] as u64;
            }
            counts[cell] += 1;
        }
    }
    let mut out = Vec::with_capacity(LEN);
    for cell in 0..GRID * GRID {
        if counts[cell] > 0 {
            for c in 0..3 {
                out.push(((sums[cell][c] as f64) / (counts[cell] as f64)).round() as u8);
            }
        } else {
            // A crop narrower than 8 pixels leaves gaps: use the nearest pixel.
            let x = (x0 + ((cell % GRID) * cw + cw / 2) / GRID).min(w - 1);
            let y = (y0 + ((cell / GRID) * ch + ch / 2) / GRID).min(h - 1);
            let i = (y * w + x) * 4;
            out.extend_from_slice(&rgba[i..i + 3]);
        }
    }
    out
}

/// The same fingerprint for a `size`×`size` square whose top-left is (x, y) inside a larger
/// `w`×`h` image. Parts outside the image count as black.
pub fn fingerprint_in(rgba: &[u8], w: u32, h: u32, x: i32, y: i32, size: u32) -> Vec<u8> {
    let n = size as usize;
    let mut square = vec![0u8; n * n * 4];
    for row in 0..n {
        let sy = y + row as i32;
        if sy < 0 || sy >= h as i32 {
            continue;
        }
        for col in 0..n {
            let sx = x + col as i32;
            if sx < 0 || sx >= w as i32 {
                continue;
            }
            let src = ((sy as usize) * (w as usize) + sx as usize) * 4;
            let dst = (row * n + col) * 4;
            square[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    fingerprint(&square, size, size)
}

/// Puts semi-transparent pixels onto the slot background, as the game draws them.
pub fn blend_alpha(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as f32 / 255.0;
        for c in 0..3 {
            px[c] = (px[c] as f32 * a + SLOT_BG[c] * (1.0 - a)).round() as u8;
        }
        px[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: u32, h: u32, c: [u8; 4]) -> Vec<u8> {
        (0..w * h).flat_map(|_| c).collect()
    }

    #[test]
    fn fingerprint_of_solid_color() {
        let fp = fingerprint(&solid(40, 40, [10, 120, 200, 255]), 40, 40);
        assert_eq!(fp.len(), LEN);
        for cell in fp.chunks(3) {
            assert_eq!(cell, [10, 120, 200]);
        }
    }

    #[test]
    fn central_crop_ignores_corners() {
        let mut img = solid(40, 40, [50, 60, 70, 255]);
        // Stack counts and rarity borders live in the corners and edges: scribble over them.
        for y in 0..40u32 {
            for x in 0..40u32 {
                if x < 10 || x >= 30 || y < 10 || y >= 30 {
                    let i = ((y * 40 + x) * 4) as usize;
                    img[i] = (x * 7 % 255) as u8;
                    img[i + 1] = 255;
                    img[i + 2] = (y * 13 % 255) as u8;
                }
            }
        }
        assert_eq!(fingerprint(&img, 40, 40), fingerprint(&solid(40, 40, [50, 60, 70, 255]), 40, 40));
    }

    #[test]
    fn scaled_icon_matches_original() {
        // A 64×64 icon with some structure, then the same icon drawn at 40×40 as a small UI would.
        let icon = image::RgbaImage::from_fn(64, 64, |x, y| {
            let ring = ((x as i32 - 32).pow(2) + (y as i32 - 32).pow(2)) < 18 * 18;
            image::Rgba([(x * 4) as u8, if ring { 220 } else { 40 }, (y * 4) as u8, 255])
        });
        let small = image::imageops::resize(&icon, 40, 40, image::imageops::FilterType::Triangle);
        let a = fingerprint(icon.as_raw(), 64, 64);
        let b = fingerprint(small.as_raw(), 40, 40);
        let diff: u32 = a.iter().zip(&b).map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs()).sum();
        assert!(diff / (LEN as u32) < 12, "mean difference {}", diff / LEN as u32);
    }

    #[test]
    fn fingerprint_inside_a_larger_image_matches_a_crop() {
        let big = image::RgbaImage::from_fn(120, 90, |x, y| image::Rgba([(x * 2) as u8, (y * 3) as u8, ((x + y) % 255) as u8, 255]));
        let crop = image::imageops::crop_imm(&big, 30, 20, 44, 44).to_image();
        assert_eq!(fingerprint_in(big.as_raw(), 120, 90, 30, 20, 44), fingerprint(crop.as_raw(), 44, 44));
        // Hanging off the right edge: the missing part reads as black, and nothing panics.
        assert_eq!(fingerprint_in(big.as_raw(), 120, 90, 100, 60, 44).len(), LEN);
    }

    #[test]
    fn alpha_is_blended_onto_dark_slot() {
        let mut px = vec![255, 255, 255, 0, 200, 100, 0, 255, 255, 255, 255, 128];
        blend_alpha(&mut px);
        assert_eq!(&px[0..4], &[24, 24, 24, 255]);
        assert_eq!(&px[4..8], &[200, 100, 0, 255]);
        assert_eq!(&px[8..11], &[140, 140, 140]);
    }
}
