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

    #[tauri::command]
    pub async fn icon_fingerprints(urls: Vec<String>) -> Result<Vec<Option<Vec<u8>>>, String> {
        blocking(move || urls.iter().map(|u| icons::icon_fingerprint(u).ok()).collect()).await
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
