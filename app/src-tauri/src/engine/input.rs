//! Mouse and keyboard input through SendInput. One drag or one bit of typing per call.

/// Screen pixels to SendInput's 0–65535 range across the whole virtual desktop.
pub fn to_absolute(x: i32, y: i32, vx: i32, vy: i32, vw: i32, vh: i32) -> (i32, i32) {
    let scale = |p: i32, origin: i32, size: i32| (((p - origin) as i64 * 65535) / (size - 1).max(1) as i64).clamp(0, 65535) as i32;
    (scale(x, vx, vw), scale(y, vy, vh))
}

#[cfg(windows)]
mod native {
    use super::to_absolute;
    use std::{mem::size_of, thread::sleep, time::Duration};
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    const BLOCKED: &str = "Windows didn't accept the input. If Guild Wars 2 runs as administrator, run the companion as administrator too.";

    fn send(inputs: &[INPUT]) -> Result<(), String> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() { Ok(()) } else { Err(BLOCKED.into()) }
    }

    fn mouse(dx: i32, dy: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }

    fn key(unit: u16, up: bool) -> INPUT {
        let mut flags = KEYEVENTF_UNICODE;
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }

    fn move_to(x: i32, y: i32) -> Result<(), String> {
        let (vx, vy, vw, vh) = unsafe {
            (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN))
        };
        let (ax, ay) = to_absolute(x, y, vx, vy, vw, vh);
        send(&[mouse(ax, ay, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)])
    }

    /// Turns the mouse wheel over `at` (positive ticks scroll up), then rests the pointer at `park`.
    pub fn scroll(at: (i32, i32), ticks: i32, park: Option<(i32, i32)>) -> Result<(), String> {
        move_to(at.0, at.1)?;
        sleep(Duration::from_millis(40));
        let wheel = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: (ticks * 120) as _, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } },
        };
        let sent = send(&[wheel]);
        sleep(Duration::from_millis(250)); // let the bank window finish scrolling
        if let Some((x, y)) = park {
            let _ = move_to(x, y);
        }
        sent
    }

    /// Moves the pointer without clicking, e.g. off the bank so no item tooltip covers the slots.
    pub fn park(to: (i32, i32)) -> Result<(), String> {
        move_to(to.0, to.1)
    }

    /// Press on `from`, glide to `to`, release, then leave the pointer at `park` (or where it was).
    pub fn drag(from: (i32, i32), to: (i32, i32), park: Option<(i32, i32)>) -> Result<(), String> {
        let original = park.or_else(|| super::super::window::cursor_pos().ok());
        let pause = |ms| sleep(Duration::from_millis(ms));
        move_to(from.0, from.1)?;
        pause(40);
        send(&[mouse(0, 0, MOUSEEVENTF_LEFTDOWN)])?;
        pause(60);
        // Whatever happens while the button is down, it must come back up.
        let glide = (|| {
            for step in 1..=12 {
                let x = from.0 + (to.0 - from.0) * step / 12;
                let y = from.1 + (to.1 - from.1) * step / 12;
                move_to(x, y)?;
                pause(12);
            }
            pause(60);
            Ok::<(), String>(())
        })();
        let release = send(&[mouse(0, 0, MOUSEEVENTF_LEFTUP)]);
        pause(40);
        if let Some((x, y)) = original {
            let _ = move_to(x, y);
        }
        glide.and(release)
    }

    /// Types text as Unicode key presses. Never Enter: confirming is always the player's click.
    pub fn type_text(text: &str) -> Result<(), String> {
        if text.chars().any(|c| c.is_control()) {
            return Err("Refusing to type line breaks or control keys.".into());
        }
        for unit in text.encode_utf16() {
            send(&[key(unit, false), key(unit, true)])?;
            sleep(Duration::from_millis(15));
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use native::{drag, park, scroll, type_text};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_map_to_the_ends_of_the_range() {
        assert_eq!(to_absolute(0, 0, 0, 0, 1920, 1080), (0, 0));
        assert_eq!(to_absolute(1919, 1079, 0, 0, 1920, 1080), (65535, 65535));
    }

    #[test]
    fn a_monitor_left_of_the_main_one_still_maps_from_zero() {
        // Two 1920-wide screens, the left one at x = -1920.
        assert_eq!(to_absolute(-1920, 0, -1920, 0, 3840, 1080), (0, 0));
        assert_eq!(to_absolute(3839 - 1920, 1079, -1920, 0, 3840, 1080), (65535, 65535));
        let (mid, _) = to_absolute(0, 0, -1920, 0, 3840, 1080);
        // x = 0 is pixel 1920 of 0..3839: 1920 / 3839 × 65535 ≈ 32776.
        assert_eq!(mid, 32776);
    }
}
