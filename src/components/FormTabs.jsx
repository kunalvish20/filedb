"use client";
import { useRef } from "react";
/**
 * Accessible tab rail for the FilamentForm. Replaces the old sticky TOC
 * sidebar: instead of one long scroll with a jump-list, each group of
 * sections lives on its own tab so only one group is visible at a time.
 *
 * The panels themselves stay mounted in the form (hidden via the `hidden`
 * attribute on the inactive ones) so native HTML5 constraint validation still
 * fires for required fields on tabs the user isn't looking at — the form's
 * `onInvalidCapture` handler then switches to the offending tab. Rendering
 * only the active panel would let the form submit with an empty required
 * field the browser never got to validate.
 *
 * Follows the WAI-ARIA tabs pattern with automatic activation: arrow keys
 * (and Home/End) move selection, and selection === focus.
 */
export default function FormTabs({ tabs, active, onChange, ariaLabel }) {
    const listRef = useRef(null);
    const focusTab = (id) => {
        onChange(id);
        // Move DOM focus to the newly-selected tab so keyboard navigation keeps
        // working and the roving tabindex stays consistent.
        requestAnimationFrame(() => {
            listRef.current
                ?.querySelector(`#tab-${CSS.escape(id)}`)
                ?.focus();
        });
    };
    const onKeyDown = (e, index) => {
        let next = index;
        switch (e.key) {
            case "ArrowRight":
            case "ArrowDown":
                next = (index + 1) % tabs.length;
                break;
            case "ArrowLeft":
            case "ArrowUp":
                next = (index - 1 + tabs.length) % tabs.length;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = tabs.length - 1;
                break;
            default:
                return;
        }
        e.preventDefault();
        focusTab(tabs[next].id);
    };
    return (<div ref={listRef} role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className="form-tabs flex gap-1 overflow-x-auto">
      {tabs.map((tab, i) => {
            const isActive = tab.id === active;
            return (<button key={tab.id} id={`tab-${tab.id}`} type="button" role="tab" aria-selected={isActive} aria-controls={`tabpanel-${tab.id}`} tabIndex={isActive ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={(e) => onKeyDown(e, i)} className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${isActive
                    ? "border-primary text-foreground dark:border-ring dark:text-foreground"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:border-border dark:hover:border-gray-600"}`}>
            {tab.label}
            {tab.badge}
          </button>);
        })}
    </div>);
}
