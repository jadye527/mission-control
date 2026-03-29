"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useFocusTrap = useFocusTrap;
const react_1 = require("react");
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');
/**
 * Traps keyboard focus within a container element.
 * Handles Tab/Shift+Tab cycling and Escape to close.
 */
function useFocusTrap(onClose) {
    const containerRef = (0, react_1.useRef)(null);
    const previousFocusRef = (0, react_1.useRef)(null);
    const handleKeyDown = (0, react_1.useCallback)((e) => {
        if (e.key === 'Escape' && onClose) {
            e.stopPropagation();
            onClose();
            return;
        }
        if (e.key !== 'Tab')
            return;
        const container = containerRef.current;
        if (!container)
            return;
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
        if (focusable.length === 0)
            return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        }
        else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, [onClose]);
    (0, react_1.useEffect)(() => {
        previousFocusRef.current = document.activeElement;
        const container = containerRef.current;
        if (container) {
            const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            var _a;
            document.removeEventListener('keydown', handleKeyDown);
            (_a = previousFocusRef.current) === null || _a === void 0 ? void 0 : _a.focus();
        };
    }, [handleKeyDown]);
    return containerRef;
}
