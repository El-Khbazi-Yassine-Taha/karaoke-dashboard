import '../css/app.css';
import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import ErrorBoundary from './Components/ErrorBoundary';

const appName = import.meta.env.VITE_APP_NAME || 'WAW Karaoke';

createInertiaApp({
    title: (title) => (title ? `${title} · ${appName}` : appName),
    resolve: (name) =>
        resolvePageComponent(`./Pages/${name}.jsx`, import.meta.glob('./Pages/**/*.jsx')),
    setup({ el, App, props }) {
        createRoot(el).render(
            <ErrorBoundary
                label="App"
                fallback={({ message, reload }) => (
                    <div className="flex min-h-screen items-center justify-center bg-[#FFD000] p-6">
                        <div className="w-full max-w-md rounded-2xl border-2 border-black bg-[#FFFDF5] p-6 shadow-[4px_4px_0_#000]">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8A7400]">
                                WAW Karaoke
                            </p>
                            <h1 className="mt-1 text-xl font-black text-[#111]">Desk needs a refresh</h1>
                            <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
                                A screen error was caught so the page did not stay blank.
                            </p>
                            <p className="mt-1 text-xs text-[#6B6B6B]">{message}</p>
                            <button
                                type="button"
                                onClick={reload}
                                className="mt-4 rounded-xl border-2 border-black bg-[#FFD400] px-4 py-2.5 text-sm font-black text-black"
                            >
                                Reload desk
                            </button>
                        </div>
                    </div>
                )}
            >
                <App {...props} />
            </ErrorBoundary>
        );
    },
    progress: {
        color: '#FFD400',
        delay: 80,
        includeCSS: true,
    },
});
