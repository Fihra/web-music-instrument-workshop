// ============================================
// Tone.js Setup
// ============================================
let currentOscillatorType = 'sawtooth';
// Max polyphony to avoid dropped notes when holding many notes
const MAX_POLYPHONY = 32;

// Create a reassignable PolySynth using the object-style API to avoid deprecated signatures
let polySynth;
function createPolySynth(type = currentOscillatorType) {
    // dispose old synth if present
    try {
        if (polySynth && typeof polySynth.dispose === 'function') polySynth.dispose();
    } catch (e) {
        console.warn('Error disposing old polySynth:', e);
    }

    polySynth = new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: MAX_POLYPHONY,
        voiceOptions: {
            oscillator: { type },
            envelope: {
                attack: 0.005,
                decay: 0.1,
                sustain: 0.3,
                release: 0.5,
            },
        },
    }).toDestination();

    currentOscillatorType = type;
}

// initialize synth
createPolySynth(currentOscillatorType);

// Sound map for different gestures - each maps to a starting note in C minor
const gestureNotes = {
    'peace': 'C4',           // Starts on C
    'point': 'D4',           // Starts on D
    'thumbs_up': 'Eb4',      // Starts on Eb
    'rock': 'F4',            // Starts on F
    'ok': 'G4',              // Starts on G
    'thumbs_down': 'Ab4',    // Starts on Ab
    'point_camera': 'Bb4',   // Starts on Bb
    'palm': 'C5',            // Starts on high C
};

const gestureLabels = {
    'peace': '✌️ Peace (C)',
    'point': '☝️ Pointing Up (D)',
    'thumbs_up': '👍 Thumbs Up (Eb)',
    'rock': '🤘 Rock On (F)',
    'ok': '👌 OK Sign (G)',
    'thumbs_down': '👎 Thumbs Down (Ab)',
    'point_camera': '👉 Point at Camera (Bb)',
    'palm': '✋ Palm Hand (C5)',
};

// Scale for random sequences (C minor scale)
const musicScale = ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4', 'C5'];

// ============================================
// MediaPipe Hand Detection Setup
// ============================================
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const gestureDisplay = document.getElementById('gestureDisplay');

// Fireworks particle system
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 12;
        this.vy = (Math.random() - 0.5) * 12 - 3;
        this.life = 1;
        this.decay = Math.random() * 0.04 + 0.03;
        this.color = `hsl(${Math.random() * 60 + 280}, 100%, 60%)`;
        this.size = Math.random() * 4 + 2;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.35; // gravity
        this.life -= this.decay;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.sin(2 * Math.PI));
        ctx.fill();
        ctx.fill();
    }
}

let particles = [];
// Electric static effects (spawn alongside fireworks)
let staticEffects = [];

let hands;
let camera;
let isRunning = false;
let lastPlayedGesture = null;
let gestureChangeTime = 0;
// Per-hand state to support two-hand simultaneous triggering
let lastPlayedGestureByHand = {}; // key: hand id ('left'|'right' or index)
let lastGestureTimeByHand = {};

// Spacebar hold state: when true, notes played during sequence are sustained
let isSpaceDown = false;
// Notes currently held (sustained) while spacebar is down
let heldNotes = [];

function releaseAllHeldNotes() {
    if (!heldNotes || heldNotes.length === 0) return;
    console.log('Releasing held notes:', heldNotes.slice());
    try {
        // try one-shot release for the array
        polySynth.triggerRelease(heldNotes, Tone.now());
    } catch (err) {
        // per-note fallback
        for (const n of heldNotes) {
            try { polySynth.triggerRelease(n, Tone.now()); } catch (e) { }
        }
    }
    heldNotes = [];
}

// Create fireworks at position
function createFireworks(x, y, count = 20) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y));
    }
}

// Update and draw particles
function updateParticles() {
    particles = particles.filter(p => p.life > 0);
    
    for (const particle of particles) {
        particle.update();
        particle.draw(ctx);
    }
}

// Create an electric static burst at (x,y)
function createStatic(x, y, duration = 3000) {
    const effect = {
        x,
        y,
        start: performance.now(),
        duration,
        fadeDuration: 500,
        // create a set of small static sparks
        sparks: Array.from({ length: 24 }, () => ({
            x: x + (Math.random() - 0.5) * 20,
            y: y + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5,
            size: Math.random() * 2 + 0.5,
            life: 1,
            flicker: Math.random() * 0.8 + 0.2,
        })),
    };
    staticEffects.push(effect);
}

