// Registers a set of hotkeys as one unit: if any key can't be had, none stay registered.
export async function registerAll(pairs, { register, unregister }) {
  const done = [];
  try {
    for (const [accel, ...handlers] of pairs) {
      await register(accel, ...handlers);
      done.push(accel);
    }
    return done;
  } catch (err) {
    for (const accel of done) await unregister(accel);
    throw err;
  }
}
