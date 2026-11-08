/** The interface choices kept with each account (by their key in the browser): theme, language and how boards are laid
 *  out. They follow the person to any device, and someone else signing in on the same browser gets their own. */
// How a board looks (background, label names, folded lists) is the board's own, set by its admins (server/boards.ts).
export const ACCOUNT_PREFS=['dms.theme','dms.lang','dms.panels','dms.driveView'];