function updateStaticEffects() {
    const now = performance.now();
    const remaining = [];
    for (const eff of staticEffects) {
        const t = now - eff.start;
        const alive = t < (eff.duration + eff.fadeDuration);
        if (!alive) continue;

        // compute alpha: full during duration, then fade during fadeDuration
        let alpha = 1;
        if (t > eff.duration) {
            alpha = 1 - ((t - eff.duration) / eff.fadeDuration);
        }

        // draw sparks
        for (const s of eff.sparks) {
            s.x += s.vx;
            s.y += s.vy;
            // small random jitter
            s.vx += (Math.random() - 0.5) * 0.1;
            s.vy += (Math.random() - 0.5) * 0.1;
            s.life -= 0.01;

            const glow = Math.min(1, Math.max(0, s.life)) * s.flicker * alpha;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = glow;
            // electric color gradient
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 6);
            g.addColorStop(0, 'rgba(180,230,255,1)');
            g.addColorStop(0.2, 'rgba(120,190,255,0.9)');
            g.addColorStop(0.6, 'rgba(80,120,255,0.5)');
            g.addColorStop(1, 'rgba(20,30,60,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        remaining.push(eff);
    }
    staticEffects = remaining;
}

// Initialize MediaPipe Hands
async function initializeHands() {
    hands = new window.Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });

    hands.onResults(onHandsResults);

    camera = new window.Camera(video, {
        onFrame: async () => {
            if (isRunning) {
                await hands.send({image: video});
            }
        },
        width: 640,
        height: 480,
    });
}

// ============================================
// Gesture Recognition Functions
// ============================================
function getHandGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return null;

    const fingers = extractFingerStates(landmarks);

    // Peace sign (index and middle fingers extended, others folded)
    if (fingers.index && fingers.middle && 
        !fingers.ring && !fingers.pinky && !fingers.thumb) {
        return 'peace';
    }

    // Pointing up (only index extended, palm down)
    if (fingers.index && !fingers.middle && 
        !fingers.ring && !fingers.pinky && !fingers.thumb) {
        return 'point';
    }

    // Thumbs up (thumb extended upward, other fingers folded)
    if (isThumbsUp(landmarks)) {
        return 'thumbs_up';
    }

    // Thumbs down (thumb extended downward, other fingers folded)
    if (isThumbsDown(landmarks)) {
        return 'thumbs_down';
    }

    // Rock on (index and pinky extended, middle and ring folded)
    if (fingers.index && fingers.pinky && 
        !fingers.middle && !fingers.ring) {
        return 'rock';
    }

    // OK sign (thumb and index touching, other fingers extended)
    if (isOKSign(landmarks)) {
        return 'ok';
    }

    // Pointing at camera (index extended forward, other fingers folded, palm facing camera)
    if (isPointingAtCamera(landmarks)) {
        return 'point_camera';
    }

    // Palm hand (all fingers extended, palm open)
    if (isPalmOpen(landmarks)) {
        return 'palm';
    }

    return null;
}

function extractFingerStates(landmarks) {
    // Return true if finger is extended
    // Comparing tip position with PIP joint
    return {
        thumb: landmarks[4].y < landmarks[3].y,
        index: landmarks[8].y < landmarks[6].y,
        middle: landmarks[12].y < landmarks[10].y,
        ring: landmarks[16].y < landmarks[14].y,
        pinky: landmarks[20].y < landmarks[18].y,
    };
}

function isThumbsUp(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const middle = landmarks[12];
    const ring = landmarks[16];
    const pinky = landmarks[20];
    const wrist = landmarks[0];

    // Thumb should be extended and other fingers folded
    const thumbExtended = thumb.y < landmarks[3].y;
    const othersFolded = index.y > landmarks[6].y && 
                        middle.y > landmarks[10].y &&
                        ring.y > landmarks[14].y &&
                        pinky.y > landmarks[18].y;
    
    // Thumb should be above wrist (pointing up)
    const thumbUp = thumb.y < wrist.y;

    return thumbExtended && othersFolded && thumbUp;
}

function isThumbsDown(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const middle = landmarks[12];
    const ring = landmarks[16];
    const pinky = landmarks[20];
    const wrist = landmarks[0];

    // Thumb should be extended and other fingers folded
    const thumbExtended = thumb.y < landmarks[3].y;
    const othersFolded = index.y > landmarks[6].y && 
                        middle.y > landmarks[10].y &&
                        ring.y > landmarks[14].y &&
                        pinky.y > landmarks[18].y;
    
    // Thumb should be below wrist (pointing down)
    const thumbDown = thumb.y > wrist.y;

    return thumbExtended && othersFolded && thumbDown;
}

