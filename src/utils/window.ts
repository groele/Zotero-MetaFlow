// eslint-disable-next-line ts/no-use-before-define
export { isWindowAlive };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Cu.isDeadWrapper(win) && !win.closed;
}
