// --- IndexedDB & Sync Setup ---
const dbPromise = idb.openDB('breatherbro-db', 2, {
    upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
            db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
            db.createObjectStore('syncQueue', { autoIncrement: true });
        }
    },
});

const API_BASE = 'http://localhost:3001/api';

async function saveSessionLocal(session) {
    const db = await dbPromise;
    await db.put('sessions', session);
    await db.add('syncQueue', session); // Queue for backend sync
    if (navigator.onLine) {
        syncToServer();
    }
}

async function syncToServer() {
    if (!navigator.onLine) return;
    const db = await dbPromise;
    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    let cursor = await store.openCursor();

    while (cursor) {
        const session = cursor.value;
        const key = cursor.key;
        try {
            const res = await fetch(`${API_BASE}/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(session)
            });
            if (res.ok) {
                const delTx = db.transaction('syncQueue', 'readwrite');
                await delTx.store.delete(key);
                await delTx.done;
            }
        } catch (e) {
            console.warn("Sync failed, will retry later.", e);
            break;
        }
        cursor = await cursor.continue();
    }
}
window.addEventListener('online', syncToServer);

// --- App State & Gamification ---
const State = {
    current_screen: 'screen-home',
    session_minutes: 3,
    active_exercise: 'box',

    is_running: false,
    time_remaining: 3 * 60,
    phase_index: 0,
    phase_time_remaining: 0,
    phases: [],

    voice_volume: 0.8,
    music_volume: 0.5,

    total_sessions: parseInt(localStorage.getItem('total_sessions') || 0),
    total_minutes: parseInt(localStorage.getItem('total_minutes') || 0),
    max_hold: parseInt(localStorage.getItem('max_hold') || 0),

    setting_voice: localStorage.getItem('setting_voice') !== '0',
    setting_nature: localStorage.getItem('setting_nature') !== '0',
    setting_haptic: localStorage.getItem('setting_haptic') !== '0',
    setting_theme: localStorage.getItem('setting_theme') || 'teal',
    setting_music: localStorage.getItem('setting_music') || 'nature',

    total_xp: parseInt(localStorage.getItem('total_xp') || 0),
    streak_days: parseInt(localStorage.getItem('streak_days') || 0),
    last_active: localStorage.getItem('last_active') || ''
};

function evaluateStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (!State.last_active) {
        State.streak_days = 1;
        State.last_active = today;
    } else if (State.last_active !== today) {
        const lastDt = new Date(State.last_active);
        const currDt = new Date(today);
        const diffTime = currDt.getTime() - lastDt.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));

        if (diffDays === 1) {
            State.streak_days += 1;
        } else if (diffDays > 1) {
            State.streak_days = 1;
        }
        State.last_active = today;
        saveStats();
    }
}
evaluateStreak();

function saveStats() {
    localStorage.setItem('total_sessions', State.total_sessions);
    localStorage.setItem('total_minutes', State.total_minutes);
    localStorage.setItem('max_hold', State.max_hold);
    localStorage.setItem('setting_voice', State.setting_voice ? '1' : '0');
    localStorage.setItem('setting_nature', State.setting_nature ? '1' : '0');
    localStorage.setItem('setting_haptic', State.setting_haptic ? '1' : '0');
    localStorage.setItem('setting_theme', State.setting_theme);
    localStorage.setItem('setting_music', State.setting_music);
    localStorage.setItem('total_xp', State.total_xp);
    localStorage.setItem('streak_days', State.streak_days);
    localStorage.setItem('last_active', State.last_active);
}

function getLevel() {
    const level = Math.floor(Math.sqrt(State.total_xp / 100)) + 1;
    const prevReq = (level - 1) * (level - 1) * 100;
    const currentLvlXp = State.total_xp - prevReq;
    const nextReqTotal = level * level * 100;
    const currentBracketSize = nextReqTotal - prevReq;
    return { level, currentBracketSize, currentLvlXp };
}

// --- DOM Helpers ---
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function renderStats() {
    setText("stat-sessions", State.total_sessions);
    setText("stat-minutes", State.total_minutes);
    setText("stat-max-hold", `${State.max_hold}s`);

    const { level, currentBracketSize, currentLvlXp } = getLevel();
    setText("home-level-badge", `Lvl ${level}`);
    setText("home-streak-badge", `🔥 ${State.streak_days}`);
    setText("stat-level", `Level ${level}`);
    setText("stat-xp", `${currentLvlXp} / ${currentBracketSize} XP to next level`);

    const fill = document.getElementById("stat-xp-fill");
    if (fill) {
        const pct = (currentLvlXp / currentBracketSize) * 100;
        fill.style.width = `${pct}%`;
    }
}
renderStats();

function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
}
applyTheme(State.setting_theme);

function switchScreen(target) {
    if (State.current_screen === 'screen-exercise' && target !== 'screen-exercise') {
        State.is_running = false;
        setText("btn-toggle-engine", "Start");
        controlAudio(false, State.music_volume, State.setting_music);
        window.speechSynthesis.cancel();
    }

    document.getElementById(State.current_screen)?.classList.remove('active');
    const newScreen = document.getElementById(target);
    if (newScreen) newScreen.classList.add('active');
    State.current_screen = target;

    // Tab Bar Updates
    ['tab-home', 'tab-custom', 'tab-progress'].forEach(tabId => {
        const t = document.getElementById(tabId);
        if (!t) return;
        if (target.includes(tabId.substring(4))) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });

    if (target === 'screen-progress' || target === 'screen-home') {
        renderStats();
    }
}

// --- Audio & Media ---
// Speech Synthesis
function speak(text) {
    if (!State.setting_voice || State.voice_volume <= 0) return;
    window.speechSynthesis.cancel();
    const utf8Str = new SpeechSynthesisUtterance(text);
    utf8Str.volume = State.voice_volume;
    utf8Str.rate = 0.85;
    window.speechSynthesis.speak(utf8Str);
}

// Custom Audio Synth Port
window.natureAudio = new Audio('https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=ambient-piano-amp-strings-10711.mp3');
window.natureAudio.loop = true;
window.audioCtx = null;
window.activeNodes = [];

function controlAudio(play, volume, audioType) {
    if (!State.setting_nature) { play = false; }

    if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (window.audioCtx.state === 'suspended' && play) window.audioCtx.resume();

    if (audioType === 'nature') {
        window.natureAudio.volume = volume;
        if (play) window.natureAudio.play().catch(console.error);
        else window.natureAudio.pause();
    } else {
        window.natureAudio.pause();
    }

    // Stop prev synth
    while (window.activeNodes.length > 0) {
        let node = window.activeNodes.pop();
        try { node.stop(); } catch (e) { }
        try { node.disconnect(); } catch (e) { }
    }

    if (!play || audioType === 'nature') return;

    let bufferSize = window.audioCtx.sampleRate * 2;
    let buffer = window.audioCtx.createBuffer(1, bufferSize, window.audioCtx.sampleRate);
    let data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; }

    let noise = window.audioCtx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    let filter = window.audioCtx.createBiquadFilter();
    let gainNode = window.audioCtx.createGain();

    if (audioType === 'waterfall') {
        filter.type = 'lowpass'; filter.frequency.value = 400; gainNode.gain.value = volume * 0.8;
    } else if (audioType === 'rain') {
        filter.type = 'bandpass'; filter.frequency.value = 800; filter.Q.value = 0.5; gainNode.gain.value = volume * 1.5;
    } else if (audioType === 'ocean') {
        filter.type = 'lowpass'; filter.frequency.value = 300; gainNode.gain.value = volume * 0.2;
        let lfo = window.audioCtx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.15;
        let lfoGain = window.audioCtx.createGain(); lfoGain.gain.value = volume * 0.8;
        lfo.connect(lfoGain); lfoGain.connect(gainNode.gain); lfo.start();
        window.activeNodes.push(lfo, lfoGain);
    } else if (audioType === 'focus') {
        filter.type = 'bandpass'; filter.frequency.value = 150; filter.Q.value = 2.0; gainNode.gain.value = volume;
    }

    noise.connect(filter); filter.connect(gainNode); gainNode.connect(window.audioCtx.destination);
    noise.start();
    window.activeNodes.push(noise, filter, gainNode);
}

function spawnConfetti() {
    let canvas = document.getElementById("confetti-canvas");
    if (canvas) {
        let ctx = canvas.getContext("2d");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        let particles = [];
        for (let i = 0; i < 80; i++) {
            particles.push({
                x: canvas.width / 2, y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 1.0) * 15,
                c: `hsl(${Math.random() * 360}, 100%, 50%)`,
                s: Math.random() * 8 + 4
            });
        }
        let draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let active = false;
            for (let p of particles) {
                p.x += p.vx; p.y += p.vy; p.vy += 0.5;
                if (p.y < canvas.height) active = true;
                ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s);
            }
            if (active) requestAnimationFrame(draw);
            else ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
        draw();
    }
}

// --- Dynamic Dynamic Greeting ---
const hours = new Date().getHours();
let greeting = "Good evening.";
if (hours >= 5 && hours < 12) greeting = "Good morning.";
else if (hours >= 12 && hours < 17) greeting = "Good afternoon.";
setText("greeting-text", greeting);

// --- User Interaction Bindings ---
// Tabs
['tab-home', 'tab-custom', 'tab-progress'].forEach(tabId => {
    document.getElementById(tabId)?.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-target');
        switchScreen(target);
    });
});

// Settings
document.getElementById('btn-settings')?.addEventListener('click', () => {
    document.getElementById('sett-voice').checked = State.setting_voice;
    document.getElementById('sett-nature').checked = State.setting_nature;
    document.getElementById('sett-haptic').checked = State.setting_haptic;
    document.getElementById('sett-theme').value = State.setting_theme;
    document.getElementById('sett-music').value = State.setting_music;
    switchScreen('screen-settings');
});

document.getElementById('btn-close-settings')?.addEventListener('click', () => {
    State.setting_voice = document.getElementById('sett-voice').checked;
    State.setting_nature = document.getElementById('sett-nature').checked;
    State.setting_haptic = document.getElementById('sett-haptic').checked;

    const newTheme = document.getElementById('sett-theme').value;
    const newMusic = document.getElementById('sett-music').value;

    let themeChanged = newTheme !== State.setting_theme;
    let musicChanged = newMusic !== State.setting_music;

    State.setting_theme = newTheme;
    State.setting_music = newMusic;

    saveStats();
    if (themeChanged) applyTheme(State.setting_theme);
    if (musicChanged) controlAudio(State.is_running, State.music_volume, State.setting_music);

    switchScreen('screen-home');
});

// Duration Stepper
document.getElementById('dur-plus')?.addEventListener('click', () => {
    if (State.session_minutes < 15) State.session_minutes += 1;
    setText("dur-value", `${State.session_minutes}m`);
});
document.getElementById('dur-minus')?.addEventListener('click', () => {
    if (State.session_minutes > 1) State.session_minutes -= 1;
    setText("dur-value", `${State.session_minutes}m`);
});

// Clear Stats
document.getElementById('btn-clear-stats')?.addEventListener('click', () => {
    State.total_sessions = 0; State.total_minutes = 0; State.max_hold = 0;
    saveStats();
    renderStats();
});

// Generate Phase Data Map
function loadSequence() {
    State.phases = [];
    switch (State.active_exercise) {
        case 'box': State.phases = [{ n: 'Inhale', d: 4, s: 1.5 }, { n: 'Hold', d: 4, s: 1.5 }, { n: 'Exhale', d: 4, s: 1 }, { n: 'Hold', d: 4, s: 1 }]; break;
        case '478': State.phases = [{ n: 'Inhale', d: 4, s: 1.5 }, { n: 'Hold', d: 7, s: 1.5 }, { n: 'Exhale', d: 8, s: 1 }]; break;
        case 'equal': State.phases = [{ n: 'Inhale', d: 4, s: 1.5 }, { n: 'Exhale', d: 4, s: 1 }]; break;
        case 'hold': State.phases = [{ n: 'Inhale', d: 4, s: 1.5 }, { n: 'Hold', d: 9999, s: 1.5 }]; break;
        case 'custom':
            const inv = parseFloat(document.getElementById('inp-inhale').value) || 0;
            const thv = parseFloat(document.getElementById('inp-topHold').value) || 0;
            const exv = parseFloat(document.getElementById('inp-exhale').value) || 0;
            const bhv = parseFloat(document.getElementById('inp-bottomHold').value) || 0;
            if (inv > 0) State.phases.push({ n: 'Inhale', d: inv, s: 1.5 });
            if (thv > 0) State.phases.push({ n: 'Hold', d: thv, s: 1.5 });
            if (exv > 0) State.phases.push({ n: 'Exhale', d: exv, s: 1 });
            if (bhv > 0) State.phases.push({ n: 'Hold', d: bhv, s: 1 });
            if (State.phases.length === 0) State.phases = [{ n: 'Inhale', d: 4, s: 1.5 }, { n: 'Exhale', d: 4, s: 1 }];
            break;
    }
    State.phase_index = 0;
    State.phase_time_remaining = State.phases[0].d;
}

// Exercise Cards Navigation
['card-box', 'card-478', 'card-equal', 'card-hold'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
        State.active_exercise = e.currentTarget.getAttribute('data-type');
        setupExerciseScreen();
    });
});
document.getElementById('btn-start-custom')?.addEventListener('click', () => {
    State.active_exercise = 'custom';
    setupExerciseScreen();
});

function setupExerciseScreen() {
    switchScreen('screen-exercise');
    State.time_remaining = State.session_minutes * 60;
    setText("session-timer", `${State.session_minutes}:00`);
    setText("phase-label", "Ready");
    setText("countdown-text", "Ready");
    const circle = document.getElementById("breathing-circle");
    if (circle) {
        circle.style.transform = "scale(1)";
        circle.style.transition = "none";
    }
    document.getElementById("btn-share").style.display = "none";
}

document.getElementById('btn-back')?.addEventListener('click', () => {
    State.is_running = false;
    setText("btn-toggle-engine", "Start");
    controlAudio(false, State.music_volume, State.setting_music);
    window.speechSynthesis.cancel();
    switchScreen("screen-home");
});

// Sliders Drag Logic
function attachSlider(sliderId, fillId, isVoice) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;

    function updateVal(e) {
        let clientY;
        if (e.type.startsWith('touch')) {
            clientY = e.touches[0].clientY;
        } else {
            if (e.buttons !== 1) return;
            clientY = e.clientY;
        }

        const rect = slider.getBoundingClientRect();
        let pct = (rect.bottom - clientY) / rect.height;
        pct = Math.max(0, Math.min(1, pct));

        document.getElementById(fillId).style.height = `${pct * 100}%`;

        if (isVoice) {
            State.voice_volume = pct;
        } else {
            State.music_volume = pct;
            if (State.is_running) controlAudio(true, State.music_volume, State.setting_music);
        }
    }

    // Mouse events
    slider.addEventListener('mousemove', updateVal);
    slider.addEventListener('mousedown', updateVal);

    // Touch events
    slider.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault();
        updateVal(e);
    }, { passive: false });

    slider.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        updateVal(e);
    }, { passive: false });
}
attachSlider("slider-voice", "fill-voice", true);
attachSlider("slider-music", "fill-music", false);

// Share
document.getElementById('btn-share')?.addEventListener('click', () => {
    const { level } = getLevel();
    const text = `I just finished a breathing session with BreatherBro! I'm on a ${State.streak_days} day streak and reached Level ${level}! 🔥 Zen out with me.`;
    if (navigator.share) {
        navigator.share({ title: 'BreatherBro', text }).catch(console.error);
    } else {
        navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
    }
});

// Engine Loop
let lastTime = 0;
function engineLoop(time) {
    const dt = lastTime === 0 ? 0 : (time - lastTime) / 1000;
    lastTime = time;

    if (State.is_running) {
        State.time_remaining -= dt;
        State.phase_time_remaining -= dt;

        let t = Math.max(0, State.time_remaining) | 0;
        let mins = t / 60 | 0;
        let secs = t % 60;
        setText("session-timer", `${mins}:${secs.toString().padStart(2, '0')}`);

        let phaseSecs = Math.ceil(State.phase_time_remaining);
        setText("countdown-text", phaseSecs);

        const currentPhase = State.phases[State.phase_index];
        setText("phase-label", currentPhase.n);

        const circle = document.getElementById("breathing-circle");
        if (circle) {
            circle.style.transition = `transform ${currentPhase.d}s linear`;
            circle.style.transform = `scale(${currentPhase.s})`;
        }

        // Phase End Transition
        if (State.phase_time_remaining <= 0) {
            // Check Hold max
            if (State.active_exercise === 'hold' && currentPhase.n === 'Hold') {
                let holdTime = (9999 - State.phase_time_remaining) | 0;
                if (holdTime > State.max_hold) State.max_hold = holdTime;
            }

            State.phase_index = (State.phase_index + 1) % State.phases.length;
            const nextPhase = State.phases[State.phase_index];
            State.phase_time_remaining = nextPhase.d;

            if (State.setting_haptic && navigator.vibrate) {
                navigator.vibrate(50);
            }
            speak(nextPhase.n);
        }

        // Session Complete
        if (State.time_remaining <= 0) {
            State.is_running = false;
            setText("btn-toggle-engine", "Start");
            setText("phase-label", "Session Complete");
            setText("countdown-text", "✨");

            State.total_sessions += 1;
            State.total_minutes += State.session_minutes;
            State.total_xp += State.session_minutes * 50; // 50 xp per min
            saveStats();
            renderStats();
            spawnConfetti();

            document.getElementById("btn-share").style.display = "block";
            controlAudio(false, State.music_volume, State.setting_music);
            speak("Session complete. Great job.");

            if (circle) {
                circle.style.transition = "transform 1s ease";
                circle.style.transform = "scale(1)";
            }

            // Sync to backend DB!
            const sessionData = {
                id: crypto.randomUUID(),
                user_id: 'local-user',
                date: new Date().toISOString().split('T')[0],
                duration_seconds: State.session_minutes * 60,
                timestamp: Date.now()
            };
            saveSessionLocal(sessionData);
        }
    }

    requestAnimationFrame(engineLoop);
}
requestAnimationFrame(engineLoop);

document.getElementById('btn-toggle-engine')?.addEventListener('click', () => {
    if (State.is_running) {
        State.is_running = false;
        setText("btn-toggle-engine", "Start");
        setText("phase-label", "Paused");
        controlAudio(false, State.music_volume, State.setting_music);
        window.speechSynthesis.cancel();
    } else {
        State.is_running = true;
        loadSequence();
        setText("btn-toggle-engine", "Stop");
        document.getElementById("btn-share").style.display = "none";

        speak(State.phases[State.phase_index].n);
        controlAudio(true, State.music_volume, State.setting_music);
    }
});
