//! The macro's native side: what JavaScript can't do. Screen capture, icon decoding, mouse and
//! keyboard input, and checking which window has focus. Every action is one call per key press.

pub mod capture;
pub mod fingerprint;
pub mod icons;
pub mod input;
pub mod window;

#[cfg(windows)]
mod commands {
    use super::*;

    // Screen reads are small squares around bank slots; anything bigger isn't a slot check.
    const MAX_RECTS: usize = 400;
    const MAX_SIZE: i32 = 512;
    const MAX_REGION_RECTS: usize = 20_000;

    // Every input command checks for itself that the game is in front, whatever the page asked.
    fn game_in_front() -> Result<(), String> {
        window::require_game(&window::foreground_title())
    }

    async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn cursor_pos() -> Result<[i32; 2], String> {
        window::cursor_pos().map(|(x, y)| [x, y])
    }

    #[tauri::command]
    pub fn gw2_foreground() -> bool {
        game_in_front().is_ok()
    }

    /// Each rect is [centre x, centre y, slot size] in screen pixels.
    #[tauri::command]
    pub async fn screen_fingerprints(rects: Vec<[i32; 3]>) -> Result<Vec<Vec<u8>>, String> {
        if rects.len() > MAX_RECTS || rects.iter().any(|r| r[2] <= 0 || r[2] > MAX_SIZE) {
            return Err("That isn't a bank slot check.".into());
        }
        blocking(move || {
            rects.iter().map(|&[cx, cy, size]| {
                let rgba = capture::capture_rgba(cx - size / 2, cy - size / 2, size, size)?;
                Ok(fingerprint::fingerprint(&rgba, size as u32, size as u32))
            }).collect::<Result<Vec<_>, String>>()
        }).await?
    }

    /// Reads one region of the screen and fingerprints many slots inside it. Each rect is
    /// [centre x, centre y, size]; the answer is the fingerprints back to back, as raw bytes.
    #[tauri::command]
    pub async fn region_fingerprints(region: [i32; 4], rects: Vec<[i32; 3]>) -> Result<tauri::ipc::Response, String> {
        let [x, y, w, h] = region;
        if w <= 0 || h <= 0 || w > 8192 || h > 8192 || rects.len() > MAX_REGION_RECTS || rects.iter().any(|r| r[2] <= 0 || r[2] > MAX_SIZE) {
            return Err("That isn't a bank slot check.".into());
        }
        let bytes = blocking(move || -> Result<Vec<u8>, String> {
            let rgba = capture::capture_rgba(x, y, w, h)?;
            let mut out = Vec::with_capacity(rects.len() * fingerprint::LEN);
            for &[cx, cy, size] in &rects {
                out.extend(fingerprint::fingerprint_in(&rgba, w as u32, h as u32, cx - size / 2 - x, cy - size / 2 - y, size as u32));
            }
            Ok(out)
        }).await??;
        Ok(tauri::ipc::Response::new(bytes))
    }

    /// Icons are fetched eight at a time, so a whole bank's worth is ready in seconds.
    #[tauri::command]
    pub async fn icon_fingerprints(urls: Vec<String>) -> Result<Vec<Option<Vec<u8>>>, String> {
        blocking(move || {
            let mut out = vec![None; urls.len()];
            let chunk = urls.len().div_ceil(8).max(1);
            std::thread::scope(|scope| {
                for (part, slots) in urls.chunks(chunk).zip(out.chunks_mut(chunk)) {
                    scope.spawn(move || {
                        for (url, slot) in part.iter().zip(slots.iter_mut()) {
                            *slot = icons::icon_fingerprint(url).ok();
                        }
                    });
                }
            });
            out
        }).await
    }

    /// Whether the given hotkey's main key is held down right now.
    #[tauri::command]
    pub fn key_down(key: String) -> bool {
        window::vk_for(&key).map(window::key_down).unwrap_or(false)
    }

    /// The game window's [left, top, right, bottom], when it's in front.
    #[tauri::command]
    pub fn game_rect() -> Option<[i32; 4]> {
        window::game_rect()
    }

    #[tauri::command]
    pub async fn scroll(at: [i32; 2], ticks: i32, park: Option<[i32; 2]>) -> Result<(), String> {
        game_in_front()?;
        if ticks == 0 || ticks.abs() > 20 {
            return Err("That isn't a bank scroll.".into());
        }
        blocking(move || input::scroll((at[0], at[1]), ticks, park.map(|p| (p[0], p[1])))).await?
    }

    #[tauri::command]
    pub async fn drag(from: [i32; 2], to: [i32; 2], park: Option<[i32; 2]>) -> Result<(), String> {
        game_in_front()?;
        blocking(move || input::drag((from[0], from[1]), (to[0], to[1]), park.map(|p| (p[0], p[1])))).await?
    }

    #[tauri::command]
    pub async fn park_pointer(to: [i32; 2]) -> Result<(), String> {
        game_in_front()?;
        blocking(move || input::park((to[0], to[1]))).await?
    }

    #[tauri::command]
    pub async fn type_text(text: String) -> Result<(), String> {
        game_in_front()?;
        blocking(move || input::type_text(&text)).await?
    }
}

#[cfg(windows)]
pub use commands::*;
