import { Component } from 'react';

/**
 * Catches render crashes so the desk never goes fully blank (yellow screen).
 * Failed sections show a recovery panel; the rest of the UI keeps working.
 */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            message: error?.message ? String(error.message) : 'Unknown error',
        };
    }

    componentDidCatch(error, info) {
        console.error('[WAW ErrorBoundary]', error, info?.componentStack);
    }

    handleRetry = () => {
        this.setState({ hasError: false, message: '' });
        if (typeof this.props.onReset === 'function') {
            this.props.onReset();
        }
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback({
                    message: this.state.message,
                    retry: this.handleRetry,
                    reload: this.handleReload,
                });
            }

            return (
                <div className="rounded-2xl border-2 border-black bg-[#FFFDF5] p-5 shadow-[3px_3px_0_#000]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#8A7400]">
                        {this.props.label || 'Section error'}
                    </p>
                    <p className="mt-1 text-base font-black text-[#111]">
                        Something went wrong here — the rest of the desk is still usable.
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#6B6B6B]">{this.state.message}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={this.handleRetry} className="btn-waw">
                            Try again
                        </button>
                        <button type="button" onClick={this.handleReload} className="btn-waw-ghost">
                            Reload page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
