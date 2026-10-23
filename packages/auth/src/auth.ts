/**
 * `@astroid/auth` — HTTP-client session wiring.
 *
 * The implementation lives in `./session.js` alongside the
 * {@link SessionManager} it cooperates with, so the middleware and the
 * manager can never drift apart. This module re-exports those helpers under
 * their historical module path.
 *
 * @module
 */

export { wireSessionToHttpClient, createSessionMiddleware } from './session.js';
