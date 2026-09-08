export function setupDemo() {
    const input = document.querySelector('#demoText');
    const keys = document.querySelector('#previewKeys');
    const toggle = document.querySelector('#demoToggle');
    const status = document.querySelector('#demoStatus');
    const volume = document.querySelector('#demoVolume');
    if (!input || !keys || !toggle || !status || !volume)
        return;
    input.readOnly = false;
    toggle.disabled = false;
    volume.disabled = false;
    document.querySelectorAll('[data-tone]').forEach((button) => {
        button.disabled = false;
    });
    let enabled = false;
    let tone = 'soft';
    let context = null;
    const active = new Set();
    const timers = new Map();
    function stop() {
        for (const source of active) {
            try {
                source.stop();
            }
            catch {
                /* Already ended. */
            }
        }
        active.clear();
    }
    async function sound(code) {
        const key = keys.querySelector(`[data-code="${code}"]`);
        if (key) {
            key.classList.add('is-pressed');
            clearTimeout(timers.get(key));
            timers.set(key, window.setTimeout(() => {
                key.classList.remove('is-pressed');
                timers.delete(key);
            }, 120));
        }
        if (!enabled || !context || document.hidden)
            return;
        try {
            if (context.state === 'suspended')
                await context.resume();
            if (!enabled || document.hidden)
                return;
            const duration = tone === 'deep' ? 0.075 : 0.045;
            const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
            const samples = buffer.getChannelData(0);
            for (let i = 0; i < samples.length; i++)
                samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (samples.length * 0.18));
            const source = context.createBufferSource();
            source.buffer = buffer;
            const filter = context.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = tone === 'soft' ? 950 : tone === 'crisp' ? 3500 : 280;
            filter.Q.value = tone === 'deep' ? 1.8 : 0.8;
            const gain = context.createGain();
            gain.gain.value = (Math.min(100, Math.max(0, Number(volume.value) || 0)) / 100) * 0.28;
            source.connect(filter);
            filter.connect(gain);
            gain.connect(context.destination);
            if (active.size >= 12) {
                const oldest = active.values().next().value;
                if (oldest) {
                    active.delete(oldest);
                    oldest.stop();
                }
            }
            active.add(source);
            source.onended = () => {
                active.delete(source);
                source.disconnect();
                filter.disconnect();
                gain.disconnect();
            };
            source.start();
        }
        catch {
            enabled = false;
            toggle.setAttribute('aria-pressed', 'false');
            toggle.textContent = 'Enable sound';
            status.textContent = 'Sound is unavailable in this browser. The desktop downloads still work.';
        }
    }
    for (const row of ['QWERT', 'ASDFG', 'ZXCVB', ' ']) {
        const element = document.createElement('div');
        element.className = 'key-row';
        for (const character of row) {
            const key = document.createElement('button');
            key.type = 'button';
            key.className = character === ' ' ? 'key space' : 'key';
            const code = character === ' ' ? 'Space' : `Key${character}`;
            key.dataset.code = code;
            key.textContent = character === ' ' ? 'SPACE' : character;
            key.setAttribute('aria-label', `Preview ${character === ' ' ? 'space' : character} key`);
            key.addEventListener('click', () => {
                void sound(code);
            });
            element.append(key);
        }
        keys.append(element);
    }
    toggle.addEventListener('click', () => {
        void (async () => {
            try {
                if (!enabled) {
                    context ??= new AudioContext();
                    await context.resume();
                }
                enabled = !enabled;
                if (!enabled)
                    stop();
                toggle.setAttribute('aria-pressed', String(enabled));
                toggle.textContent = enabled ? 'Mute preview' : 'Enable sound';
                document.querySelector('#experience').dataset.enabled = String(enabled);
                status.textContent = enabled
                    ? 'Ready. Type above or tap a key to hear the preview.'
                    : 'Sound is off. Turn it on, then type or tap a key.';
            }
            catch {
                status.textContent = 'Audio could not start. Try another browser, or explore the desktop app.';
            }
        })();
    });
    input.addEventListener('keydown', (event) => {
        if (!event.repeat &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            (event.key.length === 1 || event.key === 'Backspace'))
            void sound(/^[A-Za-z0-9]+$/.test(event.code) ? event.code : 'Space');
    });
    document.querySelectorAll('[data-tone]').forEach((button) => button.addEventListener('click', () => {
        tone = button.dataset.tone;
        document
            .querySelectorAll('[data-tone]')
            .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    }));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stop();
            void context?.suspend().catch(() => undefined);
        }
    });
    window.addEventListener('pagehide', () => {
        enabled = false;
        stop();
        for (const timer of timers.values())
            clearTimeout(timer);
        timers.clear();
        keys.querySelectorAll('.is-pressed').forEach((key) => key.classList.remove('is-pressed'));
        toggle.setAttribute('aria-pressed', 'false');
        toggle.textContent = 'Enable sound';
        document.querySelector('#experience').dataset.enabled = 'false';
        status.textContent = 'Sound is off. Turn it on, then type or tap a key.';
        void context?.close().catch(() => undefined);
        context = null;
    });
}
