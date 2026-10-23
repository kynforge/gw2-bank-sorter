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

/// The Windows virtual-key code for the main key of a hotkey like "F8" or "CommandOrControl+Shift+G".
pub fn vk_for(accel: &str) -> Option<u16> {
    let key = accel.rsplit('+').next()?.trim();
    if let Some(n) = key.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
        return (1..=24).contains(&n).then(|| 0x6F + n);
    }
    match key {
        "Home" => Some(0x24),
        "End" => Some(0x23),
        "Insert" => Some(0x2D),
        "Delete" => Some(0x2E),
        "PageUp" => Some(0x21),
        "PageDown" => Some(0x22),
        "Space" => Some(0x20),
        k if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) => Some(k.to_ascii_uppercase().as_bytes()[0] as u16),
        _ => None,
    }
}

/// Whether a key is held down right now (for hold-to-run).
#[cfg(windows)]
pub fn key_down(vk: u16) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0
}

/// The game window's rectangle on screen, when it's the window in front.
#[cfg(windows)]
pub fn game_rect() -> Option<[i32; 4]> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};
    require_game(&foreground_title()).ok()?;
    let mut r = RECT::default();
    unsafe { GetWindowRect(GetForegroundWindow(), &mut r) }.ok()?;
    Some([r.left, r.top, r.right, r.bottom])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkeys_map_to_key_codes() {
        assert_eq!(vk_for("F8"), Some(0x77));
        assert_eq!(vk_for("F1"), Some(0x70));
        assert_eq!(vk_for("F24"), Some(0x87));
        assert_eq!(vk_for("CommandOrControl+Shift+G"), Some(b'G' as u16));
        assert_eq!(vk_for("Alt+7"), Some(b'7' as u16));
        assert_eq!(vk_for("PageDown"), Some(0x22));
        assert_eq!(vk_for("F99"), None);
        assert_eq!(vk_for(""), None);
    }

    #[test]
    fn input_needs_the_game_in_front() {
        assert!(require_game("Guild Wars 2").is_ok());
        assert!(require_game("GW2 Companion").is_err());
        assert!(require_game("").is_err());
        assert!(require_game("Guild Wars 2 - Notepad").is_err());
    }
}
