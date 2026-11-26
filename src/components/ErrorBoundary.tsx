import React from 'react';
import { getSafeErrorMessage } from '../utils/validation';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: getSafeErrorMessage(
        error,
        'An unexpected application error interrupted this screen. You can retry or return home safely.'
      ),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Dhruv Tales ErrorBoundary caught:', error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-screen bg-[#0B0B0E] text-[#F5F3EE] flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full rounded-2xl bg-[#141418] border border-white/10 p-6 sm:p-8 space-y-5">
            <p className="text-xs font-semibold text-[#E5A93C] uppercase tracking-wider">
              Dhruv Tales
            </p>
            <h1 className="font-display text-2xl font-semibold text-[#F5F3EE]">
              Something interrupted playback
            </h1>
            <p className="text-sm text-[#B2ADA2] leading-relaxed break-words">
              {this.state.message}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-5 rounded-xl bg-[#1C1C22] border border-white/15 text-[#F5F3EE] text-sm font-medium hover:border-white/30 transition-colors"
              >
                Reload App
              </button>
              <a
                href="/"
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-[#E5A93C] hover:text-[#F3C669] inline-flex items-center"
              >
                Return Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