function isOKSign(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const middle = landmarks[12];

    // Thumb and index should be close together
    const thumbIndexDist = Math.hypot(
        thumb.x - index.x,
        thumb.y - index.y
    );

    // Other fingers should be extended
    const middleExtended = middle.y < landmarks[10].y;

    return thumbIndexDist < 0.08 && middleExtended;
}

function isPointingAtCamera(landmarks) {
    const index = landmarks[8];
    const middle = landmarks[12];
    const ring = landmarks[16];
    const pinky = landmarks[20];
    const thumb = landmarks[4];

    // Index extended, other fingers folded
    const indexExtended = index.y < landmarks[6].y;
    const othersFolded = middle.y > landmarks[10].y &&
                        ring.y > landmarks[14].y &&
                        pinky.y > landmarks[18].y &&
                        thumb.y > landmarks[3].y;

    // Index should be pointing forward (z depth would be forward, but we check hand orientation)
    return indexExtended && othersFolded;
}

function isPalmOpen(landmarks) {
    // All fingers extended
    const allExtended = landmarks[8].y < landmarks[6].y &&   // index
                       landmarks[12].y < landmarks[10].y &&  // middle
                       landmarks[16].y < landmarks[14].y &&  // ring
                       landmarks[20].y < landmarks[18].y &&  // pinky
                       landmarks[4].y < landmarks[3].y;      // thumb

    // Palm should be relatively flat (all fingers at similar y level)
    const fingerTips = [landmarks[8].y, landmarks[12].y, landmarks[16].y, landmarks[20].y];
    const maxY = Math.max(...fingerTips);
    const minY = Math.min(...fingerTips);
    const fingerSpread = maxY - minY < 0.15;

    return allExtended && fingerSpread;
}

function detectHandedness(landmarks) {
    // Simple heuristic: if hand leans right it's right hand
    const palm = landmarks.slice(0, 5).reduce((sum, p) => sum + p.x, 0) / 5;
    return palm > 0.5 ? 'right' : 'left';
}

// ============================================
// MediaPipe Callback
// ============================================
function onHandsResults(results) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const fingertips = [4, 8, 12, 16, 20];

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Build a display string for all detected hands
        const displayParts = [];

        // Iterate each detected hand
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            let handLabel = null;
            if (results.multiHandedness && results.multiHandedness[i] && results.multiHandedness[i].label) {
                handLabel = results.multiHandedness[i].label.toLowerCase(); // 'left' or 'right'
            } else {
                handLabel = detectHandedness(landmarks);
            }

            const idKey = handLabel || `hand${i}`;
            const gesture = getHandGesture(landmarks);

            if (gesture) {
                displayParts.push(`${handLabel || 'hand'+i}: ${gestureLabels[gesture] || gesture}`);

                const now = Date.now();
                const lastTime = lastGestureTimeByHand[idKey] || 0;
                const lastGesture = lastPlayedGestureByHand[idKey] || null;

                // Trigger sound if gesture changed for this hand
                if (gesture !== lastGesture && (now - lastTime > 200)) {
                    // Play the gesture sequence for this hand (simultaneous calls are allowed)
                    playGestureSound(gesture);

                    // Create fireworks at all fingertips for this hand
                    for (const fingertipIndex of fingertips) {
                        const fingertip = landmarks[fingertipIndex];
                        const fx = fingertip.x * canvas.width;
                        const fy = fingertip.y * canvas.height;
                        createFireworks(fx, fy, 8);
                        createStatic(fx, fy);
                    }

                    lastPlayedGestureByHand[idKey] = gesture;
                    lastGestureTimeByHand[idKey] = now;
                }
            } else {
                displayParts.push(`${handLabel || 'hand'+i}: Unknown`);
            }

            // Draw landmarks for this hand
            drawHand(landmarks);
        }

        gestureDisplay.textContent = displayParts.join(' | ');
    } else {
        gestureDisplay.textContent = 'No hand detected';
        lastPlayedGestureByHand = {};
        lastGestureTimeByHand = {};
    }

    // Update and draw particles
    updateParticles();
    // Update electric static effects
    updateStaticEffects();
}

function drawHand(landmarks) {
    // Draw connections
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [0, 9], [9, 10], [10, 11], [11, 12],
        [0, 13], [13, 14], [14, 15], [15, 16],
        [0, 17], [17, 18], [18, 19], [19, 20],
        [5, 9], [9, 13], [13, 17],
    ];

    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [start, end] of connections) {
        const s = landmarks[start];
        const e = landmarks[end];
        ctx.beginPath();
        ctx.moveTo(s.x * canvas.width, s.y * canvas.height);
        ctx.lineTo(e.x * canvas.width, e.y * canvas.height);
        ctx.stroke();
    }

    // Draw landmarks
    ctx.fillStyle = '#f093fb';
    for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(
            landmark.x * canvas.width,
            landmark.y * canvas.height,
            5,
            0,
            2 * Math.PI
        );
        ctx.fill();
    }
}

