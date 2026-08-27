"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whyNot = exports.SHAPING = exports.noteAllowed = exports.can = void 0;
exports.post = post;
exports.onSpace = onSpace;
/**
 * The postMessage bridge. The webview accepts exactly the session's
 * registered actions and renders exactly what the host pushes — no state
 * of its own beyond selection.
 *
 * What the two sides agree on — the push, the actions, and which of them
 * the phase governs — lives in the host's tree and is re-exported here, so
 * the surface's files import it from one place and the contract has one
 * home. What stays here is what only a webview has: the vscode api handle
 * and the window listener.
 */
const surfaceContract_1 = require("../../../src/surfaces/surfaceContract");
var surfaceContract_2 = require("../../../src/surfaces/surfaceContract");
Object.defineProperty(exports, "can", { enumerable: true, get: function () { return surfaceContract_2.can; } });
Object.defineProperty(exports, "noteAllowed", { enumerable: true, get: function () { return surfaceContract_2.noteAllowed; } });
Object.defineProperty(exports, "SHAPING", { enumerable: true, get: function () { return surfaceContract_2.SHAPING; } });
Object.defineProperty(exports, "whyNot", { enumerable: true, get: function () { return surfaceContract_2.whyNot; } });
const api = typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => { } };
function post(msg) {
    if (!(0, surfaceContract_1.can)(msg.action))
        return;
    api.postMessage(msg);
}
function onSpace(handler) {
    const listener = (ev) => {
        const data = ev.data;
        if (data && data.kind === "space") {
            if (Array.isArray(data.allowed))
                (0, surfaceContract_1.noteAllowed)(data.allowed);
            handler(data);
        }
    };
    window.addEventListener("message", listener);
    api.postMessage({ action: "load" });
    return () => window.removeEventListener("message", listener);
}
//# sourceMappingURL=vscode.js.map