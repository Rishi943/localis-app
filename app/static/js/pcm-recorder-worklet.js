// app/static/js/pcm-recorder-worklet.js
// AudioWorkletProcessor: forwards raw Float32 PCM frames to the main thread.
// Runs in the AudioWorklet rendering thread at the AudioContext sample rate.
// The main thread resamples to 16kHz if needed before WAV encoding.

class PcmRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._active = true;
        this.port.onmessage = (e) => {
            if (e.data === 'stop') this._active = false;
        };
    }

    process(inputs) {
        if (!this._active) return false;  // Returning false removes the node
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            // Slice to own the buffer (avoid shared backing store issues)
            this.port.postMessage(input[0].slice());
        }
        return true;  // Keep processor alive
    }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor);
