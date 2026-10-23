//! Item icons from ArenaNet's render service, turned into fingerprints and kept for the session.

use super::fingerprint::{blend_alpha, fingerprint};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const ICON_HOST: &str = "https://render.guildwars2.com/";

fn cache() -> &'static Mutex<HashMap<String, Vec<u8>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn icon_fingerprint(url: &str) -> Result<Vec<u8>, String> {
    // Only ever fetch item icons, never an arbitrary address.
    if !url.starts_with(ICON_HOST) {
        return Err("Not an item icon address.".into());
    }
    if let Some(fp) = cache().lock().map_err(|_| "Icon cache unavailable")?.get(url) {
        return Ok(fp.clone());
    }
    let mut res = ureq::get(url).call().map_err(|e| format!("Couldn't download the icon: {e}"))?;
    let bytes = res.body_mut().read_to_vec().map_err(|e| format!("Couldn't read the icon: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("Couldn't decode the icon: {e}"))?;
    let mut rgba = img.to_rgba8();
    blend_alpha(&mut rgba);
    let fp = fingerprint(rgba.as_raw(), rgba.width(), rgba.height());
    cache().lock().map_err(|_| "Icon cache unavailable")?.insert(url.to_string(), fp.clone());
    Ok(fp)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Needs the network: cargo test -- --ignored
    #[test]
    #[ignore]
    fn downloads_and_fingerprints_a_real_icon() {
        let url = "https://render.guildwars2.com/file/18CE5D78317265000CF3C23ED76AB3CEE86BA60E/65941.png";
        let fp = icon_fingerprint(url).expect("icon");
        assert_eq!(fp.len(), crate::engine::fingerprint::LEN);
        assert!(fp.iter().any(|&v| v > 60), "the Glob of Ectoplasm icon isn't blank");
        assert_eq!(icon_fingerprint(url).unwrap(), fp, "second call comes from the cache");
    }

    #[test]
    fn refuses_other_hosts() {
        assert!(icon_fingerprint("https://example.com/a.png").is_err());
    }
}
