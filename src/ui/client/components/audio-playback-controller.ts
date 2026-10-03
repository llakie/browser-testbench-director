import { BrowserTestbenchPreview } from '../core/browser-testbench-preview.js';
import type { WorkspaceMethodMap } from './workspace-model.js';

export const audioPlaybackMethods: WorkspaceMethodMap = {
    refreshAudioPosition(): void {
        const audio = this.activeAudio;
        const playbackNodeId = this.instantAudioNodeId ?? audio?.id;

        if (!audio && !playbackNodeId) {
            this.audioPositionMs = 0;
            this.audioPlaybackActive = false;
            this.audioPaused = false;
            this.audioScrubbing = false;
            return;
        }

        const inputId = audio ? this.activeAudioInputId : null;
        const source = inputId ? this.inputData[inputId] : undefined;

        if (source && source !== this.audioDurationSource) {
            this.audioDurationSource = source;
            this.audioDurationMs = 0;
            void this.audioPlayback
                .duration(source, inputId)
                .then((duration: number) => {
                    if (this.audioDurationSource === source) {
                        this.audioDurationMs = duration;

                        if ((audio?.startOffsetMs ?? 0) > duration) {
                            void this.updateActiveAudioStartOffset();
                        }
                    }
                })
                .catch(() => undefined);
        } else if (!source && this.audioDurationSource) {
            this.audioDurationSource = '';
            this.audioDurationMs = 0;
        }

        const localPosition = playbackNodeId ? this.audioPlayback.position(playbackNodeId) : null;

        if (localPosition) {
            this.audioPlaybackActive = true;
            this.audioPaused = localPosition.paused;

            if (!this.audioScrubbing) {
                this.audioPositionMs = localPosition.positionMs;
            }

            return;
        }

        if (!this.executionRunning || !this.remotePreviewSessionId) {
            this.audioPlaybackActive = false;

            if (!this.instantAudioNodeId) {
                this.audioPaused = false;
            }

            if (!this.audioScrubbing) {
                this.audioPositionMs = 0;
            }
        }
    },
    async setActiveAudioPaused(paused: boolean): Promise<void> {
        const audio = this.activeAudio;

        if (!this.audioSeekEnabled || !audio || this.audioScrubbing) {
            return;
        }

        if (!paused) {
            this.audioPlayback.unlock();
        }

        this.audioPaused = paused;

        try {
            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.setAudioPaused(
                    this.remotePreviewSessionId,
                    audio.id,
                    paused,
                );
            } else if (paused) {
                this.audioPlayback.pause(audio.id);
            } else {
                this.audioPlayback.resume(audio.id);
            }

            this.audioPaused = paused;
            this.renderGraph();
        } catch (error) {
            this.audioPaused = !paused;
            this.renderGraph();
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
        }
    },
    async seekActiveAudio(milliseconds: number): Promise<void> {
        const audio = this.activeAudio;

        if (!this.audioSeekEnabled || !audio || !Number.isFinite(milliseconds)) {
            this.audioScrubbing = false;
            return;
        }

        const positionMs = Math.min(this.audioPlayableDurationMs, Math.max(0, milliseconds));
        this.audioPositionMs = positionMs;

        try {
            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.seekAudio(
                    this.remotePreviewSessionId,
                    audio.id,
                    positionMs / 1000,
                );
            } else {
                this.audioPlayback.seek(audio.id, positionMs / 1000);
            }
        } catch (error) {
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
        } finally {
            this.audioScrubbing = false;
        }
    },
    async updateActiveAudioStartOffset(): Promise<void> {
        const audio = this.activeAudio;

        if (!audio) {
            return;
        }

        const requestedOffset = Number(audio.startOffsetMs ?? 0);
        const maximumOffset = this.audioMaximumStartOffsetMs ?? requestedOffset;
        const normalizedOffset = Math.round(
            Math.min(
                maximumOffset,
                Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0),
            ),
        );
        audio.startOffsetMs = normalizedOffset;
        this.audioPositionMs = 0;
        this.markActiveNodeStale();

        if (!this.activeInstantAudio || !this.audioPaused || !this.audioPlaybackActive) {
            return;
        }

        this.audioScrubbing = true;

        try {
            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.setAudioStartOffset(
                    this.remotePreviewSessionId,
                    audio.id,
                    normalizedOffset / 1000,
                );
            } else {
                this.audioPlayback.setStartOffset(audio.id, normalizedOffset / 1000);
            }
        } catch (error) {
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
            await this.stopPlayback();
        } finally {
            this.audioPositionMs = 0;
            this.audioScrubbing = false;
        }
    },
    formatAudioTime(milliseconds: number): string {
        const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    },
    async stopPlaybackAudio(): Promise<void> {
        this.audioPlayback.cancel();
        const sessionId = this.remotePreviewSessionId;

        if (sessionId) {
            await BrowserTestbenchPreview.stopAudio(sessionId);
        }
    },
};
