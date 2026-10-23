//! Reads a square of the screen as RGBA, through GDI. Works for windowed and windowed fullscreen games.

#[cfg(windows)]
pub fn capture_rgba(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
    use std::mem::size_of;
    use windows::Win32::Graphics::Gdi::*;
    if w <= 0 || h <= 0 {
        return Err("Nothing to capture.".into());
    }
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("Couldn't read the screen.".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // negative: rows top to bottom
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, h as u32, Some(buf.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        copied.map_err(|e| format!("Couldn't copy the screen: {e}"))?;
        if lines == 0 {
            return Err("Couldn't read the screen pixels.".into());
        }
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
            px[3] = 255;
        }
        Ok(buf)
    }
}

#[cfg(all(test, windows))]
mod tests {
    // Needs a desktop session: cargo test -- --ignored
    #[test]
    #[ignore]
    fn captures_a_square_of_the_screen() {
        let px = super::capture_rgba(0, 0, 32, 32).expect("capture");
        assert_eq!(px.len(), 32 * 32 * 4);
        assert!(px.chunks(4).all(|p| p[3] == 255));
    }
}