// ============================================
// Sound Playback
// ============================================
function getRandomNoteSequence(baseNote, length = 8) {
    // Start with the base note, then randomize remaining notes from scale
    const sequence = [baseNote];
    for (let i = 1; i < length; i++) {
        const randomNote = musicScale[Math.floor(Math.random() * musicScale.length)];
        sequence.push(randomNote);
    }
    return sequence;
}

async function playNoteSequence(notes, tempo = 0.15) {
    try {
        // Ensure audio context is started
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        for (const note of notes) {
            if (isSpaceDown) {
                // If we're already at max polyphony, skip adding more sustained notes
                if (heldNotes.length >= MAX_POLYPHONY) {
                    console.warn('Max polyphony reached, skipping sustain for', note);
                } else {
                    // sustain the played note until space is released
                    try {
                        polySynth.triggerAttack(note, Tone.now());
                        if (!heldNotes.includes(note)) heldNotes.push(note);
                    } catch (err) {
                        console.warn('triggerAttack error:', err);
                    }
                }
            } else {
                // schedule attack+release explicitly
                try {
                    polySynth.triggerAttackRelease(note, tempo, Tone.now());
                } catch (err) {
                    console.warn('triggerAttackRelease error:', err);
                }
            }
            await new Promise(resolve => setTimeout(resolve, tempo * 1000));
        }
    } catch (error) {
        console.error('Error playing sequence:', error);
    }
}

async function playGestureSound(gesture) {
    try {
        // Ensure audio context is started
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
        
        console.log('Gesture detected:', gesture);
        
        // Generate and play random 8-note sequence
        const sequence = getRandomNoteSequence(gestureNotes[gesture], 8);
        console.log('Playing sequence:', sequence);
        
        // Play sequence asynchronously so UI doesn't freeze
        playNoteSequence(sequence, 0.12);
    } catch (error) {
        console.error('Error playing sound:', error);
    }
}

// ============================================
// Button Controls
// ============================================
document.getElementById('startBtn').addEventListener('click', async () => {
    await Tone.start();
    await initializeHands();
    isRunning = true;
    camera.start();
    gestureDisplay.textContent = 'Waiting for hand...';
});

document.getElementById('stopBtn').addEventListener('click', () => {
    if (camera) {
        camera.stop();
    }
    isRunning = false;
    gestureDisplay.textContent = 'Camera stopped';
    lastPlayedGesture = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ============================================
// Keyboard Controls for Oscillator Type
// ============================================
function switchOscillator(type) {
    currentOscillatorType = type;
    // Recreate the polySynth with the new oscillator type to avoid deprecated/set issues
    const held = heldNotes.slice();
    // release currently held notes on old synth first
    try {
        if (held.length > 0) polySynth.triggerRelease(held, Tone.now());
    } catch (e) {
        /* ignore */
    }
    createPolySynth(type);

    // If space is held, re-attack held notes on the new synth so sustain continues
    if (isSpaceDown && held.length > 0) {
        for (const n of held) {
            try {
                polySynth.triggerAttack(n, Tone.now());
            } catch (e) {}
        }
    }
    
    const typeNames = {
        'sine': '🌊 Sine',
        'square': '📦 Square',
        'triangle': '△ Triangle',
        'sawtooth': '📈 Sawtooth'
    };
    
    const synthDisplay = document.getElementById('synthDisplay');
    if (synthDisplay) {
        synthDisplay.textContent = `Synth: ${typeNames[type] || type}`;
        synthDisplay.style.color = '#4facfe';
    }
    
    console.log('Switched to', type, 'oscillator');
}

document.addEventListener('keydown', (e) => {
    // handle space separately to allow holding
    if (e.code === 'Space') {
        if (!isSpaceDown) {
            isSpaceDown = true;
            // prevent default page scroll
            e.preventDefault();
        }
        return;
    }

    const key = e.key.toLowerCase();
    switch(key) {
        case 'a':
            switchOscillator('sine');
            break;
        case 's':
            switchOscillator('square');
            break;
        case 'd':
            switchOscillator('triangle');
            break;
        case 'f':
            switchOscillator('sawtooth');
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        if (isSpaceDown) {
            isSpaceDown = false;
            e.preventDefault();
            // reliably release all held notes
            releaseAllHeldNotes();
        }
    }
});

// Initialize on page load
window.addEventListener('load', () => {
    gestureDisplay.textContent = 'Click "Start Camera" to begin';
});
