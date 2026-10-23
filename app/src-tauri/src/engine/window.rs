//! Where the pointer is, and whether Guild Wars 2 is the window in front.

#[cfg(windows)]
pub fn cursor_pos() -> Result<(i32, i32), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.map_err(|e| format!("Couldn't read the pointer position: {e}"))?;
    Ok((p.x, p.y))
}

#[cfg(windows)]
pub fn foreground_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(GetForegroundWindow(), &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

pub const GAME_TITLE: &str = "Guild Wars 2";

/// Input only ever goes to the game: anything else in front and the command refuses.
pub fn require_game(title: &str) -> Result<(), String> {
    if title == GAME_TITLE {
        Ok(())
    } else {
        Err("Guild Wars 2 isn't the window in front, so nothing was done.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_needs_the_game_in_front() {
        assert!(require_game("Guild Wars 2").is_ok());
        assert!(require_game("GW2 Companion").is_err());
        assert!(require_game("").is_err());
        assert!(require_game("Guild Wars 2 - Notepad").is_err());
    }
}
