"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.panelHref = panelHref;
exports.useNavigateToPanel = useNavigateToPanel;
exports.usePrefetchPanel = usePrefetchPanel;
const navigation_1 = require("next/navigation");
const react_1 = require("react");
const navigation_metrics_1 = require("@/lib/navigation-metrics");
const store_1 = require("@/store");
function panelHref(panel) {
    return panel === 'overview' ? '/' : `/${panel}`;
}
const PREFETCHED_ROUTES = new Set();
const DEFAULT_PREFETCH_PANELS = [
    'overview',
    'chat',
    'tasks',
    'agents',
    'activity',
    'notifications',
    'tokens',
];
function safePrefetch(router, href) {
    if (PREFETCHED_ROUTES.has(href))
        return;
    PREFETCHED_ROUTES.add(href);
    router.prefetch(href);
}
function useNavigateToPanel() {
    const router = (0, navigation_1.useRouter)();
    const pathname = (0, navigation_1.usePathname)();
    const { setActiveTab, setChatPanelOpen } = (0, store_1.useMissionControl)();
    (0, react_1.useEffect)(() => {
        for (const panel of DEFAULT_PREFETCH_PANELS) {
            const href = panelHref(panel);
            if (href !== pathname)
                safePrefetch(router, href);
        }
    }, [pathname, router]);
    return (0, react_1.useCallback)((panel) => {
        const href = panelHref(panel);
        if (href === pathname)
            return;
        safePrefetch(router, href);
        (0, navigation_metrics_1.startNavigationTiming)(pathname, href);
        setActiveTab(panel === 'sessions' ? 'chat' : panel);
        if (panel === 'chat' || panel === 'sessions') {
            setChatPanelOpen(false);
        }
        (0, react_1.startTransition)(() => {
            router.push(href, { scroll: false });
        });
    }, [pathname, router, setActiveTab, setChatPanelOpen]);
}
function usePrefetchPanel() {
    const router = (0, navigation_1.useRouter)();
    return (0, react_1.useCallback)((panel) => {
        const href = panelHref(panel);
        safePrefetch(router, href);
    }, [router]);
}
