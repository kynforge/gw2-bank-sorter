// What loads at startup: the saved key's account, or the example. If the saved key no longer works,
// the example loads anyway so every panel has something to show, and the key's error stays on screen.
export async function boot({ savedKey, loadKey, loadExample }) {
  if (!savedKey) return loadExample();
  return (await loadKey(savedKey)) || loadExample({ keepStatus: true });
}
