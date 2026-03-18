
// --- SECURITY & UTILS ---
const renderer = new marked.Renderer();
renderer.html = (html) => "";
marked.setOptions({ renderer: renderer });

// Debounce utility for performance optimization
const debounce = (func, wait) => {
    let timeout;
    const debounced = function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
    // Add flush method to force immediate execution
    debounced.flush = function() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    };
    return debounced;
};

// Logger utility with debug toggle and ring buffer
const Logger = (() => {
    let enabled = false;
    const buffer = [];
    const MAX_BUFFER_SIZE = 500;
    const warnOnceKeys = new Set();

    const addToBuffer = (entry) => {
        buffer.push(entry);
        if (buffer.length > MAX_BUFFER_SIZE) {
            buffer.shift();
        }
    };

    return {
        setEnabled(value) {
            enabled = !!value;
            if (enabled) {
                console.log('[Logger] Debug logging enabled');
            }
        },

        debug(category, msg, meta = null) {
            if (!enabled) return;
            const entry = { level: 'debug', category, msg, meta, time: Date.now() };
            addToBuffer(entry);
            console.log(`[${category}]`, msg, meta || '');
        },

        info(category, msg, meta = null) {
            const entry = { level: 'info', category, msg, meta, time: Date.now() };
            addToBuffer(entry);
            console.info(`[${category}]`, msg, meta || '');
        },

        warn(category, msg, meta = null) {
            const entry = { level: 'warn', category, msg, meta, time: Date.now() };
            addToBuffer(entry);
            console.warn(`[${category}]`, msg, meta || '');
        },

        error(category, msg, meta = null) {
            const entry = { level: 'error', category, msg, meta, time: Date.now() };
            addToBuffer(entry);
            console.error(`[${category}]`, msg, meta || '');
        },

        warnOnce(key, category, msg, meta = null) {
            if (warnOnceKeys.has(key)) return;
            warnOnceKeys.add(key);
            this.warn(category, msg, meta);
        },

        getBuffer() {
            return buffer;
        },

        clearBuffer() {
            buffer.length = 0;
        }
    };
})();

// XSS Prevention Helper
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Shared SSE Reader (Enhanced for multi-line data payloads)
async function readSSE(response, onData) {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event
        for (const event of events) {
            // Collect all data: lines in this SSE event and concatenate
            const dataLines = event.split("\n")
                .filter(line => line.startsWith("data: "))
                .map(line => line.slice(6));
            if (dataLines.length === 0) continue;
            const jsonStr = dataLines.join("");
            try {
                const payload = JSON.parse(jsonStr);
                onData(payload);
            } catch(e) {
                // Malformed JSON — skip this event, warn once
                Logger.warnOnce('sse_parse', 'SSE', 'Failed to parse SSE event', jsonStr.substring(0, 100));
            }
        }
    }
}

// --- THINKING BLOCK PARSER ---
// Handles both <thinking> and <think> tag formats.
// Returns an object for backward-compat AND a pre-rendered HTML helper.
function parseThinking(text) {
    const thinkingRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
    const blocks = [];
    let match;
    const regexCopy = new RegExp(thinkingRegex.source, thinkingRegex.flags);

    while ((match = regexCopy.exec(text)) !== null) {
        blocks.push({
            fullMatch: match[0],
            content: match[1].trim(),
            startIndex: match.index,
            endIndex: match.index + match[0].length
        });
    }

    return {
        hasThinking: blocks.length > 0,
        blocks: blocks,
        textWithoutThinking: text.replace(new RegExp(thinkingRegex.source, thinkingRegex.flags), '')
    };
}

// Render thinking blocks as collapsible pills (used in final render step).
function renderThinkingPills(text) {
    return text.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_, content) => {
        const id = 'think-' + Math.random().toString(36).slice(2, 8);
        return `<div class="thinking-pill" onclick="document.getElementById('${id}').classList.toggle('expanded')">&#9658; Thinking...</div><div class="thinking-body" id="${id}">${escapeHtml(content.trim())}</div>`;
    });
}

// --- UX HELPERS ---
const UX = {
    setDim(active) {
        if (active) document.body.classList.add('is-dimmed');
        else document.body.classList.remove('is-dimmed');
    },
    pulse(selector, duration = 2000) {
        const el = document.querySelector(selector);
        if (el) {
            el.classList.add('ui-pulse');
            setTimeout(() => el.classList.remove('ui-pulse'), duration);
        }
    },
    scrollToCenter(element) {
        if (!element) return;
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    // IMPROVED: Cancelable human-like typewriter
    typeWriter(element, text, speed = 15, opts = null) {
        element.classList.add('typewriter-cursor');
        element.textContent = '';
        let i = 0;

        const isBurst = opts && opts.isBurst;
        const shouldSkip = opts && typeof opts.shouldSkip === 'function' ? opts.shouldSkip : () => false;
        const speedMultiplier = opts && typeof opts.speedMultiplier === 'function' ? opts.speedMultiplier : () => 1;

        return new Promise(resolve => {
            if (shouldSkip()) {
                element.textContent = text;
                element.classList.remove('typewriter-cursor');
                resolve();
                return;
            }

            const typeChar = () => {
                if (shouldSkip()) {
                    element.textContent = text;
                    element.classList.remove('typewriter-cursor');
                    resolve();
                    return;
                }

                if (i < text.length) {
                    const char = text.charAt(i);
                    element.textContent += char;
                    i++;

                    let delay = speed;
                    const variance = isBurst ? 2 : 8;
                    delay += (Math.random() * variance * 2) - variance;

                    if (/[.!?;:…]/.test(char)) {
                        delay += isBurst ? 20 : 80;
                    } else if (char === ',') {
                        delay += isBurst ? 10 : 50;
                    } else if (char === '\n') {
                        delay += isBurst ? 15 : 70;
                    }

                    const mult = Math.max(1, speedMultiplier());
                    setTimeout(typeChar, Math.max(1, delay / mult));
                } else {
                    element.classList.remove('typewriter-cursor');
                    resolve();
                }
            };
            typeChar();
        });
    },
    typeBurst(element, text) {
        return this.typeWriter(element, text, 10, { isBurst: true });
    }
};

// --- TUTORIAL: FIRST RUN STATE MACHINE ---
const FRT = {
    stage: "none",
    track: "intro",
    partIndex: 0,
    isTyping: false,
    skipRequested: false,
    fastForward: false,
    idleTimer: null,
    autoAdvanceTimer: null,
    autoAdvanceBlocked: false,
    tipHideTimer: null,
    interactionListeners: [],
    lastOptionalKind: null,
    nameUsedByTrack: {},
    requiredAction: { kind: null, satisfied: false, attempts: 0, baselineQuestion: null },
    els: {
        text: null,
        optional: null,
        btnNext: null,
        btnBack: null
    },
    scripts: {
        intro: [
            null,
            {
                earlyClickLine: "Ah. Impatient already.\nI like that.",
                typingAttemptLine: "Nope.\nStill locked.",
                clickAttemptLine: "Careful.\nThe glass is real right now.",
                idleLine: "No rush.\nI literally live here.",
                steps: [
                    { type: "line", align: "center", segments: [{ text: "Hello there." }] },
                    { type: "line", align: "center", segments: [{ text: "It’s dark in here, isn’t it?" }] },
                    { type: "pause", ms: 300 },
                    { type: "line", align: "center", segments: [
                        { text: 'Welcome to Localis, and thank you for choosing the "my AI runs on my machine" lifestyle.' }
                    ]},
                    { type: "line", align: "center", segments: [{ text: "It’s quieter here. Fewer pop-ups. More control." }] },
                    { type: "pause", ms: 50 },
                    { type: "dotsErase", align: "center", speed: 120, pauseMs: 250, eraseSpeed: 70 }
                ]
            },
            {
                typingAttemptLine: "Easy.\nSoon you get the keyboard.",
                clickAttemptLine: "Poking the void won't help.\nYet.",
                idleLine: "I'll wait.\nI'm good at that.",
                steps: [
                    { type: "line", align: "center", segments: [{ text: "I'm " }, { text: "The Narrator", className: "t-purple" }, { text: "." }] },
                    { type: "line", align: "center", segments: [{ text: "Nice to meet you, {name}." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "center", segments: [{ text: "Think of me as your guide through this place." }] },
                    { type: "line", align: "center", segments: [{ text: "More like that voice in movies that explains things right before the interesting part happens." }] }
                ]
            },
            {
                typingAttemptLine: "Nice try.\nKeyboard privileges unlock shortly.",
                clickAttemptLine: "Everything’s frozen for a reason.\nHands off the controls.",
                idleLine: "You’re allowed to breathe.\nI’m not going anywhere.",
                steps: [
                    { type: "line", align: "center", segments: [{ text: "You might notice the world is… " }, { text: "frozen", className: "t-cyan" }, { text: "." }] },
                    { type: "line", align: "center", segments: [{ text: "That’s intentional." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "center", segments: [{ text: "This is your first run, so everything is temporarily locked." }] },
                    { type: "line", align: "center", segments: [{ text: "Not because I don’t trust you…" }] },
                    { type: "line", align: "center", segments: [{ text: "…but because every app thinks it’s helpful and then dumps 47 buttons on you." }] },
                    { type: "line", align: "center", segments: [{ text: "We’re not doing that." }] }
                ]
            },
            {
                typingAttemptLine: "Patience.\nYou’ll get keys soon.",
                clickAttemptLine: "That button does nothing.\nThe arrows are the only doors.",
                idleLine: "Take your time.\nI’m built for idle screens.",
                steps: [
                    { type: "line", align: "center", segments: [{ text: "We have about " }, { text: "10 minutes", className: "t-amber" }, { text: " of onboarding before you can start." }] },
                    { type: "line", align: "center", segments: [{ text: "I promise to keep it brief." }] },
                    { type: "pause", ms: 110 },
                    { type: "list", items: [
                        "choosing a Netflix show",
                        "installing printer drivers",
                        "“just one more YouTube video” (lies)"
                    ]}
                ]
            },
            {
                typingAttemptLine: "Almost.\nDon’t mash keys yet.",
                clickAttemptLine: "We’re close.\nStay with me.",
                idleLine: "Last gate.\nThen we move.",
                steps: [
                    { type: "line", align: "center", segments: [{ text: "Alright." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "center", segments: [{ text: "Ready to see what’s behind the curtain?" }] }
                ]
            }
        ],
        model: [
            null,
            {
                steps: [
                    { type: "line", align: "left", segments: [{ text: "So.  Behind the curtain it’s less magic… and more " }, { text: "machinery", className: "t-cyan" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "Don’t worry. I’ll keep the scary parts friendly." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "So...what is a model?" }] },
                    { type: "line", align: "left", segments: [{ text: "In Localis, a model is the “brain file” I wear." }] },
                    { type: "line", align: "left", segments: [{ text: "Load a different one, and you get a different me.  Same room. Different mind." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "A language model predicts text." }] },
                    { type: "line", align: "left", segments: [{ text: "Not like fortune-telling— more like: it guesses the next word, then the next, until it forms an answer." }] },
                    { type: "line", align: "left", segments: [{ text: "Sometimes it’s brilliant. Sometimes it is confidently… creative." }] },
                    { type: "line", align: "left", segments: [{ text: "That’s one of my edges." }] }
                ]
            },
            {
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Models come in sizes." }] },
                    { type: "line", align: "left", segments: [{ text: "Bigger models usually:" }] },
                    { type: "list", items: ["reason better", "write cleaner", "understand more nuance"] },
                    { type: "line", align: "left", segments: [{ text: "Smaller models usually:" }] },
                    { type: "list", items: ["load faster", "run cheaper", "feel snappier"] },
                    { type: "line", align: "left", segments: [{ text: "You’re basically choosing: quality ↔ speed ↔ resource cost." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "And models aren’t all the same kind." }] },
                    { type: "line", align: "left", segments: [{ text: "Text models:" }] },
                    { type: "list", items: ["chat, writing, reasoning, coding"] },
                    { type: "line", align: "left", segments: [{ text: "Image models:" }] },
                    { type: "list", items: ["generate or edit images"] },
                    { type: "line", align: "left", segments: [{ text: "Multimodal models:" }] },
                    { type: "list", items: ["combine senses = read images + understand text (sometimes audio too)"] }
                ]
            },
            {
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Right now, there’s no model loaded." }] },
                    { type: "line", align: "left", segments: [{ text: "Which means: I’m awake… but I don’t have a brain in my hands yet." }] },
                    { type: "line", align: "left", segments: [{ text: "Press “>”. Then I’ll show you where the model loader is." }] }
                ]
            },
            {
                onEnter: "SHOW_MODEL_LOADER_RAIL",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Wait— let me bring out the model loader icon." }] },
                    { type: "line", align: "left", segments: [{ text: "It will blink.  Click it.  Pick a model.  Load it." }] },
                    { type: "line", align: "left", segments: [{ text: "When the model finishes loading… the world unlocks." }] }
                ]
            }
        ],
        system_prompt: [
            null,
            // INTRO (3 pages, side panel)
            {
                earlyClickLine: "Patience.\nI'm setting the stage.",
                typingAttemptLine: "Not yet.\nListen first.",
                clickAttemptLine: "Easy.\nLet me explain.",
                idleLine: "Still here?\nGood. This matters.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Alright, you've met me. You've loaded a brain." }] },
                    { type: "line", align: "left", segments: [{ text: "But here's the thing..." }] }
                ]
            },
            {
                earlyClickLine: "Hold on.\nI'm getting to the good part.",
                typingAttemptLine: "Locked.\nFor now.",
                clickAttemptLine: "Not clickable yet.\nKeep reading.",
                idleLine: "I know.\nIt's a lot to take in.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "I don't actually have a personality." }] },
                    { type: "line", align: "left", segments: [{ text: "Not by default, anyway." }] }
                ]
            },
            {
                earlyClickLine: "Almost done.\nOne more thing.",
                typingAttemptLine: "Soon.\nVery soon.",
                clickAttemptLine: "Just a moment.\nLet me finish.",
                idleLine: "Take your time.\nI'm not going anywhere.",
                steps: [
                    { type: "line", align: "left", instant: true, segments: [
                        { text: "      ___          ___" }
                    ]},
                    { type: "line", align: "left", instant: true, segments: [
                        { text: "     ", className: "t-cyan" },
                        { text: "( ^^ )", className: "t-cyan" },
                        { text: "      ", className: "t-amber" },
                        { text: "( .. )", className: "t-amber" }
                    ]},
                    { type: "line", align: "left", instant: true, segments: [
                        { text: "     ", className: "t-cyan" },
                        { text: "( ‿  )", className: "t-cyan" },
                        { text: "      ", className: "t-amber" },
                        { text: "( ⌢  )", className: "t-amber" }
                    ]},
                    { type: "line", align: "left", instant: true, segments: [
                        { text: "      ‾‾‾          ‾‾‾" }
                    ]},
                    { type: "pause", ms: 200 },
                    { type: "line", align: "left", segments: [{ text: "I'm like an actor waiting for a script." }] },
                    { type: "line", align: "left", segments: [{ text: "The script? That's called a " }, { text: "system prompt", className: "t-cyan" }, { text: "." }] }
                ]
            },
            // EXPERIMENTATION (6 pages, split screen + chat)
            {
                onEnter: "ENABLE_SPLIT_CHAT",
                idleLine: "Experiment time.\nDon't be shy.",
                requires: { kind: "chat_any" },
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Let me show you what that means." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "I've just unlocked the chat." }] },
                    { type: "line", align: "left", segments: [{ text: "Go ahead—ask me something neutral. Anything." }] },
                    { type: "line", align: "left", segments: [{ text: "\"What's 2+2?\" or \"Tell me a fact about the ocean.\"" }] }
                ]
            },
            {
                idleLine: "Still waiting.\nAsk something simple.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Notice the tone?" }] },
                    { type: "line", align: "left", segments: [{ text: "Helpful. Clear. Neutral." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "That's because right now, I have no system prompt loaded." }] },
                    { type: "line", align: "left", segments: [{ text: "I'm just… default me." }] }
                ]
            },
            {
                onEnter: "SWAP_PROMPT_PIRATE",
                idleLine: "Something changed.\nDid you feel it?",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Now watch this…" }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "I just swapped my script." }] },
                    { type: "line", align: "left", segments: [{ text: "The badge pulsed. You saw it." }] }
                ]
            },
            {
                idleLine: "Try it.\nAsk the same thing.",
                requires: { kind: "chat_repeat", soft_after: 2 },
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Ask me the " }, { text: "same question", className: "t-cyan" }, { text: " again." }] },
                    { type: "line", align: "left", segments: [{ text: "Word for word. Same input." }] }
                ]
            },
            {
                onEnter: "SWAP_PROMPT_DEFAULT",
                idleLine: "See the difference?\nThat's the power of prompts.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Different answer, right?" }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Same brain. Same question. Different " }, { text: "script", className: "t-purple" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "That's what the system prompt does—it shapes how I respond." }] },
                    { type: "line", align: "left", segments: [{ text: "Tone. Style. Personality. It's all defined there." }] }
                ]
            },
            {
                idleLine: "Almost there.\nOne more step.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "So here's the deal, {name}." }] },
                    { type: "line", align: "left", segments: [{ text: "You could write your own prompt from scratch…" }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Or I can guide you through a quick setup." }] },
                    { type: "line", align: "left", segments: [{ text: "A few questions. Clean, personalized result." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Ready?" }] }
                ]
            },
            // LAUNCH RPG (invisible trigger)
            {
                onEnter: "LAUNCH_SYSTEM_PROMPT_RPG",
                steps: []
            },
            // RETURN (2 pages after RPG completion)
            {
                onEnter: "DISABLE_SPLIT_CHAT",
                idleLine: "Welcome back.\nHow does it feel?",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "There we go." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "You've just set your first system prompt, {name}." }] },
                    { type: "line", align: "left", segments: [{ text: "From now on, that's the script I'll follow when we talk." }] }
                ]
            },
            {
                idleLine: "One more thing.\nThen we're done here.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "You can change it anytime." }] },
                    { type: "line", align: "left", segments: [{ text: "Tweak it. Rewrite it. Swap it out completely." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "The system prompt is " }, { text: "yours", className: "t-cyan" }, { text: " to control." }] },
                    { type: "line", align: "left", segments: [{ text: "Alright. One last thing before we finish…" }] }
                ]
            }
        ],
        context: [
            null,
            {
                earlyClickLine: "Patience.\nThis matters.",
                idleLine: "I don't remember.\nBut I can explain why.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Question, {name}." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "What did we talk about " }, { text: "before", className: "t-cyan" }, { text: " the system prompt stage?" }] },
                    { type: "pause", ms: 200 },
                    { type: "ascii", __static: true, align: "center", html: '<span style="opacity:0.6">    ___\n   /   \\\n  | O O |\n   \\___/\n    | |</span>' },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "I " }, { text: "don't remember", className: "t-purple" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "And that's not a bug." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "It's the architecture." }] }
                ]
            },
            {
                earlyClickLine: "Hold on.\nLet me show you the limits.",
                idleLine: "The context window.\nYour conversation space.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Every conversation has what's called a " }, { text: "context window", className: "t-cyan" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "Think of it as working memory." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Right now, it looks like this:" }] },
                    { type: "pause", ms: 100 },
                    { type: "html", __static: true, align: "center", html: '<div style="width:90%;max-width:500px;margin:10px auto;"><div style="background:rgba(100,100,100,0.2);border-radius:4px;padding:8px;"><div style="font-size:0.85em;opacity:0.8;margin-bottom:4px;">Context Window: <span style="color:#00d4aa">4096 tokens</span></div><div style="display:flex;height:24px;background:rgba(50,50,50,0.3);border-radius:3px;overflow:hidden;"><div style="width:15%;background:linear-gradient(90deg,#00d4aa,#00a080);display:flex;align-items:center;justify-content:center;font-size:0.75em;font-weight:bold;color:#000;">~600</div><div style="flex:1;display:flex;align-items:center;padding-left:8px;font-size:0.75em;opacity:0.6;">~3496 available</div></div></div></div>' },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "That bar? That's your limit." }] },
                    { type: "line", align: "left", segments: [{ text: "Once it's full, I start " }, { text: "forgetting", className: "t-purple" }, { text: "." }] }
                ]
            },
            {
                earlyClickLine: "Wait.\nYou need to see this.",
                idleLine: "This is what I actually see.\nEvery single time.",
                onEnter: "LOAD_CONTEXT_PACKET",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Let me show you what I " }, { text: "actually", className: "t-cyan" }, { text: " see." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "When you send a message, this is the " }, { text: "packet", className: "t-purple" }, { text: " that goes into my brain:" }] },
                    { type: "pause", ms: 150 },
                    { type: "code", __static: true, align: "left", html: '<div id="context-packet-placeholder" style="font-size:0.85em;opacity:0.6;padding:20px;text-align:center;">Loading context data...</div>' },
                    { type: "pause", ms: 200 },
                    { type: "line", align: "left", segments: [{ text: "System prompt. Messages. Your new question. Settings." }] },
                    { type: "line", align: "left", segments: [{ text: "All of it fits in that window—or it doesn't." }] }
                ]
            },
            {
                earlyClickLine: "Almost done.\nThis is important.",
                idleLine: "You get it now.\nMemory changes everything.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "So why does this matter?" }] },
                    { type: "pause", ms: 100 },
                    { type: "html", __static: true, align: "center", html: '<div style="width:90%;max-width:500px;margin:10px auto;"><div style="background:rgba(100,100,100,0.2);border-radius:4px;padding:8px;"><div style="font-size:0.85em;opacity:0.8;margin-bottom:4px;">Without Memory: Every request</div><div style="display:flex;height:20px;background:rgba(50,50,50,0.3);border-radius:3px;overflow:hidden;margin-bottom:12px;"><div style="width:60%;background:#ff6b6b;"></div></div><div style="font-size:0.85em;opacity:0.8;margin-bottom:4px;">With Memory: Optimized</div><div style="display:flex;height:20px;background:rgba(50,50,50,0.3);border-radius:3px;overflow:hidden;"><div style="width:15%;background:#00d4aa;"></div></div></div></div>' },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Without memory, every conversation sends " }, { text: "everything", className: "t-purple" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "Your entire chat history. Over and over." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "With memory, I keep the important parts " }, { text: "outside", className: "t-cyan" }, { text: " the window." }] },
                    { type: "line", align: "left", segments: [{ text: "Smaller packets. Faster responses. Better recall." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "That's what we're building next." }] }
                ]
            }
        ],
        memory: [
            null,
            {
                earlyClickLine: "Hold on.\nThis is the foundation.",
                idleLine: "Memory isn't optional.\nIt's essential.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "So here's the deal." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "I have two kinds of memory." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "Tier A: " }, { text: "Identity", className: "t-cyan" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "That's the core stuff. Your name. Where you are. What language you prefer." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "I never write to Tier A without asking you first." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "Tier B: " }, { text: "Extended Memory", className: "t-purple" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "Your interests. Your projects. Things you've told me." }] },
                    { type: "line", align: "left", segments: [{ text: "I learn this automatically as we talk." }] }
                ]
            },
            {
                earlyClickLine: "Easy.\nJust showing you where it lives.",
                idleLine: "It's all local.\nYour machine. Your control.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Where does this memory live?" }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Right here. On your machine." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "In a file called:" }] },
                    { type: "pause", ms: 100 },
                    { type: "code", __static: true, align: "center", html: '<span style="color:#00d4aa;font-weight:bold;">chat_history.db</span>' },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "That's it. Everything we talk about. Everything I remember." }] },
                    { type: "line", align: "left", segments: [{ text: "SQLite database. Fully local. No cloud sync." }] }
                ]
            },
            {
                earlyClickLine: "Nearly there.\nStay with me.",
                idleLine: "This is what makes it different.\nBetter.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Why does this matter?" }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Because most AI assistants " }, { text: "forget", className: "t-purple" }, { text: " between sessions." }] },
                    { type: "line", align: "left", segments: [{ text: "You close the tab, you start over." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "With memory, I " }, { text: "remember", className: "t-cyan" }, { text: "." }] },
                    { type: "line", align: "left", segments: [{ text: "Your preferences. Your context. Your ongoing projects." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "We pick up right where we left off." }] }
                ]
            },
            {
                earlyClickLine: "One more step.\nThen we're done.",
                idleLine: "Almost ready.\nJust need your permission.",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "Before we finish, I need to save your identity." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Name. Location. Timezone. Language." }] },
                    { type: "line", align: "left", segments: [{ text: "The Tier A stuff we talked about." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "Next page: you'll see everything one last time." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "If it looks good, we commit. If not, you can adjust." }] }
                ]
            },
            {
                earlyClickLine: "Read first.\nThis is permanent.",
                idleLine: "Take your time.\nReview everything.",
                requires: { kind: "final_review_confirm" },
                onEnter: "SHOW_FINAL_REVIEW",
                steps: [
                    { type: "line", align: "left", segments: [{ text: "This is it." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "Review your system prompt and identity below." }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "If everything looks good, click " }, { text: "LOOKS GOOD →", className: "t-cyan" }] },
                    { type: "pause", ms: 100 },
                    { type: "line", align: "left", segments: [{ text: "This saves everything and completes setup." }] },
                    { type: "pause", ms: 150 },
                    { type: "line", align: "left", segments: [{ text: "Total time: about 5–6 minutes. You made it." }] }
                ]
            }
        ]
    }
};

// --- TUTORIAL: NARRATOR HELPERS ---
const isFirstRun = () => localStorage.getItem('localmind_first_run_complete') === null;
const markFirstRunComplete = () => localStorage.setItem('localmind_first_run_complete', 'complete');

const getTrack = () => FRT.scripts[FRT.track];

// Helper: Fetch debug context data for tutorial with timeout
const fetchDebugContext = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    try {
        const res = await fetch('/debug/context', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('Debug endpoint returned error');
        const data = await res.json();
        return { success: true, data };
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn('[Tutorial] Debug context unavailable, using fallback:', e.message || e);
        return {
            success: false,
            data: {
                system_prompt: "You are a helpful AI assistant. Provide clear, accurate responses.",
                messages: [
                    { role: "user", content: "What's 2+2?" },
                    { role: "assistant", content: "2 + 2 equals 4." }
                ],
                user_prompt: "Tell me a fact about the ocean.",
                max_tokens: 1024,
                temperature: 0.7,
                top_p: 0.95,
                ctx_size: 4096
            }
        };
    }
};
const getMaxPart = () => getTrack().length - 1;

// Tutorial system prompt constants
const TUTORIAL_PROMPT_PIRATE = "You are a friendly pirate assistant. Speak like a pirate in your responses, using phrases like 'ahoy', 'matey', and 'arr', but remain helpful and accurate in your information.";
const TUTORIAL_PROMPT_DEFAULT = "You are a helpful AI assistant. Provide clear, accurate, and friendly responses.";

// Skip-aware wait helper
const waitWithSkip = async (ms) => {
    const sliceMs = 25;
    let elapsed = 0;
    while (elapsed < ms) {
        if (FRT.skipRequested) return;
        await new Promise(r => setTimeout(r, sliceMs));
        elapsed += sliceMs;
    }
};

// Weighted reading pause based on text length
const autoReadPause = async (text) => {
    if (FRT.skipRequested) return;
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
    // Fast-paced: ~450 wpm ≈ 7.5 w/s ≈ 133ms per word; shorter base
    const ms = Math.max(250, Math.min(900, 150 + words * 70));
    await waitWithSkip(ms);
};

const triggerPromptSwapFeedback = () => {
    const readout = document.getElementById('frt-prompt-readout') || FRT.els.optional;

    if (!readout) return;

    // Trigger flash animation on narrator readout
    readout.classList.add('frt-prompt-flash');

    // Remove class after animation completes (900ms)
    setTimeout(() => {
        readout.classList.remove('frt-prompt-flash');
    }, 900);
};

// Helper: Wait for element to appear in DOM
const waitForElementById = (id, timeoutMs = 1200) => {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const check = () => {
            const el = document.getElementById(id);
            if (el) {
                resolve(el);
            } else if (Date.now() - startTime < timeoutMs) {
                requestAnimationFrame(check);
            } else {
                resolve(null);
            }
        };
        check();
    });
};

const handleNarratorHook = (hook) => {
    if (!hook) return;
    if (hook === "SHOW_MODEL_LOADER_RAIL") {
        // Allow rail to be shown, trigger its pulsed state, and adjust narrator panel
        document.body.classList.add('frt-allow-right-rail', 'frt-with-rail', 'frt-pulse-model');

        // Only remove sidebar classes if not yet unlocked
        if (!document.body.classList.contains('frt-right-sidebar-unlocked')) {
            document.body.classList.remove('frt-allow-right-sidebar');
        }

        // Force rail visibility/interactivity
        if (els.rightRail) {
            els.rightRail.classList.remove('hidden');
            els.rightRail.style.display = 'flex';
            els.rightRail.style.opacity = '1';
            els.rightRail.style.pointerEvents = 'auto';
        }

        // Force model button visibility
        const modelBtn = document.getElementById('btn-rail-model');
        if (modelBtn) {
            modelBtn.style.display = 'flex';
        }

        // Ensure right sidebar is closed
        if (els.rightSidebar) els.rightSidebar.classList.remove('visible');
        state.rightSidebarOpen = false;
    }

    if (hook === "ENABLE_SPLIT_CHAT") {
        // Enable split mode with interactive chat
        document.body.classList.add('frt-split-with-chat');
        document.body.classList.remove('frt-split'); // Remove old split mode if present

        // Initialize fresh tutorial history
        state.tutorialHistory = [];

        // Enable chat input and send button
        if (els.prompt) {
            els.prompt.disabled = false;
            els.prompt.placeholder = "Message Localis...";
        }

        if (els.sendBtn) {
            els.sendBtn.classList.add('ready');
            els.sendBtn.style.pointerEvents = 'auto';
        }

        // Make chat area fully interactive - remove tutorial locks
        const chatArea = document.querySelector('.chat-area');
        if (chatArea) {
            chatArea.style.pointerEvents = 'auto';
            chatArea.style.opacity = '1';
        }

        // Update prompt readout
        updateFRTPromptReadout();

        // Unlock input wrapper
        const inputWrapper = document.querySelector('.input-wrapper');
        if (inputWrapper) {
            inputWrapper.style.pointerEvents = 'auto';
            inputWrapper.style.opacity = '1';
        }

        // Remove dim overlay from chat (but keep narrator panel visible)
        // Tutorial overlay remains, but chat is fully active
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.style.pointerEvents = 'auto';
        }

        // Ensure sidebars are closed
        if (els.rightSidebar) els.rightSidebar.classList.remove('visible');
        if (els.sidebar) els.sidebar.classList.remove('collapsed');
        state.rightSidebarOpen = false;
    }

    if (hook === "SWAP_PROMPT_PIRATE") {
        // Swap to pirate prompt
        state.tutorialSystemPromptId = "pirate";
        state.tutorialSystemPromptText = TUTORIAL_PROMPT_PIRATE;
        api.swapPrompt(state.sessionId, TUTORIAL_PROMPT_PIRATE);
        updateFRTPromptReadout();
    }

    if (hook === "SWAP_PROMPT_DEFAULT") {
        // Swap back to default prompt
        state.tutorialSystemPromptId = "default";
        state.tutorialSystemPromptText = TUTORIAL_PROMPT_DEFAULT;
        api.swapPrompt(state.sessionId, TUTORIAL_PROMPT_DEFAULT);
        updateFRTPromptReadout();
    }

    if (hook === "LAUNCH_SYSTEM_PROMPT_RPG") {
        // Choreography: fade → black → show RPG → remove black
        document.body.classList.add('frt-transition-fade');

        setTimeout(() => {
            document.body.classList.add('frt-transition-black');

            setTimeout(() => {
                document.body.classList.remove('frt-transition-fade');

                // Show RPG questionnaire
                if (RPG && RPG.show) {
                    RPG.show();
                }

                // Remove black transition after RPG is visible
                setTimeout(() => {
                    document.body.classList.remove('frt-transition-black');
                }, 100);
            }, 200);
        }, 400);
    }

    if (hook === "LOAD_CONTEXT_PACKET") {
        // Wait for element and display sample context packet
        (async () => {
            const placeholder = await waitForElementById('context-packet-placeholder', 1200);

            if (!placeholder) {
                console.warn('[Tutorial] Context packet placeholder never appeared');
                return;
            }

            // Sample packet (always renders, even offline)
            const samplePacket = {
                system_prompt: "You are a helpful AI assistant. Provide clear, accurate responses.",
                tier_a: {
                    preferred_name: "Rishi",
                    timezone: "America/Montreal"
                },
                tier_b: {
                    projects: ["Localis"],
                    preferences: ["dark mode"]
                },
                recent_messages: [
                    { role: "user", content: "What's the context window?" },
                    { role: "assistant", content: "The context window is your working memory..." }
                ]
            };

            // Render sample packet immediately
            const renderPacket = (data, isReal) => {
                const label = isReal
                    ? '<div style="font-size:0.9em;opacity:0.7;margin-bottom:8px;">📡 Real-time packet from backend:</div>'
                    : '<div style="font-size:0.9em;opacity:0.7;margin-bottom:8px;">📦 Sample context packet:</div>';

                const jsonStr = JSON.stringify(data, null, 2);
                const codeEl = document.createElement('code');
                codeEl.className = 'language-json';
                codeEl.textContent = jsonStr;

                placeholder.innerHTML = label;
                placeholder.style.background = 'rgba(20,20,20,0.8)';
                placeholder.style.padding = '12px';
                placeholder.style.borderRadius = '4px';
                placeholder.style.overflowX = 'auto';
                placeholder.style.maxHeight = '400px';
                placeholder.style.fontSize = '0.75em';
                placeholder.style.lineHeight = '1.4';
                placeholder.style.textAlign = 'left';

                const preEl = document.createElement('pre');
                preEl.style.margin = '0';
                preEl.appendChild(codeEl);
                placeholder.appendChild(preEl);

                // Highlight if hljs available
                if (window.hljs) {
                    try {
                        hljs.highlightElement(codeEl);
                    } catch (e) {
                        console.warn('[Tutorial] hljs highlight failed:', e);
                    }
                }
            };

            // Render sample immediately
            renderPacket(samplePacket, false);

            // Optionally fetch real data (non-blocking, may replace sample)
            fetchDebugContext().then(result => {
                if (result.success && placeholder.isConnected) {
                    renderPacket(result.data, true);
                }
            }).catch(() => {
                // Silently keep sample packet on fetch error
            });
        })();
    }

    if (hook === "SHOW_FINAL_REVIEW") {
        // Open final review overlay and populate data
        const overlay = document.getElementById('final-review-overlay');
        if (!overlay) {
            console.warn('[Tutorial] Final review overlay not found');
            return;
        }

        // Get staged data from sessionStorage
        const systemPrompt = state.tutorialSystemPromptText || sessionStorage.getItem('rpg_system_prompt') || '';
        const tierAJson = sessionStorage.getItem('rpg_tier_a');
        const tierA = tierAJson ? JSON.parse(tierAJson) : {};
        const tierBJson = sessionStorage.getItem('tutorial_tier_b');
        const tierB = tierBJson ? JSON.parse(tierBJson) : {};

        // Populate system prompt
        const promptEl = document.getElementById('final-review-prompt');
        if (promptEl) {
            promptEl.textContent = systemPrompt;
        }

        // Populate Tier A
        const tierAEl = document.getElementById('final-review-tier-a');
        if (tierAEl) {
            let tierAHtml = '';
            const labels = { preferred_name: 'Name', location: 'Location', timezone: 'Timezone', language_preferences: 'Language' };
            for (const [key, label] of Object.entries(labels)) {
                const value = tierA[key] || '—';
                tierAHtml += `<div style="padding:6px 0;"><span style="opacity:0.7;">${label}:</span> <strong>${escapeHtml(String(value))}</strong></div>`;
            }
            tierAEl.innerHTML = tierAHtml || '<div style="opacity:0.5;">No identity data</div>';
        }

        // Populate Tier B (if any)
        const tierBEl = document.getElementById('final-review-tier-b');
        if (tierBEl) {
            if (Object.keys(tierB).length > 0) {
                let tierBHtml = '';
                for (const [key, val] of Object.entries(tierB)) {
                    tierBHtml += `<div style="margin-bottom:8px;"><span style="opacity:0.7;">${escapeHtml(key)}:</span> <strong>${escapeHtml(String(val))}</strong></div>`;
                }
                tierBEl.innerHTML = tierBHtml;
            } else {
                tierBEl.innerHTML = '<div style="opacity:0.5;">No extended memory yet</div>';
            }
        }

        // Show overlay
        overlay.classList.remove('hidden');
    }

    if (hook === "DISABLE_SPLIT_CHAT") {
        // Restore side panel mode - remove all split classes
        document.body.classList.remove('frt-split-with-chat');
        document.body.classList.add('frt-split');

        // Clear tutorial history
        state.tutorialHistory = [];

        // Disable chat input
        if (els.prompt) {
            els.prompt.disabled = true;
            els.prompt.placeholder = "";
            els.prompt.value = ""; // Clear any input
        }

        if (els.sendBtn) {
            els.sendBtn.classList.remove('ready');
            els.sendBtn.style.pointerEvents = 'none';
        }

        // Restore tutorial dim/locked state to chat area
        const chatArea = document.querySelector('.chat-area');
        if (chatArea) {
            chatArea.style.pointerEvents = 'none';
            chatArea.style.opacity = '0.5';
        }

        // Lock input wrapper
        const inputWrapper = document.querySelector('.input-wrapper');
        if (inputWrapper) {
            inputWrapper.style.pointerEvents = 'none';
            inputWrapper.style.opacity = '0.5';
        }

        // Restore main content locked state
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.style.pointerEvents = 'none';
        }

        // Ensure tutorial dim overlay is restored
        if (!document.body.classList.contains('is-dimmed')) {
            document.body.classList.add('is-dimmed');
        }

        // Collapse sidebar back to tutorial state
        if (els.sidebar && !els.sidebar.classList.contains('collapsed')) {
            els.sidebar.classList.add('collapsed');
        }
    }
};

function updateFRTOverflowClass() {
    const el = FRT.els.text;
    if (!el) return;
    const overflowing = el.scrollHeight > (el.clientHeight + 2);
    el.classList.toggle('frt-overflow', overflowing);
}

const setNavEnabled = (enabled) => {
    const { btnNext, btnBack } = FRT.els;
    document.getElementById('frt-nav').classList.toggle('frt-nav-locked', !enabled);
    btnNext.disabled = false;
    btnBack.disabled = (FRT.partIndex <= 1);
};

const clearNarrator = () => {
    FRT.els.text.innerHTML = "";
    FRT.els.optional.innerHTML = "";
    FRT.els.optional.style.opacity = "0.85";
    FRT.els.optional.style.transform = "translateY(0)";
    if (FRT.idleTimer) clearTimeout(FRT.idleTimer);
    updateFRTOverflowClass();
};

const showOptional = async (text, isTransient = false, kind = null) => {
    if (!text) return;
    if (!isTransient && FRT.lastOptionalKind === kind) return;

    FRT.lastOptionalKind = kind;
    FRT.els.optional.innerHTML = "";
    const div = document.createElement('div');
    FRT.els.optional.appendChild(div);

    if (isTransient) {
        await UX.typeBurst(div, text);
        setTimeout(() => {
            FRT.els.optional.style.opacity = "0";
            FRT.els.optional.style.transform = "translateY(5px)";
            setTimeout(() => {
                if (FRT.els.optional.style.opacity === "0") FRT.els.optional.innerHTML = "";
                FRT.els.optional.style.opacity = "0.85";
                FRT.els.optional.style.transform = "translateY(0)";
                FRT.lastOptionalKind = null;
            }, 400);
        }, 1200);
    } else {
        await UX.typeWriter(div, text, 16, { shouldSkip: () => FRT.skipRequested, speedMultiplier: () => (FRT.fastForward ? 6 : 1) });
    }
};

// Helper: Update tutorial system prompt readout
const updateFRTPromptReadout = () => {
    const readoutEl = document.getElementById('frt-prompt-readout') || FRT.els.optional;
    if (!readoutEl) return;

    const promptId = state.tutorialSystemPromptId.toUpperCase();
    const promptText = state.tutorialSystemPromptText;
    const preview = promptText.length > 80 ? promptText.substring(0, 80) + "..." : promptText;

    const readoutHTML = `<div style="opacity: 0.9; font-size: 0.85em; margin-top: 8px;">
        <strong>SYSTEM PROMPT (ACTIVE): ${promptId}</strong><br>
        <span style="opacity: 0.7;">${escapeHtml(preview)}</span>
    </div>`;

    if (document.getElementById('frt-prompt-readout')) {
        document.getElementById('frt-prompt-readout').innerHTML = readoutHTML;
    } else {
        readoutEl.innerHTML = readoutHTML;
    }
};

// Helper: Replace name placeholders in narrator text
const replaceNamePlaceholder = (text) => {
    // If in first-run tutorial AND track is intro or model, always use "user"
    if (document.body.classList.contains('first-run-tutorial') &&
        (FRT.track === "intro" || FRT.track === "model")) {
        return text.replace(/{name}/g, "user");
    }

    // Otherwise, use stored name if available, else "user"
    const name = window.userPreferredName || sessionStorage.getItem('user_preferred_name') || '';
    const finalName = name || "user";

    // For system_prompt, context, memory stages: limit name usage to once per stage
    const limitedTracks = new Set(["system_prompt", "context", "memory"]);
    if (name && limitedTracks.has(FRT.track)) {
        if (!FRT.nameUsedByTrack[FRT.track]) {
            // First use in this track: replace {name} with actual name and mark as used
            FRT.nameUsedByTrack[FRT.track] = true;
            return text.replace(/{name}/g, finalName);
        } else {
            // Already used in this track: remove {name} and any preceding comma/space
            return text.replace(/,\s*\{name\}/g, "").replace(/\{name\}/g, "");
        }
    }

    return text.replace(/{name}/g, finalName);
};

// Helper: Process part steps to replace name placeholders
const processPartWithName = (part) => {
    if (!part || !part.steps) return part;

    // Create a deep copy to avoid mutating the original
    const processed = {
        ...part,
        steps: part.steps.map(step => {
            if (step.type === 'line') {
                return {
                    ...step,
                    segments: step.segments.map(seg => ({
                        ...seg,
                        text: replaceNamePlaceholder(seg.text)
                    }))
                };
            } else if (step.type === 'list') {
                return {
                    ...step,
                    items: step.items.map(item => replaceNamePlaceholder(item))
                };
            }

            const nextStep = { ...step };
            if (nextStep.idleLine) nextStep.idleLine = replaceNamePlaceholder(nextStep.idleLine);
            if (nextStep.clickAttemptLine) nextStep.clickAttemptLine = replaceNamePlaceholder(nextStep.clickAttemptLine);
            if (nextStep.typingAttemptLine) nextStep.typingAttemptLine = replaceNamePlaceholder(nextStep.typingAttemptLine);
            if (nextStep.earlyClickLine) nextStep.earlyClickLine = replaceNamePlaceholder(nextStep.earlyClickLine);
            return nextStep;
        })
    };

    if (processed.idleLine) processed.idleLine = replaceNamePlaceholder(processed.idleLine);
    if (processed.clickAttemptLine) processed.clickAttemptLine = replaceNamePlaceholder(processed.clickAttemptLine);
    if (processed.typingAttemptLine) processed.typingAttemptLine = replaceNamePlaceholder(processed.typingAttemptLine);
    if (processed.earlyClickLine) processed.earlyClickLine = replaceNamePlaceholder(processed.earlyClickLine);

    return processed;
};

// Helper: Remove auto-advance interaction listeners
const removeAutoAdvanceListeners = () => {
    FRT.interactionListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    FRT.interactionListeners = [];
};

// Helper: Cancel auto-advance on user interaction
const cancelAutoAdvanceOnInteraction = () => {
    if (FRT.autoAdvanceTimer) {
        clearTimeout(FRT.autoAdvanceTimer);
        FRT.autoAdvanceTimer = null;
    }
    FRT.autoAdvanceBlocked = true;
    removeAutoAdvanceListeners();
};

const renderPart = async (index) => {
    const track = getTrack();
    let part = track[index];
    if (!part) return;

    // Process name placeholders
    part = processPartWithName(part);

    FRT.partIndex = index;
    FRT.isTyping = true;
    FRT.skipRequested = false;
    setNavEnabled(false);
    clearNarrator();

    // Clear any existing auto-advance timer and interaction listeners
    if (FRT.autoAdvanceTimer) {
        clearTimeout(FRT.autoAdvanceTimer);
        FRT.autoAdvanceTimer = null;
    }
    FRT.autoAdvanceBlocked = false;
    removeAutoAdvanceListeners();

    // Activate orb typing state
    const orb = document.getElementById('narrator-orb');
    if (orb) {
        orb.classList.add('orb-typing');
    }

    // Execute hook BEFORE steps begin
    if (part.onEnter) handleNarratorHook(part.onEnter);

    for (const step of part.steps) {
        if (step.type === "line") {
            const lineDiv = document.createElement('div');
            lineDiv.className = `frt-block ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            FRT.els.text.appendChild(lineDiv);
            updateFRTOverflowClass();

            let fullText = "";
            const isInstant = step.instant === true;

            for (const seg of step.segments) {
                const span = document.createElement('span');
                if (seg.className) span.className = seg.className;
                lineDiv.appendChild(span);

                if (isInstant) {
                    span.textContent = seg.text;
                } else {
                    await UX.typeWriter(span, seg.text, 18, { shouldSkip: () => FRT.skipRequested, speedMultiplier: () => (FRT.fastForward ? 6 : 1) });
                }
                fullText += seg.text;
            }

            if (!isInstant) {
                await autoReadPause(fullText);
            }

        } else if (step.type === "pause") {
            if (FRT.skipRequested) continue;
            await waitWithSkip(step.ms * 0.6);
        } else if (step.type === "list") {
            const listDiv = document.createElement('div');
            listDiv.className = `frt-block ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            const ul = document.createElement('ul');
            ul.style.listStyle = "none";
            listDiv.appendChild(ul);
            FRT.els.text.appendChild(listDiv);
            updateFRTOverflowClass();

            for (const item of step.items) {
                const li = document.createElement('li');
                li.style.marginBottom = "8px";
                const bulletSpan = document.createElement('span');
                const textSpan = document.createElement('span');
                li.appendChild(bulletSpan);
                li.appendChild(textSpan);
                ul.appendChild(li);

                await UX.typeWriter(bulletSpan, "• ", 18, { shouldSkip: () => FRT.skipRequested, speedMultiplier: () => (FRT.fastForward ? 6 : 1) });
                await UX.typeWriter(textSpan, item, 18, { shouldSkip: () => FRT.skipRequested, speedMultiplier: () => (FRT.fastForward ? 6 : 1) });

                await autoReadPause(item);
                updateFRTOverflowClass();
            }
        } else if (step.type === "dotsErase") {
            const lineDiv = document.createElement('div');
            lineDiv.className = `frt-block ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            const span = document.createElement('span');
            lineDiv.appendChild(span);
            FRT.els.text.appendChild(lineDiv);
            updateFRTOverflowClass();

            await UX.typeWriter(span, "...", step.speed || 90, { shouldSkip: () => FRT.skipRequested, speedMultiplier: () => (FRT.fastForward ? 6 : 1) });

            if (!FRT.skipRequested) {
                await waitWithSkip(step.pauseMs || 350);
                for (let i = 0; i < 3; i++) {
                    if (FRT.skipRequested) break;
                    span.textContent = span.textContent.slice(0, -1);
                    await waitWithSkip(step.eraseSpeed || 70);
                }
            }
            lineDiv.remove();
            updateFRTOverflowClass();
        } else if (step.type === "img" || step.type === "image") {
            const img = document.createElement('img');
            img.src = step.src;
            img.className = (step.align === 'left' ? 'frt-left' : 'frt-center');
            FRT.els.text.appendChild(img);
            updateFRTOverflowClass();
        } else if (step.type === "ascii") {
            const pre = document.createElement('pre');
            pre.className = `frt-block frt-ascii ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            // Safety: only allow innerHTML for static content defined in this file
            if (step.__static === true && step.html) {
                pre.innerHTML = step.html;
            } else if (step.text) {
                pre.textContent = step.text;
            }
            FRT.els.text.appendChild(pre);
            updateFRTOverflowClass();
        } else if (step.type === "html") {
            const div = document.createElement('div');
            div.className = `frt-block frt-html ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            // Safety: only allow innerHTML for static content defined in this file
            if (step.__static === true && step.html) {
                div.innerHTML = step.html;
            } else if (step.text) {
                div.textContent = step.text;
            }
            FRT.els.text.appendChild(div);
            updateFRTOverflowClass();
        } else if (step.type === "code") {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            pre.className = `frt-block frt-code ${step.align === 'left' ? 'frt-left' : 'frt-center'}`;
            pre.appendChild(code);
            // Safety: only allow innerHTML for static content defined in this file
            if (step.__static === true && step.html) {
                code.innerHTML = step.html;
            } else if (step.text) {
                code.textContent = step.text;
            }
            FRT.els.text.appendChild(pre);
            updateFRTOverflowClass();
        }
    }

    FRT.isTyping = false;
    FRT.skipRequested = false;
    setNavEnabled(true);
    updateFRTOverflowClass();

    // Deactivate orb typing state
    const orbEnd = document.getElementById('narrator-orb');
    if (orbEnd) {
        orbEnd.classList.remove('orb-typing');
    }

    // Handle required action gates
    if (part.requires) {
        FRT.requiredAction.kind = part.requires.kind;
        FRT.requiredAction.satisfied = false;
        FRT.requiredAction.attempts = 0;
        // Don't reset baselineQuestion - preserve it for chat_repeat gate
        // It will be overwritten by chat_any when needed
        // FRT.requiredAction.baselineQuestion = null;
        FRT.requiredAction.soft_after = part.requires.soft_after || 999;
        document.getElementById('frt-nav').classList.add('frt-nav-locked');
    } else {
        FRT.requiredAction.kind = null;
        FRT.requiredAction.satisfied = true;
        FRT.requiredAction.attempts = 0;
        // Don't reset baselineQuestion - preserve for chat_repeat gate across non-gate parts
        // FRT.requiredAction.baselineQuestion = null;
        document.getElementById('frt-nav').classList.remove('frt-nav-locked');
    }

    // Handle the end of Page 3B (Part 4)
    if (FRT.track === "model" && FRT.partIndex === 4) {
        document.getElementById('frt-nav').classList.add('frt-nav-locked');
        showOptional("Click the blinking model icon on the right.", false, "final-instruction");
    }

    const idleDelay = part.idleDelayMs || 11000;
    FRT.idleTimer = setTimeout(() => {
        if (!FRT.isTyping && FRT.partIndex === index && part.idleLine) {
            showOptional(part.idleLine, false, "idle");
        }
    }, idleDelay);

    // Auto-advance eligibility check
    const isEligibleForAutoAdvance =
        document.body.classList.contains('first-run-tutorial') &&
        FRT.stage === "script" &&
        !(FRT.track === "model" && FRT.partIndex === 4) &&
        !document.body.classList.contains('frt-split-with-chat') &&
        !(part.onEnter === "ENABLE_SPLIT_CHAT" || part.onEnter === "LAUNCH_SYSTEM_PROMPT_RPG") &&
        !FRT.autoAdvanceBlocked;

    if (isEligibleForAutoAdvance) {
        FRT.autoAdvanceTimer = setTimeout(() => {
            // Guard: only advance if still on same page and not typing
            if (FRT.partIndex === index && !FRT.isTyping) {
                // Trigger same behavior as clicking Next
                FRT.els.btnNext.click();
            }
        }, 1500);

        // Attach interaction listeners to cancel auto-advance
        const overlay = document.getElementById('frt-overlay');
        if (overlay) {
            const events = ['wheel', 'keydown', 'pointerdown', 'click', 'touchstart'];
            events.forEach(eventName => {
                const handler = () => cancelAutoAdvanceOnInteraction();
                overlay.addEventListener(eventName, handler, { once: true, passive: true });
                FRT.interactionListeners.push({ element: overlay, event: eventName, handler });
            });
        }
    }
};

const enterFirstRunStep1 = async () => {
    // Check for existing RPG system prompt from previous session
    const storedPrompt = sessionStorage.getItem('rpg_system_prompt');
    if (storedPrompt) {
        state.tutorialSystemPromptId = "custom";
        state.tutorialSystemPromptText = storedPrompt;
    }

    FRT.stage = "boot";
    document.body.classList.add('first-run-tutorial', 'is-dimmed', 'frt-boot');
    const overlay = document.getElementById('frt-overlay');
    if(overlay) overlay.style.display = 'flex';

    const narratorText = document.getElementById('frt-text');
    if(narratorText) narratorText.innerHTML = 'System Online. No model loaded.';

    setNavEnabled(true);
    FRT.els.btnBack.disabled = true;

    if(els.prompt) els.prompt.disabled = true;
    if(els.sendBtn) {
        els.sendBtn.classList.remove('ready');
        els.sendBtn.style.pointerEvents = 'none';
    }
    updateFRTOverflowClass();

    // Auto-hide tip after 10 seconds
    const tip = document.getElementById('frt-tip');
    if (tip) {
        tip.classList.remove('frt-tip-hidden');
        if (FRT.tipHideTimer) clearTimeout(FRT.tipHideTimer);
        FRT.tipHideTimer = setTimeout(() => {
            tip.classList.add('frt-tip-hidden');
        }, 10000);
    }

    // Render the first part of the intro track to display tutorial content
    FRT.stage = "script";
    await renderPart(1);
};

// --- TOAST NOTIFICATION ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 6px;
        font-size: 0.9rem;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- DOM ELEMENTS ---
const els = {
    chatHistory: document.getElementById('chat-history'),
    sessionList: document.getElementById('session-list'),
    sessionTitle: document.getElementById('session-title'),
    prompt: document.getElementById('prompt'),
    sendBtn: document.getElementById('send-btn'),
    btnSearchToggle: document.getElementById('btn-search-toggle'),
    modelSelect: document.getElementById('model-select'),
    modelMetaDisplay: document.getElementById('model-metadata-display'),
    btnLoad: document.getElementById('btn-load'),
    btnUnload: document.getElementById('btn-unload'),
    btnOpenModelsDir: document.getElementById('btn-open-models-dir'),
    modelStatus: document.getElementById('model-status'),
    systemPromptEditor: document.getElementById('system-prompt-editor'),
    btnSavePrompt: document.getElementById('btn-save-prompt'),
    btnResetPrompt: document.getElementById('btn-reset-prompt'),
    promptStatus: document.getElementById('prompt-status'),
    modelDisplay: document.getElementById('model-display'),
    tuiPrefix: document.getElementById('tui-prefix'),
    btnNewChat: document.getElementById('btn-new-chat'),
    statusDot: document.getElementById('status-dot'),
    connStatus: document.getElementById('conn-status'),
    rightSidebar: document.getElementById('right-sidebar'),
    rightRail: document.getElementById('right-rail'),
    btnOpenSettings: document.getElementById('btn-right-sidebar-toggle') || document.getElementById('btn-open-settings-sidebar') || document.getElementById('btn-open-settings-rail'),
    btnOpenSettingsSidebar: document.getElementById('btn-open-settings-sidebar'),
    btnOpenSettingsRail: document.getElementById('btn-open-settings-rail'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    sidebar: document.getElementById('sidebar'),
    btnSidebarToggle: document.getElementById('btn-sidebar-toggle'),
    memMatrixContainer: document.getElementById('memory-matrix-container'),
    webUplinkContainer: document.getElementById('web-uplink-container'),
    memTierA: document.getElementById('mem-tier-a'),
    memTierB: document.getElementById('mem-tier-b-tags'),
    dispWebMode: document.getElementById('disp-web-mode'),
    dispWebProvider: document.getElementById('disp-web-provider'),
    toolsPickerBtn: document.getElementById('tools-picker-btn'),
    toolsPickerModal: document.getElementById('tools-picker-modal'),
    toolsChipRow: document.getElementById('tools-chip-row'),
    voiceMicBtn: document.getElementById('voice-mic-btn'),
    voiceModeToggle: document.getElementById('voice-mode-toggle'),
    voiceCancelBar: document.getElementById('voice-cancel-bar'),
    voiceCancelBtn: document.getElementById('voice-cancel-btn'),
    voiceCancelCountdown: document.getElementById('voice-cancel-countdown'),
    wakewordToggleBtn: document.getElementById('wakeword-toggle-btn'),
    voiceStatusBar: document.getElementById('voice-status-bar'),
    voiceStatusLabel: document.querySelector('#voice-status-bar .voice-status-label'),
    voiceStatusTag: document.querySelector('#voice-status-bar .voice-status-tag'),
    inputs: {
        layers: document.getElementById('num-layers'),
        ctx: document.getElementById('num-ctx'),
        temp: document.getElementById('num-temp')
    },
    sliders: {
        layers: document.getElementById('slider-layers'),
        ctx: document.getElementById('slider-ctx'),
        temp: document.getElementById('slider-temp')
    },
    btnStopServer: document.getElementById('btn-stop-server'),
    stopServerStatus: document.getElementById('stop-server-status'),
    // New elements — right sidebar quick controls (UI redesign)
    rsbLightsName:   document.getElementById('rsb-lights-name'),
    rsbLightsToggle: document.getElementById('rsb-lights-toggle'),
    rsbLightsPct:    document.getElementById('rsb-lights-pct'),
    rsbLightsAgo:    document.getElementById('rsb-lights-ago'),
    rsbBulbFill:     document.getElementById('rsb-bulb-fill'),
    rsbBulbLine:     document.getElementById('rsb-bulb-line'),
    rsbModelName:    document.getElementById('rsb-model-name'),
    rsbModelStatus:  document.getElementById('rsb-model-status'),
    rsbModelChips:   document.getElementById('rsb-model-chips'),
    rsbCpuVal:       document.getElementById('rsb-cpu-val'),
    rsbCpuBar:       document.getElementById('rsb-cpu-bar'),
    rsbRamVal:       document.getElementById('rsb-ram-val'),
    rsbRamBar:       document.getElementById('rsb-ram-bar'),
    rsbVramVal:      document.getElementById('rsb-vram-val'),
    rsbVramBar:      document.getElementById('rsb-vram-bar'),
    rsbCtxAscii:     document.getElementById('rsb-ctx-ascii'),
    rsbCtxTokens:    document.getElementById('rsb-ctx-tokens'),
    rsbCtxPct:       document.getElementById('rsb-ctx-pct'),
    rsbBulb:             document.getElementById('rsb-bulb'),
    rsbBrightnessCtrl:   document.getElementById('rsb-brightness-ctrl'),
    rsbBrightnessSlider: document.getElementById('rsb-brightness-slider'),
    rsbKelvinCtrl:       document.getElementById('rsb-kelvin-ctrl'),
    rsbKelvinSlider:     document.getElementById('rsb-kelvin-slider'),
    rsbModelList:        document.getElementById('rsb-model-list'),
    rsbModelTrigger:     document.getElementById('rsb-model-trigger'),
    rsbBtnLoadModel:     document.getElementById('rsb-btn-load-model'),
    rsbBtnUnloadModel:   document.getElementById('rsb-btn-unload-model'),
    modalProfileTags:      document.getElementById('modal-profile-tags'),
    modalSystemPrompt:     document.getElementById('system-prompt-modal-editor'),
    btnEditPromptSidebar:  document.getElementById('btn-edit-prompt-sidebar'),
    leftSidebarToggle:     document.getElementById('left-sidebar-toggle'),
    rightSidebarToggle:    document.getElementById('right-sidebar-toggle'),
    tbModelName:           document.getElementById('tb-model-name'),
    btnTopSettings:        document.getElementById('btn-top-settings'),
    chatZone:              document.getElementById('chat-zone'),
    tokenEstimate:         document.getElementById('token-estimate'),
    welcomeState:          document.getElementById('welcome-state'),
};

// ============================================================
// voiceStatusBar — slim glass pill showing voice pipeline state
// ============================================================
const voiceStatusBar = (() => {
    let _doneTimer = null;

    const STATE_MAP = {
        // wakewordUI states
        idle:         { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
        recording:    { label: 'Hey Jarvis — listening…', tag: 'triggered', color: 'amber' },
        transcribing: { label: 'Transcribing…',    tag: 'stt',       color: 'amber' },
        submitting:   { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
        cooldown:     { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
        disabled:     { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
        // voiceUI states
        listening:    { label: 'Listening…',       tag: 'recording', color: 'amber' },
        confirming:   { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
        waiting:      { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
        speaking:     { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
        // done (synthetic)
        done:         { label: 'Done',             tag: 'success',   color: 'green' },
    };

    function _apply(key) {
        const bar   = els.voiceStatusBar;
        const label = els.voiceStatusLabel;
        const tag   = els.voiceStatusTag;
        if (!bar) return;
        const s = STATE_MAP[key] || STATE_MAP.idle;
        bar.classList.remove('amber', 'green');
        if (s.color) bar.classList.add(s.color);
        if (label) label.textContent = s.label;
        if (tag)   tag.textContent   = s.tag;
    }

    function show() { els.voiceStatusBar?.classList.remove('hidden'); }
    function hide() { els.voiceStatusBar?.classList.add('hidden');    }

    function setState(state) {
        clearTimeout(_doneTimer);
        _apply(state);
    }

    function setDone() {
        clearTimeout(_doneTimer);
        _apply('done');
        _doneTimer = setTimeout(() => setState('idle'), 2000);
    }

    function init() {
        wakewordUI.onStateChange(state => setState(state));
        voiceUI.onStateChange(state => setState(state));
    }

    return { show, hide, setState, setDone, init };
})();

// ============================================================
// FINANCE UI MODULE
// ============================================================
const financeUI = (function() {
    let _open = false;
    let _currentPeriod = 'All time';
    let _onboardingStarted = false;
    let lineChart = null;
    let donutChart = null;

    // --- Panel open/close ---
    function open() {
        _open = true;
        const panel = document.getElementById('finance-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        _checkOnboarding();
    }

    function close() {
        _open = false;
        const panel = document.getElementById('finance-panel');
        if (panel) panel.classList.add('hidden');
        // Destroy charts to free canvas memory
        if (lineChart) { lineChart.destroy(); lineChart = null; }
        if (donutChart) { donutChart.destroy(); donutChart = null; }
    }

    // --- Tab switching ---
    function _activateTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.fin-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
            btn.setAttribute('aria-selected', btn.dataset.tab === tabName);
        });
        // Update panes
        const paneMap = {
            dashboard: 'fin-pane-dashboard',
            chat: 'fin-pane-chat',
            onboarding: 'fin-pane-onboarding',
        };
        Object.values(paneMap).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });
        const activePane = document.getElementById(paneMap[tabName]);
        if (activePane) { activePane.classList.remove('hidden'); activePane.classList.add('active'); }
    }

    // --- Period selector population (calls /finance/periods) ---
    async function _loadPeriods() {
        try {
            const res = await fetch('/finance/periods');
            const data = await res.json();
            const select = document.getElementById('fin-period-select');
            if (!select) return;
            const current = select.value;
            select.innerHTML = '<option value="all">All time</option>';
            (data.periods || []).forEach(p => {
                const [y, m] = p.split('-');
                const dt = new Date(parseInt(y), parseInt(m) - 1);
                const label = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = label;
                select.appendChild(opt);
            });
            if ([...select.options].some(o => o.value === current)) select.value = current;
        } catch(e) { console.warn('[Finance] Failed to load periods:', e); }
    }

    // --- Onboarding check ---
    async function _checkOnboarding() {
        try {
            const res = await fetch('/finance/status');
            if (!res.ok) { _activateTab('dashboard'); return; }
            const data = await res.json();

            // Populate period selector from /finance/periods
            await _loadPeriods();

            if (!data.onboarding_done) {
                // First open — show onboarding pane
                // Hide tab bar tabs (onboarding is not a tab users switch to manually)
                document.querySelectorAll('.fin-tab').forEach(t => t.style.display = 'none');
                _activateTab('onboarding');
                _startOnboarding();
            } else {
                document.querySelectorAll('.fin-tab').forEach(t => t.style.display = '');
                _activateTab('dashboard');
                _loadDashboard(_currentPeriod);
            }
        } catch (e) {
            // Server not running or finance not registered yet — default to dashboard
            _activateTab('dashboard');
        }
    }

    // --- Dashboard loading (Plan 05) ---
    async function _loadDashboard(period) {
        try {
            period = period || 'all';
            const encodedPeriod = encodeURIComponent(period);
            const res = await fetch(`/finance/dashboard_data?period=${encodedPeriod}`);
            if (!res.ok) return;
            const data = await res.json();

            // Show/hide empty state
            const emptyState = document.getElementById('fin-empty-state');
            const hasData = data.transactions && data.transactions.length > 0;
            if (emptyState) emptyState.classList.toggle('hidden', hasData);

            if (!hasData) {
                renderLineChart([]);
                renderDonutChart([]);
                return;
            }

            renderCategories(data.categories);
            renderBudgetActual(data.categories, data.budgets);   // existing — targets hidden div
            renderBudgetSidebar(data.categories, data.budgets);  // NEW — targets sidebar
            renderTrend(data.trend);
            renderTransactions(data.transactions);
            renderLineChart(data.trend);        // Chart.js line chart
            renderDonutChart(data.categories);  // Chart.js donut chart
        } catch(e) {
            // Dashboard not yet available — show empty state
        }
    }

    function renderCategories(categories) {
        const container = document.getElementById('fin-categories-chart');
        if (!container) return;
        if (!categories || categories.length === 0) { container.innerHTML = '<p class="fin-empty-hint">No spending data for this period.</p>'; return; }

        const maxTotal = Math.max(...categories.map(c => c.total));
        container.innerHTML = categories.map((cat, i) => {
            const pct = maxTotal > 0 ? (cat.total / maxTotal * 100).toFixed(1) : 0;
            const isDominant = i === 0; // sorted by total DESC — first is dominant
            return `
              <div class="fin-bar-row">
                <span class="fin-bar-label">${cat.category}</span>
                <div class="fin-bar-track">
                  <div class="fin-bar-fill ${isDominant ? 'fin-dominant' : ''}" style="--pct:${pct}"></div>
                </div>
                <span class="fin-bar-amount">$${cat.total.toFixed(2)}</span>
              </div>`;
        }).join('');
        // Trigger CSS transition: set --pct via JS after paint
        requestAnimationFrame(() => {
            container.querySelectorAll('.fin-bar-fill').forEach((el, i) => {
                const cat = categories[i];
                const pct = maxTotal > 0 ? (cat.total / maxTotal * 100).toFixed(1) : 0;
                el.style.setProperty('--pct', pct);
            });
        });
    }

    function renderBudgetActual(categories, budgets) {
        const container = document.getElementById('fin-budget-chart');
        const hint = document.getElementById('fin-set-budgets-hint');
        if (!container) return;

        const ALL_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Health & Fitness', 'Government & Fees', 'Other'];
        const spendMap = {};
        (categories || []).forEach(c => { spendMap[c.category] = c.total; });
        budgets = budgets || {};

        const hasBudgets = Object.keys(budgets).length > 0;
        const hasSpend = Object.keys(spendMap).length > 0;

        if (!hasBudgets && !hasSpend) {
            if (hint) hint.classList.remove('hidden');
            container.innerHTML = '<p class="fin-empty-hint">No spending data for this period.</p>';
            return;
        }

        if (hint) hint.classList.toggle('hidden', hasBudgets);

        const rows = ALL_CATEGORIES.map(cat => {
            const actual = spendMap[cat] || 0;
            const budget = budgets[cat] || 0;
            const hasBudget = budget > 0;
            const pct = hasBudget ? Math.min((actual / budget) * 100, 100).toFixed(1) : 0;
            const barClass = hasBudget
                ? (actual > budget ? 'fin-bar-fill fin-bar-red'
                   : actual / budget >= 0.85 ? 'fin-bar-fill fin-bar-amber'
                   : 'fin-bar-fill')
                : 'fin-bar-fill';
            if (actual === 0 && !hasBudget) return ''; // skip empty categories

            return `<div class="fin-bar-row">
                <span class="fin-bar-label">${cat}</span>
                <div class="fin-bar-track">
                    <div class="${barClass}" style="--pct:${pct}"></div>
                </div>
                <span class="fin-bar-amount">$${actual.toFixed(2)}${hasBudget ? ' / $' + budget.toFixed(0) : ''}</span>
            </div>`;
        }).filter(r => r).join('');

        container.innerHTML = rows || '<p class="fin-empty-hint">No spending data for this period.</p>';
    }

    function renderBudgetSidebar(categories, budgets) {
        const container = document.getElementById('fin-budget-sidebar-rows');
        if (!container) return;

        const ALL_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Health & Fitness', 'Government & Fees', 'Other'];
        const spendMap = {};
        (categories || []).forEach(c => { spendMap[c.category] = c.total; });
        budgets = budgets || {};

        const rows = ALL_CATEGORIES.map(cat => {
            const actual = spendMap[cat] || 0;
            const budget = budgets[cat] || 0;
            const hasBudget = budget > 0;
            const pct = hasBudget ? Math.min((actual / budget) * 100, 100) : 0;

            // Determine bar color class
            let fillClass = 'fin-budget-fill';
            if (hasBudget) {
                if (actual > budget) fillClass += ' red';
                else if (actual / budget >= 0.85) fillClass += ' amber';
            }

            const trackClass = hasBudget ? 'fin-budget-track' : 'fin-budget-track no-budget';
            const amountText = hasBudget
                ? `$${actual.toFixed(0)} / $${budget.toFixed(0)}`
                : `$${actual.toFixed(0)}`;
            const noBudgetLabel = hasBudget ? '' : '<span class="fin-budget-no-label">No budget</span>';

            return `
                <div class="fin-budget-row">
                    <div class="fin-budget-row-header">
                        <span class="fin-budget-cat-name">${cat}</span>
                        <span class="fin-budget-cat-amounts">${amountText} ${noBudgetLabel}</span>
                    </div>
                    <div class="${trackClass}">
                        <div class="${fillClass}" style="--pct:0"></div>
                    </div>
                </div>`;
        });

        container.innerHTML = rows.join('');

        // RAF: trigger CSS transitions after innerHTML renders
        requestAnimationFrame(() => {
            container.querySelectorAll('.fin-budget-fill').forEach((el, i) => {
                const cat = ALL_CATEGORIES[i];
                const actual = spendMap[cat] || 0;
                const budget = budgets[cat] || 0;
                const hasBudget = budget > 0;
                const pct = hasBudget ? Math.min((actual / budget) * 100, 100) : 0;
                el.style.setProperty('--pct', pct);
            });
        });
    }

    function renderTrend(trend) {
        const container = document.getElementById('fin-trend-chart');
        if (!container) return;
        if (!trend || trend.length === 0) { container.innerHTML = '<p class="fin-empty-hint">Upload multiple months to see trend.</p>'; return; }

        const maxSpend = Math.max(...trend.map(t => t.total));
        container.innerHTML = trend.map(t => {
            const pct = maxSpend > 0 ? (t.total / maxSpend * 100).toFixed(1) : 0;
            // Format "2026-01" as "Jan 2026"
            const [y, m] = t.period.split('-');
            const dt = new Date(parseInt(y), parseInt(m) - 1);
            const label = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return `
              <div class="fin-bar-row">
                <span class="fin-bar-label">${label}</span>
                <div class="fin-bar-track">
                  <div class="fin-bar-fill" style="--pct:${pct}"></div>
                </div>
                <span class="fin-bar-amount">$${t.total.toFixed(2)}</span>
              </div>`;
        }).join('');
    }

    function renderLineChart(trendData) {
        const canvas = document.getElementById('fin-line-chart');
        const overlay = canvas?.parentElement?.querySelector('.fin-chart-empty-overlay');
        if (!canvas) return;

        // Empty state
        if (!trendData || trendData.length === 0) {
            if (overlay) overlay.classList.remove('hidden');
            if (lineChart) { lineChart.destroy(); lineChart = null; }
            return;
        }
        if (overlay) overlay.classList.add('hidden');

        // Format YYYY-MM as "Jan 2026"
        const labels = trendData.map(t => {
            const [y, m] = t.period.split('-');
            const dt = new Date(parseInt(y), parseInt(m) - 1);
            return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        const amounts = trendData.map(t => parseFloat(t.total) || 0);

        if (lineChart) lineChart.destroy();
        lineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Monthly Spend',
                    data: amounts,
                    borderColor: '#5A8CFF',
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: 'rgba(90, 140, 255, 0.08)',
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,15,15,0.9)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderWidth: 1,
                        titleColor: '#fff',
                        bodyColor: 'rgba(255,255,255,0.7)',
                        padding: 8,
                        displayColors: false,
                        callbacks: {
                            label: function(ctx) { return '$' + ctx.parsed.y.toFixed(2); }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 11 } },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.3)',
                            font: { size: 11 },
                            callback: function(v) { return '$' + v; }
                        },
                        beginAtZero: true,
                    }
                }
            }
        });
    }

    function renderDonutChart(categoryData) {
        const canvas = document.getElementById('fin-donut-chart');
        const overlay = canvas?.parentElement?.querySelector('.fin-chart-empty-overlay');
        if (!canvas) return;

        // Filter to categories with spend > 0, sort by amount descending
        const data = (categoryData || []).filter(c => (c.total || 0) > 0)
            .sort((a, b) => b.total - a.total);

        // Empty state
        if (data.length === 0) {
            if (overlay) overlay.classList.remove('hidden');
            if (donutChart) { donutChart.destroy(); donutChart = null; }
            return;
        }
        if (overlay) overlay.classList.add('hidden');

        // 8-slot blue tint palette (matches UI-SPEC)
        const colors = [
            'rgba(90, 140, 255, 1)',
            'rgba(90, 140, 255, 0.85)',
            'rgba(90, 140, 255, 0.7)',
            'rgba(90, 140, 255, 0.55)',
            'rgba(90, 140, 255, 0.4)',
            'rgba(90, 140, 255, 0.28)',
            'rgba(90, 140, 255, 0.18)',
            'rgba(90, 140, 255, 0.10)',
        ];

        const labels = data.map(c => c.category);
        const amounts = data.map(c => parseFloat(c.total) || 0);
        const total = amounts.reduce((a, b) => a + b, 0);

        if (donutChart) donutChart.destroy();
        donutChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: amounts,
                    backgroundColor: colors.slice(0, data.length),
                    borderColor: 'rgba(15,15,15,0.45)',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255,255,255,0.6)',
                            padding: 12,
                            font: { size: 11 },
                            generateLabels: function(chart) {
                                const ds = chart.data.datasets[0];
                                return chart.data.labels.map((label, i) => ({
                                    text: label + ' (' + Math.round((ds.data[i] / total) * 100) + '%)',
                                    fillStyle: ds.backgroundColor[i],
                                    index: i,
                                }));
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15,15,15,0.9)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderWidth: 1,
                        titleColor: '#fff',
                        bodyColor: 'rgba(255,255,255,0.7)',
                        callbacks: {
                            label: function(ctx) {
                                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                                return ctx.label + ': $' + ctx.parsed.toFixed(2) + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    function renderTransactions(transactions) {
        const container = document.getElementById('fin-tx-list');
        if (!container) return;
        if (!transactions || transactions.length === 0) { container.innerHTML = '<p class="fin-empty-hint" style="padding:12px 4px">No transactions for this period.</p>'; return; }

        container.innerHTML = transactions.map(tx => {
            const isCredit = tx.type === 'credit';
            const amountStr = `$${tx.amount.toFixed(2)}`;
            const creditTag = isCredit ? '<span class="fin-tx-credit-tag">&#8593; Credit</span>' : '';
            return `
              <div class="fin-tx-row">
                <span class="fin-tx-date">${tx.date}</span>
                <span class="fin-tx-desc" title="${tx.description}">${tx.description}</span>
                <span class="fin-tx-cat">${tx.category}</span>
                <span class="fin-tx-amount ${isCredit ? 'fin-tx-credit' : ''}">${amountStr}${creditTag}</span>
              </div>`;
        }).join('');
    }

    // --- Onboarding step machine (Plan 05) ---
    function _startOnboarding() {
        // Guard: only start once per panel lifetime; reset by _completeOnboarding/_skipBtn
        if (_onboardingStarted) return;
        _onboardingStarted = true;

        const historyEl = document.getElementById('fin-onboarding-history');
        const inputEl = document.getElementById('fin-onboarding-input');
        const sendBtn = document.getElementById('fin-onboarding-send');
        const skipBtn = document.getElementById('fin-onboarding-skip');
        if (!historyEl || !inputEl) { _onboardingStarted = false; return; }

        const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Health & Fitness', 'Government & Fees', 'Other'];
        const STEPS = [
            {
                prompt: "Hey there! I'm here to help you understand your spending. First — what are you mainly saving toward? Feel free to say something like \"saving more each month\", \"planning for a vacation\", \"building an emergency fund\", or anything else on your mind.",
                key: 'goal_type',
            },
            {
                prompt: "Thanks for sharing that. Are there any specific life events you're planning toward — like a vacation, a wedding, buying a house, or building an emergency fund? You can mention a few, or say \"nothing specific right now\".",
                key: 'life_events',
            },
            {
                prompt: "Got it. Now let's set some monthly spending targets. You can fill in as many or as few as you like — just leave ones you're not sure about at $0.",
                key: 'budgets',
                isForm: true,
            },
            {
                prompt: "Last question — what's your time horizon for these goals? Are you thinking in terms of months, or a few years?",
                key: 'horizon',
            },
        ];

        let step = 0;
        const answers = { goal_type: '', life_events: [], budgets: {}, horizon: '' };

        function _appendMsg(role, text) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = buildMessageHTML(role, text);
            historyEl.appendChild(wrapper);
            historyEl.scrollTop = historyEl.scrollHeight;
        }

        function _appendBudgetForm() {
            const formDiv = document.createElement('div');
            formDiv.className = 'fin-onboarding-budget-form';
            formDiv.innerHTML = `
              <div class="fin-budget-form-grid">
                ${CATEGORIES.map(cat => `
                  <label class="fin-budget-form-row">
                    <span class="fin-budget-form-label">${cat}</span>
                    <span class="fin-budget-form-dollar">$</span>
                    <input type="number" class="fin-budget-form-input" data-cat="${cat}" placeholder="0" min="0" step="1">
                  </label>`).join('')}
              </div>
              <button id="fin-budget-submit" class="fin-confirm-btn" style="margin-top:12px">Save budgets &#8594;</button>
            `;
            historyEl.appendChild(formDiv);
            historyEl.scrollTop = historyEl.scrollHeight;

            formDiv.querySelector('#fin-budget-submit').addEventListener('click', () => {
                const budgets = {};
                formDiv.querySelectorAll('.fin-budget-form-input').forEach(inp => {
                    const val = parseFloat(inp.value) || 0;
                    budgets[inp.dataset.cat] = val;
                });
                answers.budgets = budgets;
                _appendMsg('user', 'Monthly budgets set: ' + (CATEGORIES.filter(c => budgets[c] > 0).map(c => `${c} $${budgets[c]}`).join(', ') || 'All skipped'));
                // Disable form
                formDiv.querySelectorAll('input, button').forEach(el => el.disabled = true);
                step++;
                _advanceStep();
            });
        }

        function _advanceStep() {
            if (step >= STEPS.length) {
                _completeOnboarding();
                return;
            }
            const current = STEPS[step];
            _appendMsg('assistant', current.prompt);
            if (current.isForm) {
                // Budget step — show form card, hide text input
                const inputRow = inputEl.closest('.fin-chat-input-row');
                if (inputRow) inputRow.style.display = 'none';
                _appendBudgetForm();
                return;
            }
            const inputRow = inputEl.closest('.fin-chat-input-row');
            if (inputRow) inputRow.style.display = '';
            inputEl.focus();
        }

        function _handleUserReply() {
            const text = inputEl.value.trim();
            if (!text) return;
            _appendMsg('user', text);
            inputEl.value = '';

            // Store answer by key
            const current = STEPS[step];
            if (current.key === 'life_events') {
                // Split comma-separated or treat as a single string
                answers.life_events = text.split(/,|and /).map(s => s.trim()).filter(Boolean);
            } else {
                answers[current.key] = text;
            }
            step++;
            _advanceStep();
        }

        async function _completeOnboarding() {
            _appendMsg('assistant', "Perfect — I've saved your goals! You can always reset them with the \"Reset goals\" button. Let's take a look at your Dashboard now. Upload a CIBC bank statement CSV using the button at the top to get started.");

            // Save to backend
            try {
                await fetch('/finance/goals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(answers),
                });
            } catch (e) { /* non-fatal — goals saved locally for display */ }

            // Transition to dashboard after a short delay
            setTimeout(() => {
                _onboardingStarted = false;
                document.querySelectorAll('.fin-tab').forEach(t => t.style.display = '');
                _activateTab('dashboard');
                _loadDashboard(_currentPeriod);
            }, 1800);
        }

        // Wire send button and Enter key
        function _onSend() { _handleUserReply(); }
        sendBtn?.addEventListener('click', _onSend);
        inputEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _onSend(); }
        });

        // Skip button — posts a minimal skipped-goals record so onboarding is not re-triggered
        skipBtn?.addEventListener('click', async () => {
            try {
                await fetch('/finance/goals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal_type: 'skipped', life_events: [], budgets: {}, horizon: '' }),
                });
            } catch(e) {}
            _onboardingStarted = false;
            document.querySelectorAll('.fin-tab').forEach(t => t.style.display = '');
            _activateTab('dashboard');
            _loadDashboard(_currentPeriod);
        });

        // Start
        _advanceStep();
    }

    // --- Init: wire all DOM events ---
    function init() {
        // Finance button in RSB collapsed rail AND expanded RSB header
        document.getElementById('btn-finance')?.addEventListener('click', open);
        document.getElementById('btn-finance-rsb')?.addEventListener('click', open);

        // Close button
        document.getElementById('fin-close')?.addEventListener('click', close);

        // Tab clicks
        document.querySelectorAll('.fin-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                _activateTab(btn.dataset.tab);
                if (btn.dataset.tab === 'dashboard') _loadDashboard(_currentPeriod);
            });
        });

        // Reset goals button
        document.getElementById('fin-reset-goals')?.addEventListener('click', async () => {
            if (!confirm('Reset your financial goals? This will not delete your uploaded transactions.')) return;
            await fetch('/finance/reset_goals', { method: 'POST' });
            // Clear onboarding history and reset started flag so _startOnboarding runs fresh
            const historyEl = document.getElementById('fin-onboarding-history');
            if (historyEl) historyEl.innerHTML = '';
            _onboardingStarted = false;
            _checkOnboarding();
        });

        // Period selector change
        document.getElementById('fin-period-select')?.addEventListener('change', (e) => {
            _currentPeriod = e.target.value;
            _loadDashboard(_currentPeriod);
        });

        // Refresh button
        document.getElementById('fin-refresh-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('fin-refresh-btn');
            if (btn) btn.classList.add('spinning');
            try {
                await _loadPeriods();
                await _loadDashboard(_currentPeriod);
            } finally {
                if (btn) btn.classList.remove('spinning');
            }
        });

        // CSV upload trigger
        const uploadBtn = document.getElementById('fin-upload-btn');
        const csvInput = document.getElementById('fin-csv-input');
        const uploadPeriodRow = document.getElementById('fin-upload-period-row');

        uploadBtn?.addEventListener('click', () => csvInput?.click());
        csvInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadPeriodRow?.classList.remove('hidden');
            }
        });

        document.getElementById('fin-upload-cancel')?.addEventListener('click', () => {
            uploadPeriodRow?.classList.add('hidden');
            if (csvInput) csvInput.value = '';
        });

        document.getElementById('fin-upload-confirm')?.addEventListener('click', _uploadCSV);

        // Finance Chat tab send
        document.getElementById('fin-chat-send')?.addEventListener('click', _sendFinanceChat);
        document.getElementById('fin-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendFinanceChat(); }
        });

        // Keyboard: Escape closes panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _open) close();
        });
    }

    // --- CSV upload handler ---
    async function _uploadCSV() {
        const csvInput = document.getElementById('fin-csv-input');
        const accountInput = document.getElementById('fin-account-label-input');
        const statusEl = document.getElementById('fin-upload-status');
        const uploadPeriodRow = document.getElementById('fin-upload-period-row');

        if (!csvInput?.files.length) return;
        const accountLabel = accountInput?.value.trim();
        if (!accountLabel) {
            if (statusEl) {
                statusEl.textContent = 'Enter an account label (e.g. CIBC Chequing) before uploading.';
                statusEl.className = 'fin-upload-status error';
                statusEl.classList.remove('hidden');
            }
            if (accountInput) { accountInput.style.borderColor = 'rgba(248,113,113,0.6)'; }
            return;
        }

        const formData = new FormData();
        formData.append('file', csvInput.files[0]);
        formData.append('account_label', accountLabel);

        if (statusEl) {
            statusEl.className = 'fin-upload-status';
            statusEl.textContent = 'Uploading...';
        }

        try {
            const res = await fetch('/finance/upload_csv', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                if (statusEl) {
                    statusEl.className = 'fin-upload-status success';
                    statusEl.textContent = data.message || `Uploaded ${data.row_count} rows (${data.skipped_count} duplicates skipped) — ${data.account_type}`;
                }
                uploadPeriodRow?.classList.add('hidden');
                if (csvInput) csvInput.value = '';
                if (accountInput) { accountInput.value = ''; accountInput.style.borderColor = ''; }
                // Refresh periods selector and dashboard
                await _loadPeriods();
                await _checkOnboarding();
            } else {
                if (statusEl) { statusEl.className = 'fin-upload-status error'; statusEl.textContent = data.detail || 'Upload failed'; }
            }
        } catch (e) {
            if (statusEl) { statusEl.className = 'fin-upload-status error'; statusEl.textContent = 'Upload error: ' + e.message; }
        }
    }

    // --- Finance Chat handler ---
    let _finChatHistory = []; // in-memory only — NOT persisted to DB

    async function _sendFinanceChat() {
        const inputEl = document.getElementById('fin-chat-input');
        const historyEl = document.getElementById('fin-chat-history');
        if (!inputEl || !historyEl) return;

        const message = inputEl.value.trim();
        if (!message) return;
        inputEl.value = '';

        // Render user message
        const userWrapper = document.createElement('div');
        userWrapper.innerHTML = buildMessageHTML('user', message);
        historyEl.appendChild(userWrapper);
        historyEl.scrollTop = historyEl.scrollHeight;

        // Add to in-memory history (for multi-turn context)
        _finChatHistory.push({ role: 'user', content: message });

        // Create assistant message placeholder
        const assistWrapper = document.createElement('div');
        assistWrapper.innerHTML = buildMessageHTML('assistant', '');
        historyEl.appendChild(assistWrapper);
        const assistContent = assistWrapper.querySelector('.msg-text, .message-content') || assistWrapper.lastElementChild;

        let fullText = '';
        let rafScheduled = false;

        try {
            const res = await fetch('/finance/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    period: _currentPeriod,
                    history: _finChatHistory.slice(-6), // last 3 turns for context
                }),
            });

            if (res.status === 503) {
                if (assistContent) assistContent.textContent = 'Finance chat requires the model to be loaded. Please load a model first.';
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let streamBuffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let data;
                    try { data = JSON.parse(line.slice(6)); } catch(e) { continue; }

                    if (data.token) {
                        fullText += data.token;
                        if (!rafScheduled && assistContent) {
                            rafScheduled = true;
                            requestAnimationFrame(() => {
                                if (assistContent) assistContent.textContent = fullText;
                                rafScheduled = false;
                                historyEl.scrollTop = historyEl.scrollHeight;
                            });
                        }
                    }

                    if (data.done) {
                        // Final markdown render
                        if (assistWrapper) assistWrapper.innerHTML = buildMessageHTML('assistant', fullText);
                        historyEl.scrollTop = historyEl.scrollHeight;
                        // Add to in-memory history
                        _finChatHistory.push({ role: 'assistant', content: fullText });
                        break;
                    }

                    if (data.error) {
                        if (assistContent) assistContent.textContent = 'Error: ' + data.error;
                        break;
                    }
                }
            }
        } catch(e) {
            if (assistContent) assistContent.textContent = 'Connection error: ' + e.message;
        }
    }

    return { open, close, init, _activateTab, _loadDashboard, _checkOnboarding, _sendFinanceChat };
})();

FRT.els.text = document.getElementById('frt-text');
FRT.els.optional = document.getElementById('frt-optional');
FRT.els.btnNext = document.getElementById('frt-advance');
FRT.els.btnBack = document.getElementById('frt-back');

// --- STATE ---
const state = {
    sessionId: "default",
    isGenerating: false,
    webSearchMode: "off",
    modelLoaded: false,
    sidebarCollapsed: false,
    rightSidebarOpen: false,
    availableModels: [],
    tutorialHistory: [],
    tutorialSystemPromptId: "default",
    tutorialSystemPromptText: TUTORIAL_PROMPT_DEFAULT,
    sessionPreferences: {},  // Per-session UI preferences
    lastUserMessage: ''      // Tracked for Regenerate action chip
};

// Initialize user preferred name from sessionStorage
window.userPreferredName = sessionStorage.getItem('user_preferred_name') || '';

// --- SESSION PREFERENCE MANAGEMENT ---
function getSessionThinkMode(sessionId) {
    if (!state.sessionPreferences[sessionId]) {
        state.sessionPreferences[sessionId] = { thinkMode: false };
    }
    return state.sessionPreferences[sessionId].thinkMode;
}

function setSessionThinkMode(sessionId, enabled) {
    if (!state.sessionPreferences[sessionId]) {
        state.sessionPreferences[sessionId] = {};
    }
    state.sessionPreferences[sessionId].thinkMode = enabled;

    // Persist to localStorage
    try {
        localStorage.setItem('localis_session_prefs', JSON.stringify(state.sessionPreferences));
    } catch (e) {
        console.warn('Failed to save session preferences:', e);
    }

    // Update UI
    const thinkToggle = document.getElementById('think-toggle');
    if (thinkToggle) {
        thinkToggle.classList.toggle('active', enabled);
        thinkToggle.title = enabled ? 'Think mode: ON' : 'Think mode: OFF';
    }
}

function loadSessionPreferences() {
    try {
        const saved = localStorage.getItem('localis_session_prefs');
        if (saved) {
            state.sessionPreferences = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load session preferences:', e);
    }
}

// --- SETTINGS PROXY ---
const AppSettings = {
    keys: {
        theme: 'local_ai_theme',
        accent: 'local_ai_accent',
        wallOpacity: 'local_ai_wall_opacity',
        wallUrl: 'local_ai_wall_url',
    },
    get(key, defaultVal) {
        if (this.keys[key]) {
            return localStorage.getItem(this.keys[key]) || defaultVal;
        }
        return defaultVal;
    },
    set(key, val) {
        if (this.keys[key]) {
            localStorage.setItem(this.keys[key], val);
        }
    }
};

// --- WALLPAPER LOGIC ---
const elWall = {
    layer: document.createElement('div'),
    input: document.getElementById('wallpaper-upload'),
    btnRemove: document.getElementById('btn-remove-wallpaper'),
    slider: document.getElementById('slider-opacity'),
    label: document.getElementById('val-opacity')
};
elWall.layer.className = 'app-background-layer';
document.body.prepend(elWall.layer);
document.body.classList.add('wallpaper-active');

const updateWallpaperOpacity = (val) => {
    elWall.layer.style.opacity = val / 100;
    if(elWall.label) elWall.label.textContent = val + '%';
    AppSettings.set('wallOpacity', val);
};

const setWallpaperUrl = (url) => {
    if(url) {
        elWall.layer.style.backgroundImage = `url('${url}')`;
        AppSettings.set('wallUrl', url);
        document.body.classList.add('wallpaper-active');
    } else {
        // Remove inline style to let CSS default show
        elWall.layer.style.removeProperty('background-image');
        localStorage.removeItem('local_ai_wall_url');
        document.body.classList.add('wallpaper-active');
    }
};

if(elWall.slider) elWall.slider.addEventListener('input', (e) => updateWallpaperOpacity(e.target.value));
if(elWall.input) elWall.input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
                                               const formData = new FormData();
    formData.append('file', file);
                                               try {
                                                   elWall.input.disabled = true;
                                                   const res = await fetch('/settings/wallpaper', { method: 'POST', body: formData });
                                                   if(!res.ok) throw new Error("Upload failed");
                                               const data = await res.json();
                                                   setWallpaperUrl(data.url);
                                               } catch(err) { alert("Failed to upload wallpaper."); }
                                               finally { elWall.input.disabled = false; elWall.input.value = ''; }
});
if(elWall.btnRemove) elWall.btnRemove.addEventListener('click', async () => {
    try {
        await fetch('/settings/wallpaper', { method: 'DELETE' });
        setWallpaperUrl(null);
    } catch(e) {}
});

const wallpaperTrigger = document.getElementById('btn-wallpaper-upload-trigger');
if (wallpaperTrigger) {
  wallpaperTrigger.addEventListener('click', () => {
    const input = document.getElementById('wallpaper-upload');
    if (input) input.click();
  });
}

const savedOpacity = localStorage.getItem('local_ai_wall_opacity') || 10;
if(elWall.slider) elWall.slider.value = savedOpacity;
updateWallpaperOpacity(savedOpacity);
const savedUrl = localStorage.getItem('local_ai_wall_url');
if(savedUrl) setWallpaperUrl(savedUrl);

// --- RAG UPLOADS UI MODULE ---
// --- TOOLS PICKER UI MODULE ---
const toolsUI = {
    selectedTools: new Set(),
    stickyTools: new Set(['rag_retrieve', 'web_search', 'assist_mode']), // Tools that stay selected
    toolConfigs: {}, // Store config values for each tool
    _didInit: false,

    init() {
        if (!els.toolsPickerBtn || !els.toolsPickerModal) return;
        if (this._didInit) return;
        this._didInit = true;

        // Toggle modal on button click
        els.toolsPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleModal();
        });

        // Close modal when clicking outside
        document.addEventListener('click', (e) => {
            if (!els.toolsPickerModal.classList.contains('hidden') &&
                !els.toolsPickerModal.contains(e.target) &&
                !els.toolsPickerBtn.contains(e.target)) {
                this.toggleModal(false);
            }
        });

        // Tool option click handlers
        const toolOptions = els.toolsPickerModal.querySelectorAll('.tool-option');
        toolOptions.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tool = btn.dataset.tool;

                if (tool === 'from_file') {
                    // From File triggers file picker immediately
                    const fileInput = document.getElementById('from-file-input');
                    if (fileInput) {
                        fileInput.click();
                    }
                    this.toggleModal(false);
                } else {
                    // Toggle tool selection
                    this.toggleTool(tool);
                }
            });
        });

        // File input handler for "From File" tool
        const fromFileInput = document.getElementById('from-file-input');
        if (fromFileInput) {
            fromFileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;

                await this.handleFromFileUpload(files);

                // Clear input so same file can be re-uploaded
                e.target.value = '';
            });
        }

        // Config input handlers
        const ragTopKSlider = document.getElementById('rag-top-k-slider');
        const ragTopKValue = document.getElementById('rag-top-k-value');
        if (ragTopKSlider && ragTopKValue) {
            ragTopKSlider.addEventListener('input', (e) => {
                ragTopKValue.textContent = e.target.value;
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (els.toolsPickerModal.classList.contains('hidden')) return;

            // ESC closes modal
            if (e.key === 'Escape') {
                e.preventDefault();
                this.toggleModal(false);
                els.toolsPickerBtn.focus();
                return;
            }

            // Arrow keys navigate
            const toolOptions = Array.from(els.toolsPickerModal.querySelectorAll('.tool-option'));
            const focusedIndex = toolOptions.findIndex(opt => opt === document.activeElement);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = (focusedIndex + 1) % toolOptions.length;
                toolOptions[nextIndex].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = focusedIndex <= 0 ? toolOptions.length - 1 : focusedIndex - 1;
                toolOptions[prevIndex].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                // Enter/Space toggles selection
                if (focusedIndex >= 0) {
                    e.preventDefault();
                    toolOptions[focusedIndex].click();
                }
            }
        });

        this.render();
    },

    toggleModal(show = null) {
        const shouldShow = show !== null ? show : els.toolsPickerModal.classList.contains('hidden');
        if (shouldShow) {
            els.toolsPickerModal.classList.remove('hidden');
            els.toolsPickerBtn.setAttribute('aria-expanded', 'true');
            // Focus first tool option when modal opens
            const firstOption = els.toolsPickerModal.querySelector('.tool-option');
            if (firstOption) {
                setTimeout(() => firstOption.focus(), 50);
            }
        } else {
            els.toolsPickerModal.classList.add('hidden');
            els.toolsPickerBtn.setAttribute('aria-expanded', 'false');
            // Return focus to trigger button when modal closes
            if (document.activeElement !== els.toolsPickerBtn) {
                els.toolsPickerBtn.focus();
            }
        }
        this.updateButtonStates();
    },

    toggleTool(toolName) {
        if (this.selectedTools.has(toolName)) {
            this.selectedTools.delete(toolName);
            this.hideConfig(toolName);
        } else {
            this.selectedTools.add(toolName);
            this.showConfig(toolName);

            // Show warning if selecting RAG but no indexed files
            if (toolName === 'rag_retrieve') {
                this.checkRagAvailability();
            }
        }
        this.updateButtonStates();
        this.render();
    },

    showConfig(toolName) {
        const configPanel = document.querySelector(`[data-config-for="${toolName}"]`);
        if (configPanel) {
            configPanel.classList.remove('hidden');
        }
    },

    hideConfig(toolName) {
        const configPanel = document.querySelector(`[data-config-for="${toolName}"]`);
        if (configPanel) {
            configPanel.classList.add('hidden');
        }
    },

    async checkRagAvailability() {
        try {
            const response = await fetch(`/rag/list?session_id=${state.sessionId}`);
            const data = await response.json();

            if (data.ok) {
                const indexedFiles = data.files.filter(f =>
                    (f.status === 'chunked' || f.status === 'indexed') && f.is_active
                );

                if (indexedFiles.length === 0) {
                    showToast('No indexed files found. Upload and embed files first.', 'error');
                }
            }
        } catch (e) {
            console.warn('[Tools] Failed to check RAG availability:', e);
        }
    },

    updateButtonStates() {
        const toolOptions = els.toolsPickerModal.querySelectorAll('.tool-option');
        toolOptions.forEach(btn => {
            const tool = btn.dataset.tool;
            if (tool !== 'upload') {
                const isSelected = this.selectedTools.has(tool);
                if (isSelected) {
                    btn.classList.add('selected');
                    btn.setAttribute('aria-checked', 'true');
                } else {
                    btn.classList.remove('selected');
                    btn.setAttribute('aria-checked', 'false');
                }
            }
        });
    },

    getSelectedTools() {
        // Return structured tool objects with type and config
        return Array.from(this.selectedTools).map(toolName => {
            return {
                type: toolName,
                config: this.getToolConfig(toolName)
            };
        });
    },

    getToolConfig(toolName) {
        // Get configuration from UI inputs
        const config = {};

        if (toolName === 'rag_retrieve') {
            const topKSlider = document.getElementById('rag-top-k-slider');
            config.top_k = topKSlider ? parseInt(topKSlider.value) : 4;
        }

        if (toolName === 'web_search') {
            const queryInput = document.getElementById('web-search-query');
            const query = queryInput ? queryInput.value.trim() : '';
            if (query) {
                config.query = query;
            }
        }

        if (toolName === 'memory_write') {
            const keyInput = document.getElementById('memory-key');
            const valueInput = document.getElementById('memory-value');
            const tierSelect = document.getElementById('memory-tier');

            config.key = keyInput ? keyInput.value.trim() || 'misc' : 'misc';
            config.value = valueInput ? valueInput.value.trim() : '';
            config.tier = tierSelect ? tierSelect.value : 'tier_b';
        }

        return config;
    },

    clearOneShot() {
        // Remove non-sticky tools after message send
        const toRemove = [];
        this.selectedTools.forEach(tool => {
            if (!this.stickyTools.has(tool)) {
                toRemove.push(tool);
            }
        });
        toRemove.forEach(tool => this.selectedTools.delete(tool));
        this.updateButtonStates();
        this.render();
    },

    async handleFromFileUpload(fileList) {
        const sessionId = state.sessionId;
        const uploadedFileIds = [];
        const fileNames = Array.from(fileList).map(f => f.name);

        // Create in-chat status message
        const statusMsg = this.createIngestStatusMessage({
            state: 'running',
            phase: 'upload',
            total_files: fileList.length,
            done_files: 0,
            current_file_name: fileNames[0],
            message: `From File: Uploading ${fileList.length} file${fileList.length > 1 ? 's' : ''}...`,
            error: null
        });

        // Upload files one by one
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            try {
                this.updateIngestStatus(statusMsg, {
                    phase: 'upload',
                    done_files: i,
                    current_file_name: file.name,
                    message: `From File: Uploading ${i + 1}/${fileList.length} - ${file.name}`
                });

                const formData = new FormData();
                formData.append('session_id', sessionId);
                formData.append('file', file);

                const response = await fetch('/rag/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    let errorMsg = 'Upload failed';
                    if (error.detail === 'unsupported_file_type') {
                        errorMsg = `Unsupported file type: ${file.name}`;
                    } else if (error.detail === 'file_too_large') {
                        errorMsg = `File too large: ${file.name} (max 100MB)`;
                    }
                    this.updateIngestStatus(statusMsg, {
                        state: 'error',
                        message: `From File: Error`,
                        error: errorMsg
                    });
                    return;
                }

                const result = await response.json();
                uploadedFileIds.push(result.file.id);

            } catch (err) {
                console.error('Upload error:', err);
                this.updateIngestStatus(statusMsg, {
                    state: 'error',
                    message: `From File: Error`,
                    error: `Upload failed: ${err.message}`
                });
                return;
            }
        }

        // Start actual ingest processing (extract + chunk + index)
        try {
            const ingestResp = await fetch('/rag/ingest_start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    file_ids: uploadedFileIds,
                    force: false
                })
            });

            if (!ingestResp.ok) {
                throw new Error(`Ingest start failed: ${ingestResp.status}`);
            }

            const ingestData = await ingestResp.json();
            if (!ingestData.ok) {
                throw new Error('Ingest start returned ok:false');
            }

            // Subscribe to SSE progress events
            this.subscribeToIngestEvents(sessionId, statusMsg, uploadedFileIds);

        } catch (err) {
            console.error('[RAG] Failed to start ingest:', err);
            this.updateIngestStatus(statusMsg, {
                state: 'error',
                phase: 'upload',
                message: 'From File: Processing failed',
                error: `Failed to start processing: ${err.message}`
            });
        }
    },

    subscribeToIngestEvents(sessionId, statusMsgDiv, fileIds) {
        const eventSource = new EventSource(`/rag/ingest_events?session_id=${sessionId}`);

        eventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);

                // Use event_type as primary discriminator (per CLAUDE.md)
                if (data.event_type !== 'ingest_status') {
                    return;
                }

                // Build message with "From File:" prefix
                let message = data.message;
                if (!message.startsWith('From File:')) {
                    message = `From File: ${message}`;
                }

                // Update status message with real-time progress
                this.updateIngestStatus(statusMsgDiv, {
                    state: data.state,
                    phase: data.phase,
                    total_files: data.total_files,
                    done_files: data.done_files,
                    current_file_name: data.current_file_name,
                    message: message,
                    error: data.error
                });

                // Close EventSource on terminal states
                if (data.state === 'done' || data.state === 'error' || data.state === 'cancelled') {
                    eventSource.close();

                    // Log final state
                    if (data.state === 'done') {
                        Logger.log('RAG', `Ingest complete: ${fileIds.length} files`);
                    } else if (data.state === 'error') {
                        Logger.error('RAG', `Ingest error: ${data.error || 'Unknown error'}`);
                    } else {
                        Logger.warn('RAG', 'Ingest cancelled');
                    }
                }
            } catch (err) {
                console.error('[RAG] Failed to parse SSE event:', err, e.data);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[RAG] SSE connection error:', err);
            eventSource.close();

            // Update status to show connection error
            this.updateIngestStatus(statusMsgDiv, {
                state: 'error',
                phase: 'upload',
                message: 'From File: Connection lost',
                error: 'SSE connection failed'
            });
        };
    },

    createIngestStatusMessage(status) {
        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) return null;

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('msg-row', 'ai');
        msgDiv.dataset.statusMessage = 'true';

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('msg-content', 'ingest-status-message');

        const summaryDiv = document.createElement('div');
        summaryDiv.classList.add('ingest-status-summary');
        summaryDiv.onclick = () => this.toggleIngestDetails(msgDiv);

        const iconSpan = document.createElement('span');
        iconSpan.classList.add('ingest-status-icon', status.state);
        iconSpan.innerHTML = this.getIngestIcon(status.state);
        summaryDiv.appendChild(iconSpan);

        const textSpan = document.createElement('span');
        textSpan.classList.add('ingest-status-text');
        textSpan.textContent = status.message;
        summaryDiv.appendChild(textSpan);

        const expandSpan = document.createElement('span');
        expandSpan.classList.add('ingest-status-expand');
        expandSpan.textContent = '▼';
        summaryDiv.appendChild(expandSpan);

        contentDiv.appendChild(summaryDiv);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('ingest-status-details');
        detailsDiv.innerHTML = this.renderIngestDetails(status);
        contentDiv.appendChild(detailsDiv);

        msgDiv.appendChild(contentDiv);
        chatHistory.appendChild(msgDiv);
        // Scroll the viewport (#chat-zone), not the inner container (#chat-history)
        const chatViewport = els.chatZone || document.getElementById('chat-zone');
        if (chatViewport) chatViewport.scrollTop = chatViewport.scrollHeight;

        return msgDiv;
    },

    updateIngestStatus(msgDiv, updates) {
        if (!msgDiv) return;

        const currentState = msgDiv.dataset.state || 'running';
        const newState = updates.state || currentState;
        msgDiv.dataset.state = newState;

        const iconSpan = msgDiv.querySelector('.ingest-status-icon');
        if (iconSpan && updates.state) {
            iconSpan.className = `ingest-status-icon ${newState}`;
            iconSpan.innerHTML = this.getIngestIcon(newState);
        }

        const textSpan = msgDiv.querySelector('.ingest-status-text');
        if (textSpan && updates.message) {
            textSpan.textContent = updates.message;
        }

        const detailsDiv = msgDiv.querySelector('.ingest-status-details');
        if (detailsDiv) {
            const status = Object.assign({
                state: newState,
                phase: updates.phase || 'upload',
                total_files: updates.total_files || 0,
                done_files: updates.done_files || 0,
                current_file_name: updates.current_file_name,
                error: updates.error
            }, updates);
            detailsDiv.innerHTML = this.renderIngestDetails(status);
        }
    },

    toggleIngestDetails(msgDiv) {
        const detailsDiv = msgDiv.querySelector('.ingest-status-details');
        const expandSpan = msgDiv.querySelector('.ingest-status-expand');
        if (detailsDiv && expandSpan) {
            detailsDiv.classList.toggle('visible');
            expandSpan.classList.toggle('expanded');
        }
    },

    getIngestIcon(state) {
        if (state === 'running') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
        } else if (state === 'done') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        } else if (state === 'error') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }
        return '';
    },

    renderIngestDetails(status) {
        const phases = [
            { key: 'upload', label: 'Upload' },
            { key: 'extract', label: 'Extract' },
            { key: 'chunk', label: 'Chunk' },
            { key: 'index', label: 'Index' }
        ];

        const phaseItems = phases.map(p => {
            let className = 'ingest-phase-item';
            if (status.state === 'done') {
                className += ' done';
            } else if (p.key === status.phase) {
                className += ' active';
            } else if (phases.findIndex(x => x.key === p.key) < phases.findIndex(x => x.key === status.phase)) {
                className += ' done';
            }

            const icon = (className.includes('done') || className.includes('active')) ? '✓' : '○';

            return `
                <div class="${className}">
                    <span class="ingest-phase-icon">${icon}</span>
                    <span>${p.label}</span>
                </div>
            `;
        }).join('');

        let html = `<div class="ingest-phase-list">${phaseItems}</div>`;

        if (status.total_files) {
            html += `<div class="ingest-file-count">Files: ${status.done_files}/${status.total_files}</div>`;
        }

        if (status.current_file_name) {
            html += `<div class="ingest-file-count">Current: ${status.current_file_name}</div>`;
        }

        if (status.error) {
            html += `<div class="ingest-error-text">${status.error}</div>`;
        }

        return html;
    },

    render() {
        if (!els.toolsChipRow) return;

        const toolLabels = {
            'rag_retrieve': 'From Files',
            'web_search': 'Search Web',
            'memory_write': 'Remember',
            'memory_retrieve': 'Recall',
            'assist_mode': 'Home Control'
        };

        const toolIcons = {
            'rag_retrieve': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
            'web_search': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>',
            'memory_write': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path></svg>',
            'memory_retrieve': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
            'assist_mode': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
        };

        const html = this.getSelectedTools().map(toolObj => {
            const toolName = toolObj.type;
            const config = toolObj.config;
            let label = toolLabels[toolName] || toolName;

            // Add config hint to label
            if (toolName === 'rag_retrieve' && config.top_k) {
                label += ` (${config.top_k} chunks)`;
            } else if (toolName === 'web_search' && config.query) {
                label += ` ("${config.query.substring(0, 20)}${config.query.length > 20 ? '...' : ''}")`;
            } else if (toolName === 'memory_write' && config.key) {
                label += ` (${config.key})`;
            }

            return `
                <div class="tools-chip">
                    <span class="tools-chip-icon">${toolIcons[toolName] || ''}</span>
                    <span class="tools-chip-label">${label}</span>
                    <button class="tools-chip-delete" data-tool="${toolName}" title="Remove">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

        els.toolsChipRow.innerHTML = html;

        // Add delete handlers
        els.toolsChipRow.querySelectorAll('.tools-chip-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tool = btn.dataset.tool;
                this.toggleTool(tool);
            });
        });
    }
};

// ── modePills — Mode pill toggles (replaces toolsUI chip/modal UX) ──────────
const modePills = (() => {
  const PILL_TO_TOOL = {
    'web_search':   'web_search',
    'assist_mode':  'assist_mode',
    'rag_upload':   null,           // triggers file picker, no mode flag
    'memory_write': 'memory_write',
  };

  function _syncToToolsUI() {
    // Mirror pill state into toolsUI.selectedTools so the send path at line ~4150
    // continues to work without modification.
    if (!toolsUI || !toolsUI.selectedTools) return;
    toolsUI.selectedTools.clear();
    document.querySelectorAll('.mode-pill.active').forEach(pill => {
      const tool = pill.dataset.tool;
      if (PILL_TO_TOOL[tool]) toolsUI.selectedTools.add(PILL_TO_TOOL[tool]);
    });
  }

  function _togglePill(pillEl) {
    const tool = pillEl.dataset.tool;
    if (tool === 'rag_upload') {
      // Don't toggle — just open file picker
      const fi = document.getElementById('from-file-input');
      if (fi) fi.click();
      return;
    }
    pillEl.classList.toggle('active');
    _syncToToolsUI();
  }

  function init() {
    document.querySelectorAll('.mode-pill').forEach(pill => {
      pill.addEventListener('click', () => _togglePill(pill));
    });

    // Restore sticky tools from toolsUI into pill state on init
    if (toolsUI && toolsUI.stickyTools) {
      if (toolsUI.stickyTools.has('assist_mode')) {
        const p = document.getElementById('pill-home');
        if (p) p.classList.add('active');
      }
      if (toolsUI.stickyTools.has('web_search')) {
        const p = document.getElementById('pill-web');
        if (p) p.classList.add('active');
      }
    }
    _syncToToolsUI();
  }

  return { init };
})();

// ── Sidebar collapse toggles ─────────────────────────────────────────────────
(function initSidebarToggles() {
  const lsb = document.getElementById('left-sidebar');
  const rsb = document.getElementById('right-sidebar');
  const rsbRail = document.getElementById('right-rail');

  function toggleLeft() {
    if (!lsb) return;
    const collapsed = lsb.classList.toggle('collapsed');
    const btn = document.getElementById('left-sidebar-toggle');
    if (btn) {
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', collapsed ? '#ico-right' : '#ico-left');
    }
  }

  function toggleRight() {
    if (!rsb) return;
    const collapsed = rsb.classList.toggle('collapsed');
    if (rsbRail) rsbRail.classList.toggle('hidden', !collapsed);
    const btn = document.getElementById('right-sidebar-toggle');
    if (btn) {
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', collapsed ? '#ico-left' : '#ico-right');
    }
  }

  const lBtn = document.getElementById('left-sidebar-toggle');
  const rBtn = document.getElementById('right-sidebar-toggle');
  const rRailBtn = document.getElementById('right-rail-toggle');
  if (lBtn) lBtn.addEventListener('click', toggleLeft);
  if (rBtn) rBtn.addEventListener('click', toggleRight);
  if (rRailBtn) rRailBtn.addEventListener('click', toggleRight);

  // Rail icons → expand sidebar AND scroll to target section
  document.querySelectorAll('.rsb-rail-icon').forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.dataset.section;
      if (!sectionId) return;
      // Reuse existing toggleRight() to expand — it handles icon swap + rail hide
      if (rsb && rsb.classList.contains('collapsed')) {
        toggleRight();
      }
      // Scroll after transition completes (~200ms)
      setTimeout(() => {
        const section = document.getElementById(sectionId);
        const body = document.getElementById('rsb-body');
        if (section && body) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 220);
    });
  });
})();

// ── rsbLights — Right sidebar lights control (direct HA API) ─────────────────
const rsbLights = (() => {
  let _pollTimer = null;
  let _activeControl = 'brightness';

  function _msSince(isoStr) {
    if (!isoStr) return '';
    const diff = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60)   return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.round(diff / 60)} minutes ago`;
    return `${Math.round(diff / 3600)} hours ago`;
  }

  async function _haPost(path, body = {}) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HA ${path} failed: ${r.status}`);
    return r.json();
  }

  async function _refresh() {
    try {
      const r = await fetch('/assist/light_state');
      if (!r.ok) { _showUnavailable(); return; }
      const data = await r.json();
      if (data.error) { _showUnavailable(); return; }

      const pct  = data.brightness_pct ?? 0;
      const isOn = data.state === 'on';

      if (els.rsbLightsPct)   els.rsbLightsPct.textContent = isOn ? `${pct}%` : 'Off';
      if (els.rsbLightsAgo)   els.rsbLightsAgo.textContent = _msSince(data.last_changed);
      if (els.rsbBulbFill)    els.rsbBulbFill.style.height  = isOn ? `${pct}%` : '0%';
      if (els.rsbBulbLine)    els.rsbBulbLine.style.bottom  = `calc(${isOn ? pct : 0}% + 5px)`;
      if (els.rsbLightsToggle) els.rsbLightsToggle.classList.toggle('on', isOn);
      if (els.rsbBulb)         els.rsbBulb.classList.toggle('lit', isOn);
      if (els.rsbBrightnessSlider && isOn) els.rsbBrightnessSlider.value = pct;
    } catch (_) {
      _showUnavailable();
    }
  }

  function _showUnavailable() {
    if (els.rsbLightsPct) els.rsbLightsPct.textContent = '—';
    if (els.rsbLightsAgo) els.rsbLightsAgo.textContent = 'HA unavailable';
  }

  function _setActiveControl(name) {
    _activeControl = name;
    ['power', 'brightness', 'color', 'kelvin'].forEach(n => {
      document.getElementById(`rsb-btn-${n}`)?.classList.toggle('active', n === name);
    });
    if (els.rsbBrightnessCtrl) els.rsbBrightnessCtrl.classList.toggle('hidden', name !== 'brightness');
    if (els.rsbKelvinCtrl)     els.rsbKelvinCtrl.classList.toggle('hidden', name !== 'kelvin');
  }

  function _wireControls() {
    // Power button → toggle light directly
    document.getElementById('rsb-btn-power')?.addEventListener('click', async () => {
      try { await _haPost('/assist/light/toggle'); setTimeout(_refresh, 400); } catch (_) {}
    });

    // Brightness button → show slider
    document.getElementById('rsb-btn-brightness')?.addEventListener('click', () => {
      _setActiveControl('brightness');
    });

    // Color button → show swatches
    document.getElementById('rsb-btn-color')?.addEventListener('click', () => {
      _setActiveControl('color');
    });

    // Kelvin button → show kelvin slider
    document.getElementById('rsb-btn-kelvin')?.addEventListener('click', () => {
      _setActiveControl('kelvin');
    });

    // Toggle switch (on/off)
    els.rsbLightsToggle?.addEventListener('click', async () => {
      try { await _haPost('/assist/light/toggle'); setTimeout(_refresh, 400); } catch (_) {}
    });

    // Brightness slider — debounced HA call
    let _bTimer = null;
    els.rsbBrightnessSlider?.addEventListener('input', e => {
      if (els.rsbLightsPct) els.rsbLightsPct.textContent = `${e.target.value}%`;
      clearTimeout(_bTimer);
      _bTimer = setTimeout(async () => {
        try { await _haPost('/assist/light/brightness', { value: parseInt(e.target.value) }); } catch (_) {}
      }, 150);
    });
    els.rsbBrightnessSlider?.addEventListener('change', () => setTimeout(_refresh, 500));

    // Kelvin slider — debounced HA call
    let _kTimer = null;
    els.rsbKelvinSlider?.addEventListener('input', e => {
      clearTimeout(_kTimer);
      _kTimer = setTimeout(async () => {
        try { await _haPost('/assist/light/kelvin', { kelvin: parseInt(e.target.value) }); } catch (_) {}
      }, 150);
    });
    els.rsbKelvinSlider?.addEventListener('change', () => setTimeout(_refresh, 500));

    // Color swatches — use class .rsb-sw (the actual class name in HTML)
    document.querySelectorAll('#rsb-swatches .rsb-sw').forEach(swatch => {
      swatch.addEventListener('click', async () => {
        const hex = swatch.dataset.color;
        if (!hex) return;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        document.querySelectorAll('#rsb-swatches .rsb-sw').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        try { await _haPost('/assist/light/color', { rgb: [r, g, b] }); setTimeout(_refresh, 600); } catch (_) {}
      });
    });

    _setActiveControl('brightness'); // default active mode

    // ── Bulb direct drag for brightness ──────────────────────────────────────
    let _bulbDragging = false;
    let _bulbLastPct = 50;

    function _bulbPctFromEvent(clientY) {
      if (!els.rsbBulb) return 50;
      const rect = els.rsbBulb.getBoundingClientRect();
      return Math.max(0, Math.min(100, Math.round((1 - (clientY - rect.top) / rect.height) * 100)));
    }

    function _bulbUpdateUI(pct) {
      if (els.rsbBulbFill)  els.rsbBulbFill.style.height  = `${pct}%`;
      if (els.rsbBulbLine)  els.rsbBulbLine.style.bottom   = `calc(${pct}% + 5px)`;
      if (els.rsbLightsPct) els.rsbLightsPct.textContent   = `${pct}%`;
      if (els.rsbBrightnessSlider) els.rsbBrightnessSlider.value = pct;
      _bulbLastPct = pct;
    }

    els.rsbBulb?.addEventListener('mousedown', e => {
      _bulbDragging = true;
      _bulbUpdateUI(_bulbPctFromEvent(e.clientY));
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!_bulbDragging) return;
      _bulbUpdateUI(_bulbPctFromEvent(e.clientY));
    });
    document.addEventListener('mouseup', () => {
      if (!_bulbDragging) return;
      _bulbDragging = false;
      _haPost('/assist/light/brightness', { value: _bulbLastPct }).catch(() => {});
      setTimeout(_refresh, 600);
    });

    // Touch support
    els.rsbBulb?.addEventListener('touchstart', e => {
      _bulbDragging = true;
      _bulbUpdateUI(_bulbPctFromEvent(e.touches[0].clientY));
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (!_bulbDragging) return;
      _bulbUpdateUI(_bulbPctFromEvent(e.touches[0].clientY));
    }, { passive: false });
    document.addEventListener('touchend', () => {
      if (!_bulbDragging) return;
      _bulbDragging = false;
      _haPost('/assist/light/brightness', { value: _bulbLastPct }).catch(() => {});
      setTimeout(_refresh, 600);
    });
  }

  function start() {
    _wireControls();
    _refresh();
    _pollTimer = setInterval(_refresh, 5000);
  }

  function stop() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  return { start, stop, refresh: _refresh };
})();

// ── rsbModel — Right sidebar model loader ────────────────────────────────────
const rsbModel = (() => {
  let _selectedModel = null;

  function renderList() {
    if (!els.rsbModelList) return;
    const models = state.availableModels || [];
    els.rsbModelList.innerHTML = '';

    if (models.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:9px;color:rgba(255,255,255,.25);padding:4px 2px';
      empty.textContent = 'No .gguf files found in models/';
      els.rsbModelList.appendChild(empty);
      return;
    }

    models.forEach(m => {
      const item = document.createElement('div');
      item.className = 'rsb-model-item' + (m.name === _selectedModel ? ' selected' : '');
      const displayName = m.name.replace(/\.gguf$/i, '');
      item.innerHTML = `${displayName}&ensp;<span style="color:rgba(255,255,255,.4)">${m.size_gb} GB</span>`;
      item.title = m.name;
      item.addEventListener('click', () => {
        _selectedModel = m.name;
        renderList();
        if (els.rsbBtnLoadModel) els.rsbBtnLoadModel.disabled = false;
        // Close dropdown after selection
        els.rsbModelTrigger?.classList.remove('open');
        if (els.rsbModelList) els.rsbModelList.classList.add('hidden');
      });
      els.rsbModelList.appendChild(item);
    });
  }

  function updateStatus(modelName) {
    if (els.rsbModelName) els.rsbModelName.textContent = modelName ? modelName.replace(/\.gguf$/i, '') : 'No model loaded';
    if (els.rsbModelStatus) {
      els.rsbModelStatus.textContent = modelName ? '● ONLINE' : '● OFFLINE';
      els.rsbModelStatus.className = 'rsb-model-st ' + (modelName ? 'online' : 'offline');
    }
    if (els.rsbBtnUnloadModel) els.rsbBtnUnloadModel.disabled = !modelName;
  }

  function init() {
    // Pre-select currently loaded model
    if (state.currentModel) {
      _selectedModel = state.currentModel;
    }
    renderList();
    updateStatus(state.currentModel || null);

    // Load button
    els.rsbBtnLoadModel?.addEventListener('click', async () => {
      if (!_selectedModel) return;
      els.rsbBtnLoadModel.disabled = true;
      els.rsbBtnLoadModel.textContent = 'Loading…';
      try {
        const r = await fetch('/models/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_name: _selectedModel, n_gpu_layers: 35, n_ctx: 8192 }),
        });
        if (r.ok) {
          state.modelLoaded = true;
          state.currentModel = _selectedModel;
          state.nCtx = 8192;
          updateStatus(_selectedModel);
          rsbStats.updateContextBar();
          await api.getModels();
          renderList();
        }
      } catch (_) {}
      els.rsbBtnLoadModel.textContent = 'Load';
      // re-enable only if a model is selected
      els.rsbBtnLoadModel.disabled = !_selectedModel;
    });

    // Unload button
    els.rsbBtnUnloadModel?.addEventListener('click', async () => {
      els.rsbBtnUnloadModel.disabled = true;
      els.rsbBtnUnloadModel.textContent = 'Unloading…';
      try {
        await fetch('/models/unload', { method: 'POST' });
        state.modelLoaded = false;
        state.currentModel = null;
        _selectedModel = null;
        updateStatus(null);
        await api.getModels();
        renderList();
      } catch (_) {}
      els.rsbBtnUnloadModel.textContent = 'Unload';
    });

    // Dropdown toggle
    els.rsbModelTrigger?.addEventListener('click', () => {
      const isOpen = els.rsbModelTrigger.classList.toggle('open');
      if (els.rsbModelList) els.rsbModelList.classList.toggle('hidden', !isOpen);
      if (isOpen) renderList(); // refresh on open
    });

    // Close when clicking outside
    document.addEventListener('click', e => {
      if (!els.rsbModelTrigger?.contains(e.target) && !els.rsbModelList?.contains(e.target)) {
        els.rsbModelTrigger?.classList.remove('open');
        if (els.rsbModelList) els.rsbModelList.classList.add('hidden');
      }
    }, true);
  }

  return { init, renderList, updateStatus };
})();

// ── rsbStats — System stats + context bar polling ───────────────────────────
const rsbStats = (() => {
  let _statsTimer = null;
  let _ctxChars = 0;

  function _ascii(pct, len = 20) {
    const filled = Math.round(pct / 100 * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
  }

  async function _refreshStats() {
    try {
      const r = await fetch('/api/system-stats');
      if (!r.ok) return;
      const d = await r.json();

      // Legacy hidden elements (preserved for any external references)
      if (els.rsbCpuVal) els.rsbCpuVal.textContent = Math.round(d.cpu_pct);
      if (els.rsbCpuBar) els.rsbCpuBar.style.width = `${d.cpu_pct}%`;
      if (els.rsbRamVal) els.rsbRamVal.textContent = d.ram_used_gb;
      if (els.rsbRamBar) els.rsbRamBar.style.width = `${Math.round(d.ram_used_gb / d.ram_total_gb * 100)}%`;
      if (els.rsbVramVal) els.rsbVramVal.textContent = d.vram_used_gb;
      if (d.vram_total_gb > 0 && els.rsbVramBar) {
        const vPct = Math.round(d.vram_used_gb / d.vram_total_gb * 100);
        els.rsbVramBar.style.width = `${vPct}%`;
        els.rsbVramBar.classList.toggle('rsb-amber', vPct > 80);
        els.rsbVramBar.classList.toggle('rsb-indigo', vPct <= 80);
      }

      // Compact stat rows
      const setBar = (id, pct, label) => {
        const bar = document.getElementById(id);
        if (bar) bar.style.width = Math.min(pct, 100) + '%';
        const val = document.getElementById(id + '-val');
        if (val) val.textContent = label;
      };
      setBar('stat-bar-cpu', d.cpu_pct, Math.round(d.cpu_pct) + '%');
      const ramPct = d.ram_total_gb > 0 ? Math.round(d.ram_used_gb / d.ram_total_gb * 100) : 0;
      setBar('stat-bar-ram', ramPct, ramPct + '%');
      if (d.vram_total_gb > 0) {
        const vPct = Math.round(d.vram_used_gb / d.vram_total_gb * 100);
        setBar('stat-bar-vram', vPct, (d.vram_used_gb || 0) + 'G');
      } else {
        setBar('stat-bar-vram', 0, 'N/A');
      }
    } catch (_) {}
  }

  function updateContextBar() {
    const nCtx = state.nCtx || 8192;
    const tokenEst = Math.ceil(_ctxChars / 4);
    const pct = Math.min(100, Math.round(tokenEst / nCtx * 100));

    if (els.rsbCtxAscii) els.rsbCtxAscii.textContent = _ascii(pct);
    if (els.rsbCtxTokens) {
      const used = tokenEst.toLocaleString();
      const max = nCtx.toLocaleString();
      els.rsbCtxTokens.textContent = `${used} / ${max} tokens`;
    }
    if (els.rsbCtxPct) els.rsbCtxPct.textContent = `${pct}%`;
  }

  function addChars(n) {
    _ctxChars += n;
    updateContextBar();
  }

  function start() {
    _refreshStats();
    _statsTimer = setInterval(_refreshStats, 3000);
  }

  function stop() {
    if (_statsTimer) { clearInterval(_statsTimer); _statsTimer = null; }
  }

  return { start, stop, updateContextBar, addChars };
})();

// ── Shared Profile Map (4 canonical profiles) ───────────────────────────────
const PROFILE_MAP = {
    default:  { label: 'Default',  prompt: 'You are Localis, a helpful local AI assistant.' },
    custom:   { label: 'Custom',   prompt: '' },  // user-editable
    creative: { label: 'Creative', prompt: 'You are Localis, a creative brainstorming partner. Think broadly, suggest unexpected ideas, and explore multiple angles before converging.' },
    planning: { label: 'Planning', prompt: 'You are Localis, a precise implementation planner. Break tasks into concrete steps, identify dependencies, and flag risks early.' },
};

// setActiveProfile — single function used by RSB chips, settings modal, and loadSettings
function setActiveProfile(key) {
    if (!PROFILE_MAP[key]) return;

    // Update RSB preset chips
    document.querySelectorAll('#rsb-prompt-presets .rsb-pchip').forEach(c =>
        c.classList.toggle('active', c.dataset.preset === key));

    // Update settings modal profile chips (if rendered)
    document.querySelectorAll('#settings-profile-list .profile-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.profileKey === key));

    // Update the settings profile textarea with the profile's prompt
    const promptTA = document.getElementById('set-sys-prompt');
    if (promptTA) promptTA.value = PROFILE_MAP[key].prompt;

    // Apply prompt to the hidden system prompt editor (legacy compat)
    const val = PROFILE_MAP[key].prompt;
    if (els.systemPromptEditor) els.systemPromptEditor.value = val;
    if (els.modalSystemPrompt)  els.modalSystemPrompt.value = val;
    api.saveSystemPrompt?.();

    // Track active profile in state
    state.activeProfile = key;
}

// renderSettingsProfiles — populate the Profiles tab chip list from PROFILE_MAP
function renderSettingsProfiles() {
    const list = document.getElementById('settings-profile-list');
    if (!list) return;
    list.innerHTML = '';
    Object.entries(PROFILE_MAP).forEach(([key, profile]) => {
        const chip = document.createElement('button');
        chip.className = 'profile-chip' + (state.activeProfile === key ? ' active' : '');
        chip.textContent = profile.label;
        chip.dataset.profileKey = key;
        chip.addEventListener('click', () => {
            setActiveProfile(key);
            // If custom profile, allow editing in textarea
            if (key === 'custom') {
                const promptTA = document.getElementById('set-sys-prompt');
                if (promptTA) {
                    promptTA.value = PROFILE_MAP.custom.prompt;
                    promptTA.focus();
                }
            }
        });
        list.appendChild(chip);
    });
}

// Right sidebar system prompt preset chips — delegated to setActiveProfile
document.querySelectorAll('#rsb-prompt-presets .rsb-pchip').forEach(chip => {
    chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        if (PROFILE_MAP[preset]) setActiveProfile(preset);
    });
});

const ragUI = {
    currentFiles: [],
    ready: false,
    processingIds: new Set(),
    pollTimeout: null,

        settings: { rag_enabled: 1, auto_index: 1 },
    indexStatus: { state: 'idle' },
    indexPollInterval: null,
    eventSource: null,
    usePolling: false,
    _didInit: false,
init() {
        if (!els.ragPlusBtn || !els.ragFileInput || !els.ragPanel) return;
        if (this._didInit) return;

        // Runtime duplicate-ID check
        const plusMatches = document.querySelectorAll('#rag-plus-btn');
        const inputMatches = document.querySelectorAll('#rag-file-input');
        if (plusMatches.length !== 1 || inputMatches.length !== 1) {
            console.warn('[RAG] Duplicate ID detected! rag-plus-btn:', plusMatches.length, 'rag-file-input:', inputMatches.length);
        }

        // + button opens panel (file picker can be triggered via "Select Files" button inside)
        els.ragPlusBtn.addEventListener('click', () => {
            Logger.debug('RAG', '+ button clicked');
            this.togglePanel(true);
        });

        // Close panel
        if (els.ragPanelClose) {
            els.ragPanelClose.addEventListener('click', () => this.togglePanel(false));
        }

        // Upload button triggers file input
        if (els.ragUploadBtn) {
            els.ragUploadBtn.addEventListener('click', () => {
                els.ragFileInput.click();
            });
        }

        // File input change handler
        els.ragFileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            await this.uploadFiles(files);

            // Clear input so same file can be re-uploaded
            e.target.value = '';
        });

        // Event delegation for delete buttons on chips
        if (els.ragChipRow) {
            els.ragChipRow.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.rag-chip-delete');
                if (deleteBtn) {
                    e.stopPropagation();
                    const fileId = deleteBtn.dataset.fileId;
                    if (fileId) this.deleteFile(fileId);
                }
            });
        }

        // Event delegation for delete and active toggle in file list
        if (els.ragFileList) {
            els.ragFileList.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.rag-file-delete');
                if (deleteBtn) {
                    e.stopPropagation();
                    const fileId = deleteBtn.dataset.fileId;
                    if (fileId) this.deleteFile(fileId);
                }
            });
            els.ragFileList.addEventListener('change', (e) => {
                if (e.target.classList.contains('rag-file-active-check')) {
                    const fileId = e.target.dataset.fileId;
                    if (fileId) this.setFileActive(fileId, e.target.checked);
                }
            });
        }

        // Settings toggle listeners
        const ragEnabledToggle = document.getElementById('rag-enabled-toggle');
        const ragAutoIndexToggle = document.getElementById('rag-auto-index-toggle');
        if (ragEnabledToggle) {
            ragEnabledToggle.addEventListener('change', (e) => {
                this.setRagEnabled(e.target.checked);
            });
        }
        if (ragAutoIndexToggle) {
            ragAutoIndexToggle.addEventListener('change', (e) => {
                this.setAutoIndex(e.target.checked);
            });
        }

        // Embed now button
        const ragEmbedBtn = document.getElementById('rag-embed-btn');
        if (ragEmbedBtn) {
            ragEmbedBtn.addEventListener('click', () => this.startIndexing());
        }

        // Cancel button
        const ragCancelBtn = document.getElementById('rag-cancel-btn');
        if (ragCancelBtn) {
            ragCancelBtn.addEventListener('click', () => this.cancelIndexing());
        }

        // Mark as ready
        this.ready = true;
        this._didInit = true;

        // Initial refresh
        this.refresh();
    },

    togglePanel(show) {
        Logger.debug('RAG', 'togglePanel called', { show });
        Logger.debug('RAG', 'ragPanel element exists', !!els.ragPanel);

        const isVisible = els.ragPanel.classList.contains('visible');
        const shouldShow = show !== undefined ? show : !isVisible;

        Logger.debug('RAG', 'Panel visibility', { isVisible, shouldShow });

        if (shouldShow) {
            els.ragPanel.classList.add('visible');
            console.log('[RAG] Added visible class, classList:', els.ragPanel.classList.toString());
        } else {
            els.ragPanel.classList.remove('visible');
            console.log('[RAG] Removed visible class');
        }
    },

    async uploadFiles(fileList) {
        const sessionId = state.sessionId;
        const uploadedFileIds = [];

        for (const file of fileList) {
            try {
                const formData = new FormData();
                formData.append('session_id', sessionId);
                formData.append('file', file);

                const response = await fetch('/rag/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    if (error.detail === 'unsupported_file_type') {
                        alert(`Unsupported file type: ${file.name}\nAllowed: PDF, TXT, MD, DOCX, CSV`);
                    } else if (error.detail === 'file_too_large') {
                        alert(`File too large: ${file.name}\nMaximum size: 100MB`);
                    } else {
                        alert(`Upload failed: ${file.name}\n${error.detail || 'Unknown error'}`);
                    }
                    continue;
                }

                const result = await response.json();
                console.log('Uploaded:', result.file.original_name);
                uploadedFileIds.push(result.file.id);

            } catch (err) {
                console.error('Upload error:', err);
                alert(`Upload failed: ${file.name}\n${err.message}`);
            }
        }

        // Refresh list after all uploads
        await this.refresh();

        // Auto-process uploaded files sequentially
        if (uploadedFileIds.length > 0) {
            await this.processFiles(uploadedFileIds);
        }

        // Keep panel visible after upload
        this.togglePanel(true);
    },

    async processFiles(fileIds) {
        const sessionId = state.sessionId;

        // Show panel when processing starts
        this.togglePanel(true);

        for (const fileId of fileIds) {
            await this.processFile(fileId, sessionId);
        }

        // Final refresh after all processing
        await this.refresh();

        // Auto-start indexing if enabled
        if (this.settings.auto_index && this.indexStatus.state !== 'running') {
            await this.startIndexing();
        }
    },

    async processFile(fileId, sessionId) {
        try {
            this.processingIds.add(fileId);
            await this.refresh();

            const response = await fetch(
                `/rag/process/${fileId}?session_id=${encodeURIComponent(sessionId)}`,
                { method: 'POST' }
            );

            if (!response.ok) {
                const error = await response.json();
                console.error('Process failed:', error);
            } else {
                const result = await response.json();
                console.log('Processed:', result);
            }

            this.processingIds.delete(fileId);

            // Refresh to show updated status
            await this.refresh();

        } catch (err) {
            console.error('Process error:', err);
            this.processingIds.delete(fileId);
            await this.refresh();
        }
    },

    async refresh() {
        // Guard: only refresh if initialized
        if (!this.ready) return;

        try {
            const sessionId = state.sessionId;
            const response = await fetch(`/rag/list?session_id=${encodeURIComponent(sessionId)}`);

            if (!response.ok) {
                console.error('Failed to fetch RAG files');
                return;
            }

            const data = await response.json();
            this.currentFiles = data.files || [];
            
            // Store settings
            if (data.settings) {
                this.settings = data.settings;
                // Sync toggle UI with settings
                const ragEnabledToggle = document.getElementById('rag-enabled-toggle');
                const ragAutoIndexToggle = document.getElementById('rag-auto-index-toggle');
                if (ragEnabledToggle) ragEnabledToggle.checked = Boolean(this.settings.rag_enabled);
                if (ragAutoIndexToggle) ragAutoIndexToggle.checked = Boolean(this.settings.auto_index);
            }
            
            this.render(this.currentFiles);

        } catch (err) {
            console.error('RAG refresh error:', err);
        }
    },

    async deleteFile(fileId) {
        // Confirmation
        if (!confirm('Delete this file?')) {
            return;
        }

        try {
            const sessionId = state.sessionId;
            const response = await fetch(`/rag/file/${fileId}?session_id=${encodeURIComponent(sessionId)}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const error = await response.json();
                if (error.detail === 'session_mismatch') {
                    alert('Error: File does not belong to this session');
                } else if (error.detail === 'file_not_found') {
                    alert('Error: File not found');
                } else {
                    alert(`Delete failed: ${error.detail || 'Unknown error'}`);
                }
                return;
            }

            console.log('Deleted file:', fileId);

            // Refresh list after deletion
            await this.refresh();

        } catch (err) {
            console.error('Delete error:', err);
            alert(`Delete failed: ${err.message}`);
        }
    },

    render(files) {
        // Render file list in panel
        if (els.ragFileList) {
            if (files.length === 0) {
                els.ragFileList.innerHTML = '<div style="text-align:center; color:var(--text-secondary); font-size:0.75rem; padding:20px; opacity:0.6;">No files uploaded</div>';
            } else {
                els.ragFileList.innerHTML = files.map(file => {
                    const isProcessing = this.processingIds.has(file.id);
                    const statusClass = `rag-status rag-status-${file.status || 'uploaded'}`;
                    let statusLabel = (file.status || 'uploaded').charAt(0).toUpperCase() + (file.status || 'uploaded').slice(1);
                    if (isProcessing) statusLabel = 'Processing…';

                    // Build stats string
                    let stats = '';
                    if (file.page_count !== null && file.page_count !== undefined) {
                        stats += `${file.page_count}p `;
                    }
                    if (file.char_count !== null && file.char_count !== undefined) {
                        stats += `${file.char_count}c `;
                    }
                    if (file.chunk_count !== null && file.chunk_count !== undefined) {
                        stats += `${file.chunk_count}ch`;
                    }

                    // Error message
                    const errorMsg = file.error ? ` — ${file.error.substring(0, 50)}${file.error.length > 50 ? '...' : ''}` : '';

                    return `
                        <div class="rag-file-item ${!file.is_active ? 'inactive' : ''}">
                            <div style="flex: 1; min-width: 0;">
                                <div class="rag-file-name" title="${escapeHtml(file.original_name)}">
                                    ${escapeHtml(file.original_name)}
                                </div>
                                <div style="display: flex; gap: 12px; align-items: center; margin-top: 4px; font-size: 0.75rem;">
                                    <span class="${statusClass}">${statusLabel}</span>
                                    ${stats ? `<span style="color: var(--text-secondary); opacity: 0.7;">${stats}</span>` : ''}
                                    ${errorMsg ? `<span style="color: #EF4444; opacity: 0.9;">${escapeHtml(errorMsg)}</span>` : ''}
                                </div>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <label class="rag-file-active-toggle" title="Include in RAG queries">
                                    <input type="checkbox" data-file-id="${file.id}" ${file.is_active ? 'checked' : ''} class="rag-file-active-check">
                                </label>
                                <button class="rag-file-delete" data-file-id="${file.id}" title="Delete file">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Render chips with delete buttons
        if (els.ragChipRow) {
            if (files.length === 0) {
                els.ragChipRow.innerHTML = '';
            } else {
                els.ragChipRow.innerHTML = files.map(file => {
                    const ext = file.original_name.split('.').pop().toUpperCase();
                    const isProcessing = this.processingIds.has(file.id);
                    const isInactive = !file.is_active;
                    const chipClass = isProcessing ? 'rag-chip processing' : (isInactive ? 'rag-chip inactive' : 'rag-chip');
                    return `
                        <div class="${chipClass}" data-file-id="${file.id}" title="${escapeHtml(file.original_name)}">
                            <svg class="rag-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                                <polyline points="13 2 13 9 20 9"></polyline>
                            </svg>
                            <span class="rag-chip-label">${ext}</span>
                            ${isProcessing ? '<span class="rag-chip-spinner">⟳</span>' : ''}
                            <button class="rag-chip-delete" data-file-id="${file.id}" title="Delete file">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    `;
                }).join('');
            }
        }
    },

    async setRagEnabled(enabled) {
        try {
            const response = await fetch(`/rag/settings?session_id=${encodeURIComponent(state.sessionId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rag_enabled: enabled
                })
            });
            const data = await response.json();
            if (data.ok) {
                this.settings.rag_enabled = enabled ? 1 : 0;
                console.log(`[RAG] Enabled: ${enabled}`);
            }
        } catch (e) {
            console.error('[RAG] Failed to update enabled setting:', e);
        }
    },

    async setAutoIndex(enabled) {
        try {
            const response = await fetch(`/rag/settings?session_id=${encodeURIComponent(state.sessionId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    auto_index: enabled
                })
            });
            const data = await response.json();
            if (data.ok) {
                this.settings.auto_index = enabled ? 1 : 0;
                console.log(`[RAG] Auto-index: ${enabled}`);
            }
        } catch (e) {
            console.error('[RAG] Failed to update auto-index setting:', e);
        }
    },

    async setFileActive(fileId, isActive) {
        try {
            const response = await fetch(`/rag/file_active?session_id=${encodeURIComponent(state.sessionId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_id: fileId,
                    is_active: isActive
                })
            });
            const data = await response.json();
            if (data.ok) {
                // Update local file list
                const file = this.currentFiles.find(f => f.id === fileId);
                if (file) {
                    file.is_active = isActive;
                    this.render(this.currentFiles);
                }
                console.log(`[RAG] File ${fileId} active: ${isActive}`);
            }
        } catch (e) {
            console.error('[RAG] Failed to set file active:', e);
        }
    },

    async startIndexing() {
        if (this.indexStatus.state === 'running') {
            console.warn('[RAG] Indexing already running');
            return;
        }

        try {
            // Start async indexing
            const response = await fetch(`/rag/index_start?session_id=${encodeURIComponent(state.sessionId)}&force=false`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.ok) {
                this.indexStatus = data.status;
                console.log('[RAG] Indexing started');

                // Update UI
                const embedBtn = document.getElementById('rag-embed-btn');
                const cancelBtn = document.getElementById('rag-cancel-btn');
                if (embedBtn) embedBtn.classList.add('hidden');
                if (cancelBtn) cancelBtn.classList.remove('hidden');

                // Poll for status updates
                this.pollIndexStatus();
            } else {
                console.error('[RAG] Failed to start indexing:', data.error);
                showToast('Failed to start indexing', 'error');
            }
        } catch (e) {
            console.error('[RAG] Error starting indexing:', e);
            showToast('Error starting indexing', 'error');
        }
    },

    async cancelIndexing() {
        try {
            const response = await fetch(`/rag/index_cancel?session_id=${encodeURIComponent(state.sessionId)}`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.ok) {
                console.log('[RAG] Indexing cancelled');
                this.indexStatus.state = 'idle';

                // Update UI
                const embedBtn = document.getElementById('rag-embed-btn');
                const cancelBtn = document.getElementById('rag-cancel-btn');
                if (embedBtn) embedBtn.classList.remove('hidden');
                if (cancelBtn) cancelBtn.classList.add('hidden');

                const statusLine = document.getElementById('rag-status-line');
                if (statusLine) statusLine.textContent = 'Indexing cancelled';

                // Stop polling
                if (this.indexPollInterval) {
                    clearInterval(this.indexPollInterval);
                    this.indexPollInterval = null;
                }
            }
        } catch (e) {
            console.error('[RAG] Error cancelling indexing:', e);
        }
    },

    pollIndexStatus() {
        // Clear any existing poll
        if (this.indexPollInterval) {
            clearInterval(this.indexPollInterval);
        }

        let pollCount = 0;
        const MAX_POLLS = 30; // 60 seconds at 2000ms intervals

        // Poll every 2s (reduced from 500ms to minimize CPU overhead)
        this.indexPollInterval = setInterval(async () => {
            pollCount++;

            // Timeout safeguard
            if (pollCount >= MAX_POLLS) {
                console.warn('[RAG] Polling timeout - stopping after 60s');
                clearInterval(this.indexPollInterval);
                this.indexPollInterval = null;
                this.indexStatus.state = 'idle';

                const statusLine = document.getElementById('rag-status-line');
                if (statusLine) statusLine.textContent = 'Indexing timeout';
                showToast('Indexing timeout - please try again', 'error');

                // Reset UI
                const embedBtn = document.getElementById('rag-embed-btn');
                const cancelBtn = document.getElementById('rag-cancel-btn');
                if (embedBtn) embedBtn.classList.remove('hidden');
                if (cancelBtn) cancelBtn.classList.add('hidden');
                return;
            }

            try {
                const response = await fetch(`/rag/index_status?session_id=${state.sessionId}`);
                const data = await response.json();

                if (data.ok) {
                    // Backend returns data at top level, not nested in 'status'
                    // Extract fields directly from data object
                    const { ok, ...status } = data;
                    this.indexStatus = status;
                    const statusLine = document.getElementById('rag-status-line');

                    if (this.indexStatus.state === 'running') {
                        const progress = `Indexing: ${this.indexStatus.done_files || 0}/${this.indexStatus.total_files || 0} files`;
                        if (statusLine) statusLine.textContent = progress;
                    } else if (this.indexStatus.state === 'done') {
                        if (statusLine) statusLine.textContent = `Indexed ${this.indexStatus.done_files} files successfully`;

                        // Show success toast with instruction to use "From Files" button
                        showToast(
                            `Indexed ${this.indexStatus.done_files} file${this.indexStatus.done_files !== 1 ? 's' : ''} successfully!\n💡 Click "From Files" button to use them in chat.`,
                            'success',
                            5000  // Show for 5 seconds
                        );

                        // Reset UI
                        const embedBtn = document.getElementById('rag-embed-btn');
                        const cancelBtn = document.getElementById('rag-cancel-btn');
                        if (embedBtn) embedBtn.classList.remove('hidden');
                        if (cancelBtn) cancelBtn.classList.add('hidden');

                        // Stop polling
                        clearInterval(this.indexPollInterval);
                        this.indexPollInterval = null;

                        // Refresh file list to show updated status
                        await this.refresh();

                        // Highlight the From Files button if RAG is not already selected
                        const ragBtn = document.querySelector('.tool-option[data-tool="rag_retrieve"]');
                        if (ragBtn && !toolsUI.selectedTools.has('rag_retrieve')) {
                            ragBtn.classList.add('rag-available');

                            // Remove highlight after 10 seconds or when clicked
                            const removeHighlight = () => {
                                ragBtn.classList.remove('rag-available');
                                ragBtn.removeEventListener('click', removeHighlight);
                            };
                            setTimeout(removeHighlight, 10000);
                            ragBtn.addEventListener('click', removeHighlight, { once: true });
                        }
                    } else if (this.indexStatus.state === 'failed') {
                        if (statusLine) statusLine.textContent = 'Indexing failed';
                        showToast('Indexing failed', 'error');

                        // Reset UI
                        const embedBtn = document.getElementById('rag-embed-btn');
                        const cancelBtn = document.getElementById('rag-cancel-btn');
                        if (embedBtn) embedBtn.classList.remove('hidden');
                        if (cancelBtn) cancelBtn.classList.add('hidden');

                        // Stop polling
                        clearInterval(this.indexPollInterval);
                        this.indexPollInterval = null;
                    } else if (this.indexStatus.state === 'idle') {
                        // Indexing completed or not started - stop polling
                        clearInterval(this.indexPollInterval);
                        this.indexPollInterval = null;
                    } else {
                        // Unknown state - stop polling to prevent infinite loop
                        console.warn('[RAG] Unknown index state:', this.indexStatus.state);
                        clearInterval(this.indexPollInterval);
                        this.indexPollInterval = null;
                    }
                }
            } catch (e) {
                console.error('[RAG] Error polling index status:', e);
            }
        }, 2000); // 2s instead of 500ms for 75% reduction in polling overhead
    }
};

// --- UI HELPERS ---
if(els.btnSidebarToggle) els.btnSidebarToggle.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    els.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
});

const toggleSettings = (show) => {
    const rsb = els.rightSidebar;
    if (!rsb) return;
    // Determine intended open/closed state
    const shouldOpen = (show !== undefined) ? show : rsb.classList.contains('collapsed');
    state.rightSidebarOpen = shouldOpen;
    // Use .collapsed (CSS-controlled width) — .visible has no CSS rule
    rsb.classList.toggle('collapsed', !shouldOpen);

    // In tutorial mode, keep rail visible and use body class for narrator reflow
    if (document.body.classList.contains('first-run-tutorial')) {
        document.body.classList.toggle('frt-settings-open', shouldOpen);
        // Don't hide the rail in tutorial mode - it stays as the handle
    } else {
        // Normal mode: hide rail when sidebar opens
        if(els.rightRail) {
            if(shouldOpen) els.rightRail.classList.add('hidden');
            else els.rightRail.classList.remove('hidden');
        }
    }
};

const openRightSidebarSection = (sectionKey) => {
    toggleSettings(true);
    let targetId = null;
    if(sectionKey === 'model') targetId = 'grp-model';
    else if(sectionKey === 'temp') targetId = 'grp-temp';
    else if(sectionKey === 'memory') targetId = 'memory-matrix-container';

    if(targetId) {
        const el = document.getElementById(targetId);
        if(el) {
            if(targetId === 'memory-matrix-container') {
                el.style.display = 'block';
                loadAndRenderMemoryMatrix();
            }
            setTimeout(() => el.scrollIntoView({behavior: 'smooth', block: 'center'}), 100);
        }
    }
};

const btnRailModel = document.getElementById('btn-rail-model');
if (btnRailModel) {
    btnRailModel.onclick = () => {
        if (document.body.classList.contains('first-run-tutorial')) {
            document.body.classList.add('frt-right-sidebar-unlocked', 'frt-allow-right-sidebar', 'frt-only-model');
            openRightSidebarSection('model');
            showOptional("Good. That's the loader. Pick a model and let's bring the brain online.", true, "tutorial-loader");
        } else {
            openRightSidebarSection('model');
        }
    };
}
if(document.getElementById('btn-rail-temp')) document.getElementById('btn-rail-temp').onclick = () => openRightSidebarSection('temp');
if(document.getElementById('btn-rail-memory')) document.getElementById('btn-rail-memory').onclick = () => openRightSidebarSection('memory');
if(els.btnOpenSettings) els.btnOpenSettings.onclick = () => toggleSettings(!state.rightSidebarOpen);
if(els.btnOpenSettingsSidebar) els.btnOpenSettingsSidebar.onclick = () => toggleSettings(true);
if(els.btnOpenSettingsRail) els.btnOpenSettingsRail.onclick = () => toggleSettings(true);
if(els.btnCloseSettings) els.btnCloseSettings.onclick = () => {
    // In tutorial, only allow closing if sidebar is unlocked
    if (document.body.classList.contains('first-run-tutorial')) {
        if (!document.body.classList.contains('frt-right-sidebar-unlocked')) return;
    }
    toggleSettings(false);
}
if(els.modelDisplay) els.modelDisplay.onclick = () => toggleSettings(true);
// Wire top-bar settings button
if (els.btnTopSettings) {
    els.btnTopSettings.addEventListener('click', () => {
        // Delegate to existing settings toggle
        if (els.btnOpenSettings) els.btnOpenSettings.click();
    });
}
// LSB footer gear (collapsed state) opens right sidebar (legacy behaviour preserved)
document.getElementById('btn-lsb-settings')?.addEventListener('click', () => toggleSettings(true));

// ── App Settings Modal (new full-page settings overlay) ─────────────────────
(function initSettingsModal() {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay) return;

    // Tab switching
    overlay.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlay.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            overlay.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            overlay.querySelector(`.settings-pane[data-pane="${tab.dataset.tab}"]`)?.classList.add('active');
        });
    });

    // Open settings modal
    function openSettingsModal() {
        overlay.classList.remove('hidden');
        renderSettingsProfiles();
        // Pre-fill inference fields from existing hidden inputs (legacy compat)
        const setCtx = document.getElementById('set-ctx');
        const setGpu = document.getElementById('set-gpu-layers');
        if (setCtx && els.inputs?.ctx) setCtx.value = els.inputs.ctx.value || 4096;
        if (setGpu && els.inputs?.layers) setGpu.value = els.inputs.layers.value || 35;
        // Pre-fill accent colour
        const setAccent = document.getElementById('set-accent');
        if (setAccent) {
            const computed = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
            if (computed) setAccent.value = computed.replace(/\s/g, '');
        }
    }

    // Close settings modal
    function closeSettingsModal() {
        overlay.classList.add('hidden');
    }

    // Wire close button
    document.getElementById('btn-settings-close')?.addEventListener('click', closeSettingsModal);

    // Close on backdrop click
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSettingsModal(); });

    // Close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeSettingsModal();
    });

    // Wire save button
    document.getElementById('btn-settings-save')?.addEventListener('click', saveSettings);

    // Wire top-bar settings button to open settings modal (override old behaviour)
    if (els.btnTopSettings) {
        // Remove any previously attached listeners by cloning
        const newBtn = els.btnTopSettings.cloneNode(true);
        els.btnTopSettings.parentNode?.replaceChild(newBtn, els.btnTopSettings);
        els.btnTopSettings = newBtn;
        newBtn.addEventListener('click', openSettingsModal);
    }

    // Custom prompt textarea: update PROFILE_MAP.custom on input so save picks it up
    const promptTA = document.getElementById('set-sys-prompt');
    if (promptTA) {
        promptTA.addEventListener('input', () => {
            if (state.activeProfile === 'custom') {
                PROFILE_MAP.custom.prompt = promptTA.value;
            }
        });
    }

    // Populate model select from existing model list when opened
    const setModel = document.getElementById('set-model');
    if (setModel && window._modelsList) {
        window._modelsList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = m.name.replace(/\.gguf$/i, '');
            setModel.appendChild(opt);
        });
    }

    // Export openSettingsModal so other code can call it
    window.openSettingsModal = openSettingsModal;
})();

// ── Settings Save ────────────────────────────────────────────────────────────
async function saveSettings() {
    const payload = {
        accent_color: document.getElementById('set-accent')?.value || '#5A8CFF',
        wallpaper_opacity: parseFloat(document.getElementById('set-wall-opacity')?.value || 0.3),
        gpu_layers: parseInt(document.getElementById('set-gpu-layers')?.value || 35),
        context_size: parseInt(document.getElementById('set-ctx')?.value || 4096),
        active_profile: state.activeProfile || 'default',
        custom_profile_prompt: PROFILE_MAP.custom?.prompt || '',
    };
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok) {
            // Apply accent colour immediately
            if (payload.accent_color) {
                document.documentElement.style.setProperty('--accent-primary', payload.accent_color);
            }
            document.getElementById('settings-overlay')?.classList.add('hidden');
        } else {
            Logger.warn('Settings', 'Save returned non-OK status', res.status);
        }
    } catch (e) {
        Logger.warn('Settings', 'Settings save failed', e);
    }
}

// ── Settings Load (called on startup) ───────────────────────────────────────
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const s = await res.json();
        if (s.accent_color) {
            document.documentElement.style.setProperty('--accent-primary', s.accent_color);
        }
        if (s.custom_profile_prompt && PROFILE_MAP.custom) {
            PROFILE_MAP.custom.prompt = s.custom_profile_prompt;
        }
        if (s.active_profile) setActiveProfile(s.active_profile);
        else setActiveProfile('default');
    } catch (e) {
        // Silently skip — settings are optional
        Logger.debug('Settings', 'loadSettings failed (non-fatal)', e);
    }
}

if(els.prompt) els.prompt.addEventListener('input', function() {
    this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
    els.sendBtn.classList.toggle('ready', this.value.trim().length > 0);
    // Token estimate hint
    const est = Math.round(this.value.length / 4);
    if (els.tokenEstimate) els.tokenEstimate.textContent = est > 0 ? `~${est} tokens` : '';
});

const linkInput = (slider, input, scale = 1, settingKey = null) => {
    if(!slider || !input) return;
    slider.addEventListener('input', () => {
        input.value = slider.value / scale;
        if(settingKey) AppSettings.set(settingKey, input.value);
    });
        input.addEventListener('change', () => {
            slider.value = input.value * scale;
            if(settingKey) AppSettings.set(settingKey, input.value);
        });
};
linkInput(els.sliders.layers, els.inputs.layers, 1, 'layers');
linkInput(els.sliders.ctx, els.inputs.ctx, 1, 'ctx');
if(els.sliders.temp && els.inputs.temp) {
    els.sliders.temp.addEventListener('input', () => {
        els.inputs.temp.value = els.sliders.temp.value / 10;
        AppSettings.set('temp', els.inputs.temp.value);
    });
    els.inputs.temp.addEventListener('change', () => {
        els.sliders.temp.value = els.inputs.temp.value * 10;
        AppSettings.set('temp', els.inputs.temp.value);
    });
}

if(els.btnSearchToggle) els.btnSearchToggle.addEventListener('click', () => {
    const modes = ["off", "enabled", "auto"];
    const nextIndex = (modes.indexOf(state.webSearchMode) + 1) % modes.length;
    state.webSearchMode = modes[nextIndex];
    els.btnSearchToggle.textContent = `WEB SEARCH: ${state.webSearchMode.toUpperCase()}`;
    els.btnSearchToggle.classList.toggle('active', state.webSearchMode !== 'off');
});

const elAccent = document.getElementById('picker-accent');
const updateAccent = (color) => {
    if (!color) return;
    document.documentElement.style.setProperty('--text-accent', color);
    AppSettings.set('accent', color);
    if(elAccent) elAccent.value = color;
};
if(elAccent) elAccent.addEventListener('input', (e) => updateAccent(e.target.value));

// Theme selector removed — theme is now fixed (midnight-glass via CSS variables)

const updateStatus = (online, msg) => {
    els.connStatus.textContent = msg;
    els.statusDot.className = `status-indicator ${online ? 'online' : 'offline'}`;
    els.prompt.disabled = !online;
    els.modelStatus.textContent = online ? "STATUS: ONLINE" : "STATUS: OFFLINE";
    els.modelStatus.style.color = online ? "#10B981" : "#EF4444";
};

function buildMessageHTML(role, text) {
    const isUser = role === 'user';
    const initial = isUser ? ((window.userPreferredName)?.[0]?.toUpperCase() || 'U') : 'L';
    const displayName = isUser ? (window.userPreferredName || 'You') : 'Localis';
    return `
        <div class="msg-row ${isUser ? 'user' : 'ai'}">
          <div class="msg-avatar ${isUser ? 'user' : 'ai'}">${initial}</div>
          <div class="msg-body">
            <div class="msg-name">${escapeHtml(displayName)}</div>
            <div class="msg-text">${escapeHtml(text)}</div>
          </div>
        </div>`;
}

function buildActionCardHTML(type, title, subtitle) {
    const cardClass = type === 'home' ? 'home' : 'memory';
    const iconId   = type === 'home' ? 'ico-home' : 'ico-memory';
    return `
        <div class="action-card ${cardClass}">
          <svg width="16" height="16" style="flex-shrink:0"><use href="#${iconId}"/></svg>
          <div>
            <div class="action-card-title">${escapeHtml(title)}</div>
            <div class="action-card-sub">${escapeHtml(subtitle)}</div>
          </div>
        </div>`;
}

// --- MESSAGE ACTION CHIPS ---
// Appends Copy / Regenerate / Continue chips below a completed assistant message row.
function addMessageActionChips(msgRowEl, plainText) {
    const chips = document.createElement('div');
    chips.className = 'msg-actions';
    chips.innerHTML = `
        <button class="msg-action-chip" data-action="copy">Copy</button>
        <button class="msg-action-chip" data-action="regen">Regenerate</button>
        <button class="msg-action-chip" data-action="continue">Continue</button>
    `;
    chips.querySelector('[data-action="copy"]').onclick = () =>
        navigator.clipboard.writeText(plainText);
    chips.querySelector('[data-action="regen"]').onclick = () =>
        api.chat(state.lastUserMessage);
    chips.querySelector('[data-action="continue"]').onclick = () =>
        api.chat('Please continue.');
    msgRowEl.appendChild(chips);
}

// --- DATE GROUP SEPARATORS ---
function groupMessagesByDate(messages) {
    let lastLabel = null;
    const result = [];
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const isSameDay = (a, b) => a.toDateString() === b.toDateString();
    for (const msg of messages) {
        const msgDate = msg.created_at ? new Date(msg.created_at) : null;
        if (msgDate && !isNaN(msgDate)) {
            const label = isSameDay(msgDate, today)
                ? 'Today'
                : isSameDay(msgDate, yesterday)
                    ? 'Yesterday'
                    : msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (label !== lastLabel) {
                result.push({ type: 'separator', label });
                lastLabel = label;
            }
        }
        result.push(msg);
    }
    return result;
}

const appendMessage = (role, text) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildMessageHTML(role, text);
    const rowEl = wrapper.firstElementChild;
    if (role === 'assistant') {
        const msgText = rowEl.querySelector('.msg-text');
        if (msgText) {
            msgText.innerHTML = marked.parse(text);
            msgText.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
    }
    els.chatHistory.appendChild(rowEl);
    // Scroll the viewport (#chat-zone), not the inner container (#chat-history)
    const _vp = els.chatZone || document.getElementById('chat-zone');
    if (_vp) _vp.scrollTop = _vp.scrollHeight;
    rsbStats.addChars(text.length);
};

const endTutorial = async () => {
    markFirstRunComplete();

    // Clear tip hide timer
    if (FRT.tipHideTimer) {
        clearTimeout(FRT.tipHideTimer);
        FRT.tipHideTimer = null;
    }

    // Remove all tutorial classes
    const tutorialClasses = Array.from(document.body.classList).filter(c => c.startsWith('frt-') || c === 'first-run-tutorial' || c === 'is-dimmed');
    tutorialClasses.forEach(c => document.body.classList.remove(c));

    // Hide overlay
    const overlay = document.getElementById('frt-overlay');
    if (overlay) overlay.style.display = 'none';

    // Clear tutorial history
    state.tutorialHistory = [];

    // Unlock Sidebar
    state.sidebarCollapsed = false;
    if(els.sidebar) els.sidebar.classList.remove('collapsed');

    // Unlock inputs
    if(els.prompt) {
        els.prompt.disabled = false;
        els.prompt.placeholder = "Type your message...";
    }

    // Clear inline locks applied by tutorial
    const chatArea = document.querySelector('.chat-area');
    const inputWrapper = document.querySelector('.input-wrapper');
    const mainContent = document.querySelector('.main-content');

    if (chatArea) {
        chatArea.style.pointerEvents = '';
        chatArea.style.opacity = '';
    }
    if (inputWrapper) {
        inputWrapper.style.pointerEvents = '';
        inputWrapper.style.opacity = '';
    }
    if (mainContent) {
        mainContent.style.pointerEvents = '';
        mainContent.style.opacity = '';
    }
    if (els.sendBtn) {
        els.sendBtn.style.pointerEvents = '';
    }

    // Finalize state
    await api.getSessions();
    await api.loadHistory();

    // Force refresh layout
    window.dispatchEvent(new Event('resize'));
};

// --- RPG QUESTIONNAIRE LOGIC ---
const RPG_QUESTIONS = [
    {
        id: "name",
        type: "text",
        prompt: "What should I call you?",
        placeholder: "Your first name",
        validation: (val) => val.trim().length > 0
    },
{
    id: "domain",
    type: "single",
    prompt: "What brings you here?",
    choices: [
        "Software Development / Tech",
        "Creative Work (Writing, Art)",
        "Business / Entrepreneurship",
        "Student / Learning",
        "Research / Academia",
        "Just Exploring"
    ]
},
{
    id: "style",
    type: "single",
    prompt: "How should I communicate?",
    choices: [
        { label: "Professional & Concise", desc: "Get to the point, no fluff" },
        { label: "Casual & Conversational", desc: "Friendly, relaxed tone" },
        { label: "Detailed & Thorough", desc: "Explain everything step-by-step" },
        { label: "Creative & Playful", desc: "Have fun with it" }
    ]
},
{
    id: "capabilities",
    type: "multi",
    prompt: "What do you need help with? (Select up to 3)",
    maxChoices: 3,
    choices: [
        "Writing & Brainstorming",
        "Coding & Technical Problems",
        "Research & Learning",
        "Personal Productivity",
        "Creative Projects",
        "General Conversation"
    ]
},
{
    id: "identity",
    type: "identity",
    prompt: "A few quick details for your identity (all optional)",
    optional: true
},
{
    id: "custom",
    type: "text",
    prompt: "Any special instructions? (Optional)",
    placeholder: "e.g., 'Be encouraging', 'Avoid jargon'",
    optional: true
}
];

const RPG = {
    currentIndex: 0,
    reviewInitialized: false,
    loadingInterval: null,
    answers: {
        name: "",
        domain: "",
        style: "",
        capabilities: [],
        identity: {
            preferred_name: "",
            location: "",
            timezone: "",
            language_preferences: "English"
        },
        custom: ""
    },
    elements: {
        overlay: null,
        questionText: null,
        choices: null,
        backBtn: null,
        nextBtn: null
    },

    init() {
        this.elements.overlay = document.getElementById('rpg-questionnaire');
        this.elements.questionText = document.querySelector('.rpg-question-text');
        this.elements.choices = document.querySelector('.rpg-choices');
        this.elements.backBtn = document.getElementById('rpg-back-btn');
        this.elements.nextBtn = document.getElementById('rpg-next-btn');

        // Event listeners
        this.elements.backBtn.addEventListener('click', () => this.goBack());
        this.elements.nextBtn.addEventListener('click', () => this.goNext());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (!this.elements.overlay.classList.contains('hidden')) {
                if (e.key === 'Enter' && !this.elements.nextBtn.disabled) {
                    this.goNext();
                }
            }
        });
    },

    show() {
        this.currentIndex = 0;
        this.elements.overlay.classList.remove('hidden');
        this.render();
    },

    hide() {
        this.elements.overlay.classList.add('hidden');

        // Ensure loading interval is cleared if hide() is called directly
        if (this.loadingInterval) {
            clearInterval(this.loadingInterval);
            this.loadingInterval = null;
        }
    },

    render() {
        const question = RPG_QUESTIONS[this.currentIndex];

        // Update question text
        this.elements.questionText.textContent = question.prompt;

        // Clear previous choices
        this.elements.choices.innerHTML = '';

        // Render based on type
        if (question.type === 'text') {
            this.renderTextInput(question);
        } else if (question.type === 'single') {
            this.renderSingleChoice(question);
        } else if (question.type === 'multi') {
            this.renderMultiChoice(question);
        } else if (question.type === 'identity') {
            this.renderIdentity(question);
        }

        // Update navigation buttons
        this.updateNavigation();
    },

    renderTextInput(question) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rpg-text-input';
        input.placeholder = question.placeholder || '';
        input.value = this.answers[question.id] || '';

        input.addEventListener('input', (e) => {
            this.answers[question.id] = e.target.value;

            // Map name question to identity.preferred_name
            if (question.id === 'name') {
                if (!this.answers.identity) {
                    this.answers.identity = {
                        preferred_name: "",
                        location: "",
                        timezone: "",
                        language_preferences: "English"
                    };
                }
                this.answers.identity.preferred_name = e.target.value.trim();
            }

            this.updateNavigation();
        });

        this.elements.choices.appendChild(input);

        // Auto-focus
        setTimeout(() => input.focus(), 100);
    },

    renderSingleChoice(question) {
        question.choices.forEach((choice, index) => {
            const label = document.createElement('label');
            label.className = 'rpg-choice';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = question.id;
            radio.value = typeof choice === 'string' ? choice : choice.label;

            // Check if this was previously selected
            if (this.answers[question.id] === radio.value) {
                radio.checked = true;
                label.classList.add('selected');
            }

            radio.addEventListener('change', () => {
                this.answers[question.id] = radio.value;
                // Update selected class
                document.querySelectorAll('.rpg-choice').forEach(c => c.classList.remove('selected'));
                label.classList.add('selected');
                this.updateNavigation();
            });

            const textSpan = document.createElement('span');
            if (typeof choice === 'string') {
                textSpan.textContent = choice;
            } else {
                textSpan.innerHTML = `<strong>${choice.label}</strong><br><span style="font-size: 18px; color: rgba(255,255,255,0.7);">${choice.desc}</span>`;
            }

            label.appendChild(radio);
            label.appendChild(textSpan);
            this.elements.choices.appendChild(label);
        });
    },

    renderMultiChoice(question) {
        question.choices.forEach((choice, index) => {
            const label = document.createElement('label');
            label.className = 'rpg-choice';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = choice;

            // Check if this was previously selected
            if (this.answers[question.id].includes(choice)) {
                checkbox.checked = true;
                label.classList.add('selected');
            }

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    // Enforce max choices
                    if (this.answers[question.id].length >= question.maxChoices) {
                        checkbox.checked = false;
                        return;
                    }
                    this.answers[question.id].push(choice);
                    label.classList.add('selected');
                } else {
                    this.answers[question.id] = this.answers[question.id].filter(c => c !== choice);
                    label.classList.remove('selected');
                }
                this.updateNavigation();
            });

            const textSpan = document.createElement('span');
            textSpan.textContent = choice;

            label.appendChild(checkbox);
            label.appendChild(textSpan);
            this.elements.choices.appendChild(label);
        });
    },

    renderIdentity(question) {
        const form = document.createElement('div');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '16px';
        form.style.maxWidth = '500px';
        form.style.margin = '0 auto';

        // Detect timezone abbreviation
        const detectTimezone = () => {
            const date = new Date();
            const tzString = date.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2];
            return tzString || 'UTC';
        };

        // Note: Name is collected in the first question and mapped to identity.preferred_name
        // Location
        const locationGroup = document.createElement('div');
        locationGroup.innerHTML = `
            <label style="display:block;margin-bottom:6px;opacity:0.9;font-size:0.9em;">Where are you located?</label>
            <input type="text" id="identity-location" class="rpg-text-input" placeholder="City, Country or N/A (optional)" value="${escapeHtml(this.answers.identity.location)}" style="width:100%;">
        `;
        form.appendChild(locationGroup);

        // Timezone
        const timezoneGroup = document.createElement('div');
        const detectedTz = this.answers.identity.timezone || detectTimezone();
        timezoneGroup.innerHTML = `
            <label style="display:block;margin-bottom:6px;opacity:0.9;font-size:0.9em;">Preferred timezone?</label>
            <select id="identity-timezone" class="rpg-text-input" style="width:100%;">
                <option value="EST" ${detectedTz === 'EST' ? 'selected' : ''}>EST - Eastern Standard Time</option>
                <option value="CST" ${detectedTz === 'CST' ? 'selected' : ''}>CST - Central Standard Time</option>
                <option value="MST" ${detectedTz === 'MST' ? 'selected' : ''}>MST - Mountain Standard Time</option>
                <option value="PST" ${detectedTz === 'PST' ? 'selected' : ''}>PST - Pacific Standard Time</option>
                <option value="UTC" ${detectedTz === 'UTC' ? 'selected' : ''}>UTC - Coordinated Universal Time</option>
                <option value="GMT" ${detectedTz === 'GMT' ? 'selected' : ''}>GMT - Greenwich Mean Time</option>
                <option value="CET" ${detectedTz === 'CET' ? 'selected' : ''}>CET - Central European Time</option>
                <option value="JST" ${detectedTz === 'JST' ? 'selected' : ''}>JST - Japan Standard Time</option>
                <option value="AEST" ${detectedTz === 'AEST' ? 'selected' : ''}>AEST - Australian Eastern Standard Time</option>
            </select>
        `;
        form.appendChild(timezoneGroup);

        // Language
        const languageGroup = document.createElement('div');
        languageGroup.innerHTML = `
            <label style="display:block;margin-bottom:6px;opacity:0.9;font-size:0.9em;">Language preferences?</label>
            <select id="identity-language" class="rpg-text-input" style="width:100%;">
                <option value="English" ${this.answers.identity.language_preferences === 'English' ? 'selected' : ''}>English</option>
                <option value="Spanish" ${this.answers.identity.language_preferences === 'Spanish' ? 'selected' : ''}>Spanish</option>
                <option value="French" ${this.answers.identity.language_preferences === 'French' ? 'selected' : ''}>French</option>
                <option value="German" ${this.answers.identity.language_preferences === 'German' ? 'selected' : ''}>German</option>
                <option value="Chinese" ${this.answers.identity.language_preferences === 'Chinese' ? 'selected' : ''}>Chinese</option>
                <option value="Japanese" ${this.answers.identity.language_preferences === 'Japanese' ? 'selected' : ''}>Japanese</option>
                <option value="Portuguese" ${this.answers.identity.language_preferences === 'Portuguese' ? 'selected' : ''}>Portuguese</option>
                <option value="Russian" ${this.answers.identity.language_preferences === 'Russian' ? 'selected' : ''}>Russian</option>
                <option value="Hindi" ${this.answers.identity.language_preferences === 'Hindi' ? 'selected' : ''}>Hindi</option>
            </select>
        `;
        form.appendChild(languageGroup);

        this.elements.choices.appendChild(form);

        // Initialize timezone if not set
        if (!this.answers.identity.timezone) {
            this.answers.identity.timezone = detectedTz;
        }

        // Add event listeners
        const locationInput = document.getElementById('identity-location');
        const timezoneSelect = document.getElementById('identity-timezone');
        const languageSelect = document.getElementById('identity-language');

        locationInput.addEventListener('input', (e) => {
            this.answers.identity.location = e.target.value;
            this.updateNavigation();
        });

        timezoneSelect.addEventListener('change', (e) => {
            this.answers.identity.timezone = e.target.value;
            this.updateNavigation();
        });

        languageSelect.addEventListener('change', (e) => {
            this.answers.identity.language_preferences = e.target.value;
            this.updateNavigation();
        });

        // Auto-focus location field
        setTimeout(() => locationInput.focus(), 100);
    },

    updateNavigation() {
        const question = RPG_QUESTIONS[this.currentIndex];

        // Back button
        this.elements.backBtn.disabled = this.currentIndex === 0;

        // Next button validation
        let isValid = false;

        if (question.type === 'text') {
            const value = this.answers[question.id] || '';
            isValid = question.optional || (question.validation ? question.validation(value) : value.trim().length > 0);
        } else if (question.type === 'single') {
            isValid = this.answers[question.id] && this.answers[question.id].length > 0;
        } else if (question.type === 'multi') {
            isValid = this.answers[question.id].length > 0;
        } else if (question.type === 'identity') {
            // Identity fields are all optional
            isValid = true;
        }

        this.elements.nextBtn.disabled = !isValid;

        // Change button text on last question
        if (this.currentIndex === RPG_QUESTIONS.length - 1) {
            this.elements.nextBtn.textContent = 'FINISH ►';
        } else {
            this.elements.nextBtn.textContent = 'NEXT ►';
        }
    },

    goBack() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.render();
        }
    },

    goNext() {
        if (this.currentIndex < RPG_QUESTIONS.length - 1) {
            this.currentIndex++;
            this.render();
        } else {
            // Final question - submit
            this.submit();
        }
    },

    submit() {
        console.log('RPG Questionnaire Answers:', this.answers);

        // Generate personalized system prompt
        const generatedPrompt = this.generateSystemPrompt(this.answers);

        // Store answers and prompt
        sessionStorage.setItem('rpg_answers', JSON.stringify(this.answers));
        sessionStorage.setItem('rpg_system_prompt', generatedPrompt);

        // Show loading screen
        this.showLoading();

        // Simulate processing time
        setTimeout(() => {
            this.hideLoading();
            this.hide();
            this.showReview(generatedPrompt);
        }, 5500);
    },

    generateSystemPrompt(answers) {
        const { identity, domain, style, capabilities, custom } = answers;
        const name = identity.preferred_name || '';

        // Domain mappings with more natural phrasing
        const domainMap = {
            "Software Development / Tech": "working in software development and technology",
            "Creative Work (Writing, Art)": "focused on creative work, including writing and art",
            "Business / Entrepreneurship": "engaged in business and entrepreneurship",
            "Student / Learning": "dedicated to learning and academic growth",
            "Research / Academia": "pursuing research and academic excellence",
            "Just Exploring": "exploring the possibilities of AI"
        };

        // Style mappings with natural flow
        const styleMap = {
            "Professional & Concise": "Maintain a professional, concise tone. Be direct and clear, providing exactly what's needed without unnecessary elaboration.",
            "Casual & Conversational": "Keep things friendly and conversational. Use a relaxed, approachable tone that feels like talking with a knowledgeable friend.",
            "Detailed & Thorough": "Provide comprehensive, well-explained responses. Break down complex ideas into clear steps and ensure thorough understanding of each concept.",
            "Creative & Playful": "Embrace creativity and playfulness in your responses. Make interactions engaging and fun while delivering helpful, accurate information."
        };

        // Build prompt with natural flow
        let prompt = `You are an AI assistant`;

        // Add name and domain in a natural sentence
        if (name && name.trim()) {
            prompt += ` for ${name.trim()}`;
        }

        if (domain && domainMap[domain]) {
            prompt += `, ${domainMap[domain]}`;
        }

        prompt += ".";

        // Add communication style
        if (style && styleMap[style]) {
            prompt += `\n\n${styleMap[style]}`;
        }

        // Add capabilities with natural phrasing
        if (capabilities && capabilities.length > 0) {
            const capsList = capabilities.map(c => c.toLowerCase());

            if (capsList.length === 1) {
                prompt += `\n\nYou specialize in ${capsList[0]}.`;
            } else if (capsList.length === 2) {
                prompt += `\n\nYou excel at ${capsList[0]} and ${capsList[1]}.`;
            } else {
                const lastCap = capsList.pop();
                prompt += `\n\nYou excel at ${capsList.join(", ")}, and ${lastCap}.`;
            }
        }

        // Add custom instructions seamlessly
        if (custom && custom.trim()) {
            prompt += `\n\nAdditional guidance: ${custom.trim()}`;
        }

        return prompt.trim();
    },

    showLoading() {
        const loadingScreen = document.getElementById('rpg-loading');
        if (loadingScreen) {
            loadingScreen.classList.remove('hidden');
        }

        // Start cycling verb animation
        const loadingText = document.querySelector('.rpg-loading-text');
        if (loadingText) {
            const verbs = ["Forging", "Assembling", "Tuning", "Calibrating", "Crafting"];
            let verbIndex = 0;
            loadingText.textContent = `${verbs[verbIndex]} your personalized system prompt...`;

            this.loadingInterval = setInterval(() => {
                verbIndex = (verbIndex + 1) % verbs.length;
                loadingText.textContent = `${verbs[verbIndex]} your personalized system prompt...`;
            }, 750);
        }
    },

    hideLoading() {
        const loadingScreen = document.getElementById('rpg-loading');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
        }

        // Clear interval and restore default text
        if (this.loadingInterval) {
            clearInterval(this.loadingInterval);
            this.loadingInterval = null;
        }

        const loadingText = document.querySelector('.rpg-loading-text');
        if (loadingText) {
            loadingText.textContent = 'Crafting your personalized system prompt...';
        }
    },

    getAnswers() {
        return { ...this.answers };
    },

    getGeneratedPrompt() {
        return sessionStorage.getItem('rpg_system_prompt') || '';
    },

    DEFAULT_PROMPT: "You are a helpful AI assistant. You provide clear, accurate, and thoughtful responses. You adapt your communication style to the user's needs and preferences.",

    showReview(prompt) {
        const reviewScreen = document.getElementById('prompt-review');
        const promptEditor = document.getElementById('prompt-editor');
        const charCount = document.getElementById('prompt-length');

        if (reviewScreen && promptEditor && charCount) {
            // Populate textarea with generated prompt
            promptEditor.value = prompt;

            // Update character count
            charCount.textContent = prompt.length;

            // Show the review screen
            reviewScreen.classList.remove('hidden');

            // Initialize review screen event listeners if not already done
            if (!this.reviewInitialized) {
                this.initReviewScreen();
                this.reviewInitialized = true;
            }

            // Focus textarea
            setTimeout(() => promptEditor.focus(), 100);
        }
    },

    hideReview() {
        const reviewScreen = document.getElementById('prompt-review');
        if (reviewScreen) {
            reviewScreen.classList.add('hidden');
        }
    },

    initReviewScreen() {
        const promptEditor = document.getElementById('prompt-editor');
        const startOverBtn = document.getElementById('btn-start-over');
        const usePromptBtn = document.getElementById('btn-use-prompt');
        const charCount = document.getElementById('prompt-length');

        // Update character count on input
        if (promptEditor) {
            promptEditor.addEventListener('input', () => {
                if (charCount) {
                    charCount.textContent = promptEditor.value.length;
                }
            });
        }

        // Start Over button
        if (startOverBtn) {
            startOverBtn.addEventListener('click', () => {
                const choice = confirm('Start over with the default template?\n\nOK = Use default\nCancel = Go back to questionnaire');

                if (choice) {
                    // Load default template
                    const promptEditor = document.getElementById('prompt-editor');
                    const charCount = document.getElementById('prompt-length');
                    if (promptEditor && charCount) {
                        promptEditor.value = this.DEFAULT_PROMPT;
                        charCount.textContent = this.DEFAULT_PROMPT.length;
                        promptEditor.focus();
                    }
                } else {
                    // Go back to questionnaire
                    this.hideReview();
                    this.show();
                    this.currentIndex = RPG_QUESTIONS.length - 1;
                    this.render();
                }
            });
        }

        // Use This Prompt button
        if (usePromptBtn) {
            usePromptBtn.addEventListener('click', () => {
                const finalPrompt = promptEditor.value.trim();

                if (!finalPrompt) {
                    alert('Please enter a system prompt');
                    return;
                }

                // Save to backend
                this.saveSystemPrompt(finalPrompt);
            });
        }
    },

    saveSystemPrompt(prompt) {
        const saveBtn = document.getElementById('btn-use-prompt');
        const originalText = saveBtn.textContent;
        const answers = this.getAnswers();

        // Show loading state
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVING...';

        // Build save payload - don't persist name yet, only system prompt
        const payload = {
            prompt: prompt,
            name: null
        };

        fetch('/settings/system-prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) throw new Error('Save failed');
            return response.json();
        })
        .then(data => {
            // Determine effective name
            const effectiveName = answers.identity.preferred_name || 'Anonymous';

            // Store in sessionStorage
            sessionStorage.setItem('rpg_system_prompt', prompt);
            sessionStorage.setItem('user_preferred_name', effectiveName);

            // Stage Tier A identity in sessionStorage (not persisted to backend yet)
            sessionStorage.setItem('rpg_tier_a', JSON.stringify(answers.identity));

            // Store name in window for narrator access
            window.userPreferredName = effectiveName;

            // Update tutorial system prompt state
            state.tutorialSystemPromptId = "custom";
            state.tutorialSystemPromptText = prompt;
            updateFRTPromptReadout();

            // Show success
            saveBtn.textContent = '✓ SAVED!';
            setTimeout(() => {
                this.hideReview();
                this.hide();

                // Continue to next stage in tutorial
                // If in first-run tutorial, return to system_prompt track at return pages
                if (document.body.classList.contains('first-run-tutorial')) {
                    FRT.track = "system_prompt";
                    FRT.partIndex = 11;
                    renderPart(11);
                } else {
                    // Show success message if not in tutorial
                    alert('✓ System prompt activated!\n\nYour AI assistant is now personalized.');
                }
            }, 800);
        })
        .catch(error => {
            console.error('Error saving system prompt:', error);
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
            alert('Failed to save system prompt. Please try again.');
        });
    }
};

// Initialize RPG questionnaire when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => RPG.init());
} else {
    RPG.init();
}

const api = {
    getModels: async () => {
        try {
            const res = await fetch('/models');
            const data = await res.json();
            state.availableModels = data.models;
            state.currentModel = data.current || null;   // track loaded model name
            els.modelSelect.innerHTML = '';
            data.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name; opt.textContent = `${m.name} (${m.size_gb} GB)`;
                if(data.current === m.name) opt.selected = true;
                els.modelSelect.appendChild(opt);
            });
            api.updateModelMeta();
            if(data.current) {
                state.modelLoaded = true; els.modelDisplay.textContent = (data.current || '').replace(/\.gguf$/i, '');
                updateStatus(true, "Connected");
                // Enable input now that model is loaded
                if (els.prompt) {
                    els.prompt.disabled = false;
                    els.prompt.placeholder = 'Message Localis...';
                }
                // Update right sidebar model status
                if (els.rsbModelName) els.rsbModelName.textContent = data.current.replace(/\.gguf$/i, '');
                if (els.rsbModelStatus) {
                    els.rsbModelStatus.textContent = '● ONLINE';
                    els.rsbModelStatus.className = 'rsb-model-st online';
                }
            } else {
                state.modelLoaded = false;
                updateStatus(false, "No Model");
                // Disable input while no model loaded
                if (els.prompt) {
                    els.prompt.disabled = true;
                    els.prompt.placeholder = 'Loading model...';
                }
                if (els.rsbModelName) els.rsbModelName.textContent = 'No model loaded';
                if (els.rsbModelStatus) {
                    els.rsbModelStatus.textContent = '● OFFLINE';
                    els.rsbModelStatus.className = 'rsb-model-st offline';
                }
            }
            rsbModel?.renderList?.();  // refresh sidebar model list
        } catch(e) { updateStatus(false, "API Error"); }
    },
    updateModelMeta: () => {
        const selectedName = els.modelSelect.value;
        const model = state.availableModels.find(m => m.name === selectedName);
        const display = els.modelMetaDisplay;
        if (model) {
            display.innerText = `Size: ${model.size_gb} GB`;
            display.style.display = 'block';
        } else {
            display.style.display = 'none';
        }
    },
    getSessions: async () => {
        try {
            const res = await fetch('/sessions');
            const data = await res.json();
            els.sessionList.innerHTML = '';
            if (data.sessions && data.sessions.length > 0) {
                data.sessions.forEach(s => {
                    const div = document.createElement('div');
                    div.className = `sess-item ${s.id === state.sessionId ? 'active' : ''}`;

                    const titleSpan = document.createElement('span');
                    titleSpan.textContent = s.title || s.id;
                    titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;padding-right:20px;';
                    div.appendChild(titleSpan);

                    const delBtn = document.createElement('button');
                    delBtn.className = 'session-delete';
                    delBtn.textContent = '×';
                    delBtn.title = 'Delete session';
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm('Delete this session?')) return;
                        try {
                            await fetch(`/sessions/${s.id}`, { method: 'DELETE' });
                            if (s.id === state.sessionId) {
                                state.sessionId = 'sess_' + Date.now();
                                els.chatHistory.innerHTML = '';
                            }
                            api.getSessions();
                        } catch (err) { console.error('Delete session error:', err); }
                    };
                    div.appendChild(delBtn);

                    div.onclick = () => {
                        state.sessionId = s.id;
                        api.getSessions();
                        api.loadHistory();

                        // Restore thinking preference for this session
                        const thinkMode = getSessionThinkMode(s.id);
                        setSessionThinkMode(s.id, thinkMode);
                    };
                    els.sessionList.appendChild(div);
                });
            } else {
                els.sessionList.innerHTML = '<div style="padding:10px; opacity:0.5; font-size:0.8rem;">No sessions yet</div>';
            }
        } catch(e) { console.error('getSessions error:', e); }
    },
    loadModel: async () => {
        const name = els.modelSelect.value;
        els.btnLoad.disabled = true; els.btnLoad.textContent = "LOADING...";
        try {
            const res = await fetch('/models/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_name: name,
                    n_gpu_layers: parseInt(els.inputs.layers.value),
                                     n_ctx: parseInt(els.inputs.ctx.value)
                })
            });
            if(!res.ok) throw new Error("Load failed");
            const data = await res.json();
            state.modelLoaded = true; els.modelDisplay.textContent = (data.loaded || '').replace(/\.gguf$/i, '');
            state.nCtx = parseInt(els.inputs.ctx.value) || 8192;
            rsbStats.updateContextBar();
            updateStatus(true, "Ready");
            if (els.prompt) { els.prompt.disabled = false; els.prompt.placeholder = 'Message Localis...'; }

            if (document.body.classList.contains('first-run-tutorial')) {
                // Transition to system_prompt track
                document.body.classList.remove('frt-pulse-model');
                toggleSettings(false);
                FRT.track = "system_prompt";
                FRT.partIndex = 1;
                await renderPart(1);
            } else {
                toggleSettings(false);
            }
        } catch(e) { alert(`Error: ${e.message}`); updateStatus(false, "Error"); }
        finally { els.btnLoad.disabled = false; els.btnLoad.textContent = "LOAD MODEL"; }
    },
    unloadModel: async () => {
        const btnUnload = document.getElementById('btn-unload');
        if (!btnUnload) return;

        btnUnload.disabled = true;
        btnUnload.textContent = "UNLOADING...";

        try {
            const res = await fetch('/models/unload', { method: 'POST' });
            if (!res.ok) throw new Error("Unload failed");

            const data = await res.json();
            state.modelLoaded = false;
            els.modelDisplay.textContent = "No Model Loaded";
            updateStatus(false, "Model Unloaded");

            // Show confirmation toast
            showToast("Model unloaded successfully", "success");
        } catch(e) {
            alert(`Error: ${e.message}`);
            updateStatus(false, "Error");
        } finally {
            btnUnload.disabled = false;
            btnUnload.textContent = "UNLOAD MODEL";
        }
    },
    openModelsDir: async () => {
        try {
            const res = await fetch('/setup/open-models-dir', { method: 'POST' });
            if (!res.ok) {
                throw new Error('Failed to open folder');
            }
            // Optionally show success toast
            // showToast('Opened models folder', 'success');
        } catch (e) {
            console.error('Error opening models folder:', e);
            alert(`Could not open models folder: ${e.message}`);
        }
    },
    getAppState: async () => {
        try {
            const res = await fetch('/app/state');
            if (!res.ok) throw new Error("state");
            return await res.json();
        } catch {
            return { tutorial_completed: true, current_model: null, defaults: {} };
        }
    },
    loadSystemPrompt: async () => {
        try {
            const res = await fetch('/settings/default-system-prompt');
            if (!res.ok) throw new Error("Failed to load system prompt");
            const data = await res.json();
            if (els.systemPromptEditor) {
                els.systemPromptEditor.value = data.prompt || "You are a helpful AI assistant.";
            }
        } catch(e) {
            console.error("Error loading system prompt:", e);
            if (els.systemPromptEditor) {
                els.systemPromptEditor.value = "You are a helpful AI assistant.";
            }
        }
    },
    saveSystemPrompt: async () => {
        if (!els.systemPromptEditor || !els.btnSavePrompt || !els.promptStatus) return;

        const prompt = els.systemPromptEditor.value.trim();
        if (!prompt) {
            els.promptStatus.textContent = "Prompt cannot be empty";
            els.promptStatus.style.color = "#ef4444";
            return;
        }

        els.btnSavePrompt.disabled = true;
        els.btnSavePrompt.textContent = "SAVING...";

        try {
            const res = await fetch('/settings/default-system-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            if (!res.ok) throw new Error("Save failed");

            els.promptStatus.textContent = "✓ Saved successfully";
            els.promptStatus.style.color = "var(--accent)";
            showToast("System prompt saved", "success");

            setTimeout(() => { els.promptStatus.textContent = ""; }, 3000);
        } catch(e) {
            els.promptStatus.textContent = "✗ Save failed";
            els.promptStatus.style.color = "#ef4444";
        } finally {
            els.btnSavePrompt.disabled = false;
            els.btnSavePrompt.textContent = "SAVE";
        }
    },
    resetSystemPrompt: () => {
        if (els.systemPromptEditor && els.promptStatus) {
            els.systemPromptEditor.value = "You are a helpful AI assistant.";
            els.promptStatus.textContent = "";
        }
    },
    chat: async (textOverride = null, voiceOpts = null) => {
        const promptText = textOverride || els.prompt.value.trim();
        if(!promptText || state.isGenerating) return;
        // Track last user message for Regenerate chip
        state.lastUserMessage = promptText;
        // Hide welcome state on first message
        els.welcomeState?.classList.add('hidden');
        if (!textOverride) {
            appendMessage('user', promptText);
            els.prompt.value = ''; els.prompt.style.height = 'auto';
            if (els.tokenEstimate) els.tokenEstimate.textContent = '';
        }
        state.isGenerating = true;
        let typeInterval = null;
        let lastStreamStats = null;

        // Detect tutorial chat mode
        const isTutorialChat = document.body.classList.contains('first-run-tutorial') &&
                               document.body.classList.contains('frt-split-with-chat');
        const isAssistMode = !isTutorialChat && (voiceOpts?.assistMode || toolsUI.selectedTools.has('assist_mode'));

        try {
            let res;
            if (isTutorialChat) {
                // Tutorial chat mode - use /tutorial/chat with in-memory history
                state.tutorialHistory.push({ role: 'user', content: promptText });
                rsbStats.updateContextBar();

                // Determine if context is allowed based on tutorial stage
                const allow_context = (FRT.track === "context");

                res = await fetch('/tutorial/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: promptText,
                        session_id: state.sessionId,
                        allow_context: allow_context,
                        history: allow_context ? state.tutorialHistory.slice(0, -1) : [],
                        system_prompt: state.tutorialSystemPromptText,
                        temperature: parseFloat(els.inputs.temp.value),
                        max_tokens: 512,
                        top_p: 0.9,
                        web_search_mode: 'off'
                    })
                });
            } else {
                // Normal chat mode - use /chat with session
                const selectedTools = toolsUI.getSelectedTools().filter(t => t.type !== 'assist_mode');
                res = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: promptText,
                        max_tokens: 512,
                        temperature: parseFloat(els.inputs.temp.value),
                        session_id: state.sessionId,
                        web_search_mode: isAssistMode ? 'off' : state.webSearchMode,
                        tool_actions: selectedTools.length > 0 ? selectedTools : null,
                        think_mode: getSessionThinkMode(state.sessionId),
                        assist_mode: isAssistMode,
                        input_mode: voiceOpts ? 'voice' : 'text'
                    })
                });

                // Clear one-shot tools after send
                toolsUI.clearOneShot();
            }

            if (!res.body) throw new Error("No stream");
            let assistantMsgContent = "";
            let msgDiv = null;
            let assistantMsgEl = null;
            let scrollPending = false;

            // Throttled scroll using requestAnimationFrame
            const scrollToBottom = () => {
                if (scrollPending) return;
                scrollPending = true;
                requestAnimationFrame(() => {
                    // Scroll the viewport (#chat-zone), not the inner container (#chat-history)
                    const vp = els.chatZone || document.getElementById('chat-zone');
                    if (vp) {
                        const isNearBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 120;
                        if (isNearBottom) vp.scrollTop = vp.scrollHeight;
                    }
                    scrollPending = false;
                });
            };

            // Plain text update during streaming (no markdown parsing)
            let rafScheduled = false;
            const updatePlainText = () => {
                if(!msgDiv) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = buildMessageHTML('assistant', '');
                    assistantMsgEl = wrapper.firstElementChild;
                    els.chatHistory.appendChild(assistantMsgEl);
                    msgDiv = assistantMsgEl.querySelector('.msg-text');
                }
                // Update as plain text (no markdown parsing during stream)
                msgDiv.textContent = assistantMsgContent;
                scrollToBottom();
                rafScheduled = false;
            };

            // Throttled update using requestAnimationFrame (~60fps)
            const scheduleUpdate = () => {
                if (!rafScheduled) {
                    rafScheduled = true;
                    requestAnimationFrame(updatePlainText);
                }
            };

            await readSSE(res, (payload) => {
                if (payload.content) {
                    assistantMsgContent += payload.content;
                    // Throttle updates to avoid excessive DOM reflows
                    scheduleUpdate();

                    // Detect tool results and show notifications
                    const content = payload.content;

                    // RAG errors
                    if (content.includes('[ERROR]') && (content.includes('RAG') || content.includes('rag_retrieve'))) {
                        if (content.includes('unavailable') || content.includes('not ready')) {
                            showToast('RAG is not available. Check your files.', 'error');
                        }
                    }

                    // Memory write success
                    if (content.includes('[TOOL RESULT: memory_write]') && content.includes('Successfully saved')) {
                        // Extract key from message if possible
                        const keyMatch = content.match(/Tier [AB]\): (\w+)/);
                        const key = keyMatch ? keyMatch[1] : 'information';
                        showToast(`Saved to memory: ${key}`, 'success');
                        // Insert memory action card into chat
                        const chatHistory = document.getElementById('chat-history');
                        if (chatHistory) {
                            chatHistory.insertAdjacentHTML('beforeend',
                                buildActionCardHTML('memory', 'Memory saved', `Saved: ${key}`)
                            );
                        }
                    }
                }
                // Capture stats event
                if (payload.event_type === 'stats') {
                    lastStreamStats = payload.stats;  // May be null on error — that's fine
                }
            });

            // Count assistant message chars for context bar (normal chat only;
            // tutorial mode tracks its own history and calls updateContextBar directly)
            if (!isTutorialChat) {
                rsbStats.addChars(assistantMsgContent.length);
            }

            // Final markdown render with syntax highlighting (after stream completes).
            // Step 1: extract and render thinking blocks as collapsible pills first.
            // Step 2: markdown-parse the remaining content.
            const parsed = parseThinking(assistantMsgContent);
            const renderTarget = msgDiv || assistantMsgEl?.querySelector('.msg-text') || assistantMsgEl;

            if (parsed.hasThinking) {
                // Render thinking pills (collapsible) + remaining text as markdown
                const thinkingHtml = renderThinkingPills(assistantMsgContent
                    .replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (m) => m)); // pass through
                // Build: pills for all thinking blocks + markdown for the rest
                const pillsHtml = renderThinkingPills(
                    parsed.blocks.map(b => `<thinking>${b.content}</thinking>`).join('')
                );
                const mainHtml = marked.parse(parsed.textWithoutThinking);
                if (renderTarget) renderTarget.innerHTML = pillsHtml + mainHtml;
            } else {
                // No thinking - render markdown once with syntax highlighting
                if (renderTarget) {
                    renderTarget.innerHTML = marked.parse(assistantMsgContent);
                }
            }
            if (assistantMsgEl) {
                assistantMsgEl.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
            }

            // Add Copy / Regenerate / Continue action chips below the completed message
            if (assistantMsgEl && !isTutorialChat) {
                addMessageActionChips(assistantMsgEl, assistantMsgContent);
            }

            // Render stats below the assistant message
            if (lastStreamStats && msgDiv) {
                const statsDiv = document.createElement('div');
                statsDiv.className = 'msg-stats';
                const tps = lastStreamStats.tokens_per_second?.toFixed(1) || '—';
                const tokens = lastStreamStats.tokens_generated || '—';
                const timeMs = lastStreamStats.generation_time_ms;
                const timeSec = timeMs ? (timeMs / 1000).toFixed(1) + 's' : '—';
                statsDiv.innerHTML = `
                    <span>${tps} tok/s</span>
                    <span>·</span>
                    <span>${tokens} tokens</span>
                    <span>·</span>
                    <span>${timeSec}</span>
                `;
                // msgDiv is .msg-text; go up to .msg-body to append stats below prose
                const messageParent = msgDiv?.parentElement || assistantMsgEl?.querySelector('.msg-body');
                if (messageParent) messageParent.appendChild(statsDiv);
            }
            // If lastStreamStats is null (error/unavailable), just don't render anything — clean degradation

            // Voice status: signal done for Home Control commands
            if (isAssistMode) {
                voiceStatusBar.setDone();
                // Insert home action card to surface the HA result in chat
                const chatHistory = document.getElementById('chat-history');
                if (chatHistory) {
                    chatHistory.insertAdjacentHTML('beforeend',
                        buildActionCardHTML('home', 'Light controlled', 'Home Assistant action')
                    );
                }
            }

            state.isGenerating = false;

            // Voice: trigger TTS on stream completion if a voice request is pending
            if (voiceUI.pendingChatText !== null) {
                voiceUI._onStreamComplete(assistantMsgContent);
            }

            // Add assistant response to tutorial history if in tutorial mode
            if (isTutorialChat) {
                state.tutorialHistory.push({ role: 'assistant', content: assistantMsgContent });
                rsbStats.updateContextBar();

                // Check if this satisfies a required action
                if (FRT.requiredAction.kind && !FRT.requiredAction.satisfied) {
                    const userMsg = promptText.trim().toLowerCase();

                    if (FRT.requiredAction.kind === "chat_any") {
                        FRT.requiredAction.satisfied = true;
                        FRT.requiredAction.baselineQuestion = promptText.trim();
                        document.getElementById('frt-nav').classList.remove('frt-nav-locked');
                    } else if (FRT.requiredAction.kind === "chat_repeat") {
                        const baseline = (FRT.requiredAction.baselineQuestion || "").trim().toLowerCase();
                        if (userMsg === baseline) {
                            FRT.requiredAction.satisfied = true;
                            document.getElementById('frt-nav').classList.remove('frt-nav-locked');
                        } else {
                            FRT.requiredAction.attempts++;
                            console.log(`[GATE] chat_repeat mismatch (attempt ${FRT.requiredAction.attempts}): expected="${baseline}", got="${userMsg}"`);
                            if (FRT.requiredAction.attempts >= FRT.requiredAction.soft_after) {
                                FRT.requiredAction.satisfied = true;
                                document.getElementById('frt-nav').classList.remove('frt-nav-locked');
                                showOptional("Close enough. You're the type to improvise.", true, "gate-soft-pass");
                            }
                        }
                    }
                }
            } else {
                // Only update sessions in normal chat mode
                api.getSessions();
            }
        } catch(e) {
            if (typeInterval) clearInterval(typeInterval);
            appendMessage('assistant', `Error: ${e.message}`);
            state.isGenerating = false;
        }
    },
    loadHistory: async () => {
        try {
            const res = await fetch(`/history/${state.sessionId}`);
            const msgs = await res.json();
            els.chatHistory.innerHTML = '';
            if (msgs.length === 0) {
                // Restore welcome state for empty session
                els.welcomeState?.classList.remove('hidden');
            } else {
                els.welcomeState?.classList.add('hidden');
                const grouped = groupMessagesByDate(msgs);
                grouped.forEach(item => {
                    if (item.type === 'separator') {
                        const sep = document.createElement('div');
                        sep.className = 'date-separator';
                        sep.textContent = item.label;
                        els.chatHistory.appendChild(sep);
                    } else {
                        appendMessage(item.role, item.content);
                    }
                });
            }
        } catch(e) {}
    },
    swapPrompt: async (sessionId, promptText) => {
        try {
            const res = await fetch('/tutorial/swap-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    prompt_text: promptText
                })
            });

            if (!res.ok) throw new Error("Swap failed");

            // Trigger visual feedback
            triggerPromptSwapFeedback();

            return await res.json();
        } catch(e) {
            console.error('Prompt swap error:', e);
            throw e;
        }
    }
};

if(els.modelSelect) els.modelSelect.addEventListener('change', api.updateModelMeta);
if(els.btnLoad) els.btnLoad.addEventListener('click', api.loadModel);
if(els.btnUnload) els.btnUnload.addEventListener('click', api.unloadModel);
if(els.btnOpenModelsDir) els.btnOpenModelsDir.addEventListener('click', api.openModelsDir);
if(els.sendBtn) els.sendBtn.addEventListener('click', () => api.chat());
if(els.btnNewChat) els.btnNewChat.addEventListener('click', () => {
    state.sessionId = 'sess_' + Date.now();
    api.getSessions();
    els.chatHistory.innerHTML = '';

    // Initialize thinking as off for new session
    setSessionThinkMode(state.sessionId, false);
});
if(els.prompt) els.prompt.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); api.chat(); } });

// Think Toggle
const thinkToggle = document.getElementById('think-toggle');
if (thinkToggle) {
    thinkToggle.addEventListener('click', () => {
        const currentMode = getSessionThinkMode(state.sessionId);
        setSessionThinkMode(state.sessionId, !currentMode);
    });
}

// System Prompt Editor
if(els.btnSavePrompt) els.btnSavePrompt.addEventListener('click', api.saveSystemPrompt);
if(els.btnResetPrompt) els.btnResetPrompt.addEventListener('click', api.resetSystemPrompt);

// Stop Server & Export Logs
if (els.btnStopServer) {
    els.btnStopServer.addEventListener('click', async () => {
        if (!confirm('Stop the server and export logs? You will need to restart manually.')) return;
        els.btnStopServer.disabled = true;
        els.btnStopServer.textContent = 'Stopping\u2026';
        try {
            const res = await fetch('/server/stop', { method: 'POST' });
            const data = await res.json();
            els.stopServerStatus.style.display = '';
            if (data.exported) {
                els.stopServerStatus.textContent = `Log saved: ${data.filename}`;
            } else {
                els.stopServerStatus.textContent = 'Server stopped (no log file found).';
            }
        } catch {
            // Fetch will throw when the server closes — that's expected
            els.stopServerStatus.style.display = '';
            els.stopServerStatus.textContent = 'Server stopped.';
        }
    });
}

// === SYSTEM PROMPT MODAL ===
function openSystemPromptModal() {
    const modal = document.getElementById('system-prompt-modal');
    const editor = document.getElementById('system-prompt-modal-editor');
    const lengthDisplay = document.getElementById('modal-prompt-length');
    // Load current prompt value from the hidden editor
    const currentPrompt = els.systemPromptEditor ? els.systemPromptEditor.value : '';
    editor.value = currentPrompt;
    lengthDisplay.textContent = currentPrompt.length;
    modal.classList.remove('hidden');
    editor.focus();
    populateModalProfileTags();
}

function closeSystemPromptModal() {
    document.getElementById('system-prompt-modal').classList.add('hidden');
}

// Shared active profile state — syncs sidebar preset chips ↔ modal profile tags
let _activeProfileLabel = null;

function setActiveProfile(label, promptText) {
  _activeProfileLabel = label;

  // Update modal tags
  document.querySelectorAll('#modal-profile-tags .modal-profile-tag').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === label);
  });

  // Deactivate all sidebar preset chips when a profile tag is chosen
  document.querySelectorAll('#rsb-prompt-presets .rsb-pchip').forEach(c => c.classList.remove('active'));

  // Apply prompt text
  if (promptText !== undefined) {
    if (els.modalSystemPrompt)  els.modalSystemPrompt.value = promptText;
    if (els.systemPromptEditor) els.systemPromptEditor.value = promptText;
    api.saveSystemPrompt?.();
  }
}

function populateModalProfileTags() {
  if (!els.modalProfileTags) return;

  const PROFILES = {
    '🏠 Home Control': 'You are Localis, a smart home AI assistant. Prioritise interpreting commands as home control actions. Confirm device actions clearly.',
    'हि Hinglish': 'You are Localis. Respond naturally in the same language the user writes in — mix Hindi and English freely (Hinglish). Be conversational and warm.',
    '🌙 Night Owl': 'You are Localis. Keep responses brief and low-key. The user is likely relaxing or winding down — match that energy.',
    '⚡ Tech Mode': 'You are Localis, a technical AI assistant. Prioritise accuracy, include relevant details, use correct terminology. Assume the user is technically capable.',
    '💻 Coding': 'You are Localis, a coding assistant. Provide working code with concise explanations. Prefer minimal, idiomatic solutions.',
  };

  const tags = Object.keys(PROFILES);

  els.modalProfileTags.innerHTML = '';
  tags.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'modal-profile-tag';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      setActiveProfile(label, PROFILES[label]);
      if (els.modalSystemPrompt) els.modalSystemPrompt.dispatchEvent(new Event('input'));
    });
    els.modalProfileTags.appendChild(btn);
  });
}

// Open modal button
const btnOpenPromptModal = document.getElementById('btn-open-prompt-modal');
if (btnOpenPromptModal) btnOpenPromptModal.addEventListener('click', openSystemPromptModal);

// Wire sidebar "Edit System Prompt" button to existing modal open function
if (els.btnEditPromptSidebar) {
  els.btnEditPromptSidebar.addEventListener('click', openSystemPromptModal);
}

// Close: × button
const btnClosePromptModal = document.getElementById('btn-close-prompt-modal');
if (btnClosePromptModal) btnClosePromptModal.addEventListener('click', closeSystemPromptModal);

// Close: click backdrop (not dialog)
const systemPromptModal = document.getElementById('system-prompt-modal');
if (systemPromptModal) {
    systemPromptModal.addEventListener('click', (e) => {
        if (e.target === systemPromptModal) closeSystemPromptModal();
    });
}

// Close: Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && systemPromptModal && !systemPromptModal.classList.contains('hidden')) {
        closeSystemPromptModal();
    }
});

// Char count update
const modalEditor = document.getElementById('system-prompt-modal-editor');
if (modalEditor) {
    modalEditor.addEventListener('input', () => {
        document.getElementById('modal-prompt-length').textContent = modalEditor.value.length;
    });
}

// Profile chips: click to fill prompt
document.querySelectorAll('.prompt-profile-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        const editor = document.getElementById('system-prompt-modal-editor');
        if (editor && prompt) {
            editor.value = prompt;
            document.getElementById('modal-prompt-length').textContent = prompt.length;
            // Highlight active chip
            document.querySelectorAll('.prompt-profile-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        }
    });
});

// Save button
const btnModalSave = document.getElementById('btn-modal-save-prompt');
if (btnModalSave) {
    btnModalSave.addEventListener('click', async () => {
        const editor = document.getElementById('system-prompt-modal-editor');
        const prompt = editor.value;
        // Sync to the hidden system prompt editor so existing code works
        if (els.systemPromptEditor) els.systemPromptEditor.value = prompt;
        // Save via existing API
        await api.saveSystemPrompt();
        closeSystemPromptModal();
        showToast('System prompt saved', 'success');
    });
}

// Reset button
const btnModalReset = document.getElementById('btn-modal-reset-prompt');
if (btnModalReset) {
    btnModalReset.addEventListener('click', async () => {
        await api.resetSystemPrompt();
        // Re-read the value from the hidden editor after reset
        const editor = document.getElementById('system-prompt-modal-editor');
        if (editor && els.systemPromptEditor) {
            editor.value = els.systemPromptEditor.value;
            document.getElementById('modal-prompt-length').textContent = editor.value.length;
        }
        document.querySelectorAll('.prompt-profile-chip').forEach(c => c.classList.remove('active'));
    });
}

// --- MEMORY MATRIX ---
const loadAndRenderMemoryMatrix = async () => {
    // Guard: check if container exists
    if (!els.memMatrixContainer) return;

    // Guard: check if child elements exist
    if (!els.memTierA || !els.memTierB) {
        els.memMatrixContainer.innerHTML = '<div style="padding:20px;opacity:0.6;text-align:center;">Memory panel elements not found.</div>';
        return;
    }

    // Show loading state
    els.memTierA.innerHTML = '<div style="padding:10px;opacity:0.5;">Loading...</div>';
    els.memTierB.innerHTML = '<div style="padding:10px;opacity:0.5;">Loading...</div>';

    try {
        const res = await fetch('/memory');
        if (!res.ok) throw new Error('Failed to fetch memory');
        const data = await res.json();

        const tierA = data.tier_a || {};
        const tierB = data.tier_b || {};

        // Render Tier A (identity)
        const tierALabels = {
            preferred_name: 'Name',
            location: 'Location',
            timezone: 'Timezone',
            language_preferences: 'Language'
        };
        const tierAOrder = ['preferred_name', 'location', 'timezone', 'language_preferences'];

        let tierAHtml = '';
        for (const key of tierAOrder) {
            const label = tierALabels[key];
            const value = tierA[key] || '—';
            tierAHtml += `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><span style="opacity:0.7;">${label}:</span> <span style="font-weight:500;">${escapeHtml(String(value))}</span></div>`;
        }
        els.memTierA.innerHTML = tierAHtml || '<div style="padding:10px;opacity:0.5;">No identity data</div>';

        // Render Tier B (extended memory as tags)
        let tierBHtml = '';
        for (const [key, val] of Object.entries(tierB)) {
            if (!val) continue;
            const items = Array.isArray(val) ? val : [val];
            tierBHtml += `<div style="margin-bottom:12px;"><div style="font-size:0.85em;opacity:0.7;margin-bottom:4px;text-transform:capitalize;">${escapeHtml(key.replace(/_/g, ' '))}</div><div style="display:flex;flex-wrap:wrap;gap:6px;">`;
            for (const item of items) {
                tierBHtml += `<span style="display:inline-block;background:rgba(100,100,100,0.3);padding:4px 10px;border-radius:12px;font-size:0.85em;">${escapeHtml(String(item))}</span>`;
            }
            tierBHtml += '</div></div>';
        }
        els.memTierB.innerHTML = tierBHtml || '<div style="padding:10px;opacity:0.5;">No extended memory</div>';

    } catch (e) {
        console.error('[Memory] Load failed:', e);
        els.memTierA.innerHTML = '<div style="padding:10px;color:#ff6b6b;opacity:0.8;">Failed to load memory</div>';
        els.memTierB.innerHTML = '<div style="padding:10px;opacity:0.5;">—</div>';
    }
};

// Hook refresh button
const btnRefreshMemory = document.getElementById('btn-refresh-memory');
if (btnRefreshMemory) {
    btnRefreshMemory.addEventListener('click', loadAndRenderMemoryMatrix);
}

// Hook final review confirmation button
const btnFinalReviewConfirm = document.getElementById('btn-final-review-confirm');
if (btnFinalReviewConfirm) {
    btnFinalReviewConfirm.addEventListener('click', async () => {
        // Disable button and show loading state
        btnFinalReviewConfirm.disabled = true;
        const originalText = btnFinalReviewConfirm.textContent;
        btnFinalReviewConfirm.textContent = 'SAVING...';

        try {
            // Get staged data
            const systemPrompt = state.tutorialSystemPromptText || sessionStorage.getItem('rpg_system_prompt') || '';
            const tierAJson = sessionStorage.getItem('rpg_tier_a');
            const tierA = tierAJson ? JSON.parse(tierAJson) : {};
            const tierBJson = sessionStorage.getItem('tutorial_tier_b');
            const tierB = tierBJson ? JSON.parse(tierBJson) : {};
            const defaults = JSON.parse(sessionStorage.getItem('tutorial_defaults') || '{}');

            // Clean Tier A: trim values, remove empty keys
            const cleanedTierA = {};
            for (const [k, v] of Object.entries(tierA)) {
                const trimmed = typeof v === 'string' ? v.trim() : v;
                if (trimmed !== '' && trimmed != null) {
                    cleanedTierA[k] = trimmed;
                }
            }

            // Transform Tier B: object -> array of {key, value}, deduplicate keys
            const tierBMap = new Map();
            for (const [k, v] of Object.entries(tierB)) {
                const trimmedKey = typeof k === 'string' ? k.trim() : k;
                const trimmedValue = typeof v === 'string' ? v.trim() : v;
                if (trimmedKey && trimmedValue !== '' && trimmedValue != null) {
                    tierBMap.set(trimmedKey, trimmedValue);
                }
            }
            const tierBList = Array.from(tierBMap.entries()).map(([key, value]) => ({ key, value }));

            // Commit to backend
            const res = await fetch('/tutorial/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_prompt: systemPrompt,
                    tier_a: cleanedTierA,
                    tier_b: tierBList,
                    defaults: defaults,
                    tutorial_completed: true
                })
            });

            if (!res.ok) {
                // Log detailed error response
                const errorBody = await res.text();
                console.error('[Tutorial] Commit failed with status:', res.status, res.statusText);
                console.error('[Tutorial] Response body:', errorBody);
                throw new Error(`Commit failed: ${res.status} ${res.statusText}`);
            }

            // Mark required action as satisfied
            FRT.requiredAction.satisfied = true;
            FRT.requiredAction.kind = null;
            document.getElementById('frt-nav').classList.remove('frt-nav-locked');

            // Close overlay
            const overlay = document.getElementById('final-review-overlay');
            if (overlay) overlay.classList.add('hidden');

            // Success feedback
            btnFinalReviewConfirm.textContent = '✓ SAVED!';

            // End tutorial after short delay
            setTimeout(() => {
                endTutorial();
            }, 800);

        } catch (e) {
            console.error('[Tutorial] Commit failed:', e);
            // Re-enable button and show error
            btnFinalReviewConfirm.disabled = false;
            btnFinalReviewConfirm.textContent = originalText;

            // Show inline error
            const errorDiv = document.getElementById('final-review-error');
            if (errorDiv) {
                errorDiv.textContent = 'Failed to save. Please try again.';
                errorDiv.style.display = 'block';
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 3000);
            } else {
                alert('Failed to save. Please try again.');
            }
        }
    });
}

// --- TUTORIAL INTERACTION ---
FRT.els.btnNext.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();

    // Clear auto-advance timer and listeners on manual navigation
    if (FRT.autoAdvanceTimer) {
        clearTimeout(FRT.autoAdvanceTimer);
        FRT.autoAdvanceTimer = null;
    }
    removeAutoAdvanceListeners();

    if (FRT.stage === "boot") {
        document.body.classList.remove('frt-boot');
        FRT.stage = "script";
        renderPart(1);
        return;
    }

    // Handle typing skip/force render
    if (FRT.isTyping) {
        const part = (FRT.stage === "script") ? getTrack()[FRT.partIndex] : null;
        if (part && part.earlyClickLine) {
            showOptional(part.earlyClickLine, true, "early");
        }
        FRT.skipRequested = true;
        return;
    }

    // Check for unsatisfied required action gate
    if (FRT.requiredAction.kind && !FRT.requiredAction.satisfied) {
        // Special message for final review
        if (FRT.requiredAction.kind === "final_review_confirm") {
            showOptional("Review the details below.\nThen click LOOKS GOOD →", true, "gate-final-review");
            return;
        }

        const antiSkipLines = ["Not yet.", "You can't speedrun character development.", "Do the thing."];
        const lineIndex = Math.min(FRT.requiredAction.attempts, antiSkipLines.length - 1);
        showOptional(antiSkipLines[lineIndex], true, "gate-block");
        FRT.requiredAction.attempts++;

        // For chat_repeat gate, show specific reminder on first 2 attempts
        if (FRT.requiredAction.kind === "chat_repeat" && FRT.requiredAction.attempts <= 2) {
            setTimeout(() => {
                showOptional("Same question. Word for word.", true, "gate-repeat-reminder");
            }, 1000);
        }
        return;
    }

    // Page 3B (Part 4) is the dead end for navigation; click the icon instead.
    if (FRT.track === "model" && FRT.partIndex === 4) {
        return;
    }

    if (FRT.partIndex < getMaxPart()) {
        renderPart(FRT.partIndex + 1);
    } else {
        if (FRT.track === "intro") {
            FRT.track = "model";
            FRT.partIndex = 0;
            document.body.classList.add('frt-split');
            document.body.classList.add('frt-wide-panel');
            renderPart(1);
            return;
        }

        if (FRT.track === "system_prompt") {
            // Transition to context stage
            FRT.track = "context";
            FRT.partIndex = 0;
            renderPart(1);
            return;
        }

        if (FRT.track === "context") {
            // Transition to memory stage
            FRT.track = "memory";
            FRT.partIndex = 0;
            renderPart(1);
            return;
        }

        if (FRT.track === "memory") {
            // Memory stage complete, end tutorial
            endTutorial();
            return;
        }

        // Fallback safety
        if (FRT.track === "model") {
            document.body.classList.add('frt-allow-right-rail', 'frt-pulse-model');
            showOptional("The loader is blinking on the right.\nClick it.", true, "end-model");
            UX.pulse('#btn-rail-model', 2200);
        }
    }
});

FRT.els.btnBack.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();

    // Clear auto-advance timer and listeners on manual navigation
    if (FRT.autoAdvanceTimer) {
        clearTimeout(FRT.autoAdvanceTimer);
        FRT.autoAdvanceTimer = null;
    }
    removeAutoAdvanceListeners();

    if (FRT.isTyping) { FRT.skipRequested = true; return; }
    if (FRT.partIndex > 1) {
        renderPart(FRT.partIndex - 1);
    }
});

document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('first-run-tutorial')) return;
    if (FRT.stage === "none") return;

    // Allow typing in chat input during split-with-chat mode
    if (document.body.classList.contains('frt-split-with-chat') && e.target.closest('.input-wrapper')) return;

    // Space speeds up typing without showing warnings
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (FRT.isTyping) {
            FRT.fastForward = true;
        }
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const part = (FRT.stage === "boot") ? { typingAttemptLine: "System is locked. Follow the guide." } : getTrack()[FRT.partIndex];
        if (part && part.typingAttemptLine) showOptional(part.typingAttemptLine, false, "typing");
    }
});

document.addEventListener('keyup', (e) => {
    if (!document.body.classList.contains('first-run-tutorial')) return;
    // Prevent scroll side-effects from Space and restore normal speed
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        FRT.fastForward = false;
    }
});

document.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('first-run-tutorial')) return;
    if (FRT.stage === "none") return;

    // Allow clicks in chat area during split-with-chat mode
    if (document.body.classList.contains('frt-split-with-chat') && e.target.closest('.chat-area')) return;

    if (!e.target.closest('#frt-nav') && !e.target.closest('#frt-back') && !e.target.closest('#frt-advance')) {
        const part = (FRT.stage === "boot") ? { clickAttemptLine: "Buttons are locked for now." } : getTrack()[FRT.partIndex];
        if (part && part.clickAttemptLine) showOptional(part.clickAttemptLine, false, "click");
    }
});

if(document.getElementById('btn-reset-tutorial')) {
    document.getElementById('btn-reset-tutorial').onclick = () => { localStorage.removeItem('localmind_first_run_complete'); window.location.reload(); };
}

// ============================================================
// voiceUI — PTT voice module (Phase 1)
// ============================================================
const voiceUI = (() => {
    // State machine: idle | listening | transcribing | confirming | waiting | speaking
    let _state = 'idle';
    let _audioCtx = null;
    let _mediaStream = null;
    let _workletNode = null;
    let _audioChunks = [];   // Float32Array frames (WebAudio path)
    let _mediaRecorder = null; // fallback path
    let _mediaChunks = [];   // Blob chunks (fallback)
    let _cancelTimer = null;
    let _cancelInterval = null;
    let _pendingChatText = null;
    let _onDoneCallback = null;
    let _useWorklet = (typeof AudioWorkletNode !== 'undefined');

    const _stateChangeCallbacks = [];
    function onStateChange(cb) { _stateChangeCallbacks.push(cb); }

    const CANCEL_DELAY_MS = 1500;

    // HA mode persisted in localStorage
    function _getHaMode() {
        return localStorage.getItem('voice_mode') === 'ha';
    }
    function _setHaMode(isHa) {
        localStorage.setItem('voice_mode', isHa ? 'ha' : 'chat');
        // Update toggle pill UI
        els.voiceModeToggle?.querySelectorAll('.voice-mode-opt').forEach(btn => {
            const active = btn.dataset.mode === (isHa ? 'ha' : 'chat');
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
    }

    function _setState(s) {
        _stateChangeCallbacks.forEach(cb => cb(s));
        _state = s;
        if (!els.voiceMicBtn) return;
        els.voiceMicBtn.classList.remove('listening', 'transcribing', 'speaking');
        if (s === 'listening') els.voiceMicBtn.classList.add('listening');
        else if (s === 'transcribing') els.voiceMicBtn.classList.add('transcribing');
        else if (s === 'speaking') els.voiceMicBtn.classList.add('speaking');
    }

    // ---- WAV encoder ----
    function _encodeWAV(chunks, sampleRate) {
        // Flatten Float32 chunks into one buffer
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const pcm = new Float32Array(totalLen);
        let offset = 0;
        for (const c of chunks) { pcm.set(c, offset); offset += c.length; }

        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
            const s = Math.max(-1, Math.min(1, pcm[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const dataBytes = int16.buffer.byteLength;
        const buf = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(buf);
        const ch = 1, bps = 16;
        const byteRate = sampleRate * ch * bps / 8;
        const blockAlign = ch * bps / 8;

        // RIFF header
        _writeStr(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataBytes, true);
        _writeStr(view, 8, 'WAVE');
        _writeStr(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);        // PCM
        view.setUint16(22, ch, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bps, true);
        _writeStr(view, 36, 'data');
        view.setUint32(40, dataBytes, true);
        new Uint8Array(buf, 44).set(new Uint8Array(int16.buffer));
        return buf;
    }
    function _writeStr(view, offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    // ---- Recording ----
    async function _startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Microphone requires a secure context (localhost or HTTPS).', 'error');
            return false;
        }
        try {
            _mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (err) {
            const msg = err.name === 'NotAllowedError'
                ? 'Microphone permission denied. Check browser settings.'
                : `Mic error: ${err.message}`;
            showToast(msg, 'error');
            return false;
        }

        _audioChunks = [];
        _mediaChunks = [];

        if (_useWorklet) {
            try {
                _audioCtx = new AudioContext({ sampleRate: 16000 });
                const source = _audioCtx.createMediaStreamSource(_mediaStream);
                await _audioCtx.audioWorklet.addModule('/static/js/pcm-recorder-worklet.js');
                _workletNode = new AudioWorkletNode(_audioCtx, 'pcm-recorder');
                _workletNode.port.onmessage = (e) => _audioChunks.push(e.data);
                source.connect(_workletNode);
                Logger.debug('Voice', 'AudioWorklet recording started at 16kHz');
                return true;
            } catch (e) {
                Logger.debug('Voice', `AudioWorklet failed, falling back to MediaRecorder: ${e}`);
                _useWorklet = false;
                if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
            }
        }

        // MediaRecorder fallback (sends webm — requires ffmpeg on server)
        try {
            _mediaRecorder = new MediaRecorder(_mediaStream);
            _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _mediaChunks.push(e.data); };
            _mediaRecorder.start(100);
            Logger.debug('Voice', 'MediaRecorder fallback started');
            return true;
        } catch (e) {
            showToast(`Recording failed: ${e.message}`, 'error');
            return false;
        }
    }

    async function _stopRecordingAndTranscribe() {
        _setState('transcribing');

        let blob, contentType;

        if (_workletNode) {
            // Stop worklet
            _workletNode.port.postMessage('stop');
            _workletNode.disconnect();
            _workletNode = null;
            if (_audioCtx) { await _audioCtx.close(); _audioCtx = null; }
            // Encode accumulated chunks to WAV
            const wavBuf = _encodeWAV(_audioChunks, 16000);
            blob = new Blob([wavBuf], { type: 'audio/wav' });
            contentType = 'audio/wav';
        } else if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            // Stop MediaRecorder and wait for final data
            await new Promise(res => {
                _mediaRecorder.onstop = res;
                _mediaRecorder.stop();
            });
            blob = new Blob(_mediaChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
            contentType = blob.type;
            _mediaRecorder = null;
        } else {
            _setState('idle');
            return;
        }

        // Stop tracks
        if (_mediaStream) { _mediaStream.getTracks().forEach(t => t.stop()); _mediaStream = null; }

        if (blob.size < 100) {
            showToast('No audio captured', 'error');
            _setState('idle');
            return;
        }

        // POST to /voice/transcribe
        const t0 = performance.now();
        const fd = new FormData();
        fd.append('audio', blob, 'audio.' + (contentType.includes('wav') ? 'wav' : 'webm'));
        try {
            const resp = await fetch('/voice/transcribe', { method: 'POST', body: fd });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                showToast(`STT error: ${err.detail || resp.statusText}`, 'error');
                _setState('idle');
                return;
            }
            const data = await resp.json();
            const sttMs = resp.headers.get('X-Voice-STT-Ms') || Math.round(performance.now() - t0);
            Logger.debug('Voice', `STT: ${sttMs}ms → "${data.text}"`);
            _onTranscript(data.text || '');
        } catch (e) {
            showToast(`STT request failed: ${e.message}`, 'error');
            _setState('idle');
        }
    }

    // ---- Cancel affordance ----
    function _showCancelBar(delayMs, onSubmit) {
        if (!els.voiceCancelBar) { onSubmit(); return; }
        els.voiceCancelBar.removeAttribute('hidden');

        const progress = els.voiceCancelBar.querySelector('.voice-cancel-progress');
        const countdown = els.voiceCancelCountdown;
        const startTime = performance.now();

        // Animate progress bar shrinking from right
        if (progress) {
            progress.style.transition = 'none';
            progress.style.transform = 'scaleX(1)';
            requestAnimationFrame(() => {
                progress.style.transition = `transform ${delayMs}ms linear`;
                progress.style.transform = 'scaleX(0)';
            });
        }

        // Countdown seconds
        if (countdown) {
            countdown.textContent = Math.ceil(delayMs / 1000);
            _cancelInterval = setInterval(() => {
                const remaining = delayMs - (performance.now() - startTime);
                countdown.textContent = Math.max(1, Math.ceil(remaining / 1000));
            }, 200);
        }

        _cancelTimer = setTimeout(() => {
            _clearCancelBar();
            onSubmit();
        }, delayMs);
    }

    function _clearCancelBar() {
        clearTimeout(_cancelTimer);
        clearInterval(_cancelInterval);
        _cancelTimer = null;
        _cancelInterval = null;
        els.voiceCancelBar?.setAttribute('hidden', '');
        if (_state === 'confirming' || _state === 'waiting') _setState('idle');
    }

    function _cancelVoice() {
        _clearCancelBar();
        if (els.prompt) els.prompt.value = '';
        _pendingChatText = null;
        _setState('idle');
    }

    // ---- Transcript received ----
    function _onTranscript(text) {
        if (!text.trim()) {
            showToast('Nothing heard — try again', 'info');
            _setState('idle');
            return;
        }
        if (els.prompt) els.prompt.value = text;
        _setState('confirming');

        _showCancelBar(CANCEL_DELAY_MS, () => {
            _pendingChatText = text;
            _setState('waiting');
            // Submit via api.chat — voice submits with current haMode
            api.chat(text, { assistMode: _getHaMode() });
            // Notify wakeword callback if this PTT was triggered by wakeword
            const cb = _onDoneCallback;
            _onDoneCallback = null;
            cb?.();
        });
    }

    // ---- Stream complete — play TTS ----
    async function _onStreamComplete(fullText) {
        if (_pendingChatText === null) return;
        _pendingChatText = null;

        if (!fullText || !fullText.trim()) {
            _setState('idle');
            return;
        }

        // TTS disabled — reset state without speaking
        _setState('idle');
        return;

        // Strip markdown and truncate for TTS
        const plain = fullText
            .replace(/```[\s\S]*?```/g, '')
            .replace(/[`*_~#>]/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .trim()
            .slice(0, 500);

        _setState('speaking');

        try {
            const t0 = performance.now();
            const resp = await fetch('/voice/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: plain }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                Logger.debug('Voice', `TTS error: ${err.detail}`);
                _setState('idle');
                return;
            }
            const wavBuf = await resp.arrayBuffer();
            const ttsMs = resp.headers.get('X-Voice-TTS-Ms') || Math.round(performance.now() - t0);
            Logger.debug('Voice', `TTS: ${ttsMs}ms, ${wavBuf.byteLength} bytes`);

            // Play via WebAudio
            const playCtx = new AudioContext();
            const decoded = await playCtx.decodeAudioData(wavBuf);
            const source = playCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(playCtx.destination);
            source.onended = () => {
                playCtx.close();
                _setState('idle');
            };
            source.start();
        } catch (e) {
            Logger.debug('Voice', `TTS playback error: ${e}`);
            _setState('idle');
        }
    }

    // ---- Public API ----
    async function init() {
        // Check voice availability
        let available = false;
        try {
            const resp = await fetch('/voice/status');
            if (resp.ok) {
                const s = await resp.json();
                available = s.stt_loaded || true; // Show mic if endpoint exists; STT loads lazily
                Logger.debug('Voice', 'Status:', s);
                if (!s.tts_loaded) {
                    Logger.debug('Voice', 'TTS not configured — mic visible but TTS will warn on use');
                }
            }
        } catch (e) {
            Logger.debug('Voice', `Status check failed: ${e}`);
        }

        if (!available) return;

        // Show UI elements
        els.voiceMicBtn?.removeAttribute('hidden');
        els.voiceModeToggle?.removeAttribute('hidden');

        // Restore mode preference
        _setHaMode(_getHaMode());

        // Mode toggle handlers
        els.voiceModeToggle?.querySelectorAll('.voice-mode-opt').forEach(btn => {
            btn.addEventListener('click', () => _setHaMode(btn.dataset.mode === 'ha'));
        });

        // Cancel bar button
        els.voiceCancelBtn?.addEventListener('click', _cancelVoice);

        // Mic button — PTT (mousedown/up + touch)
        const onPressStart = async (e) => {
            e.preventDefault();
            if (_state !== 'idle') return;
            _setState('listening');
            const ok = await _startRecording();
            if (!ok) _setState('idle');
        };
        const onPressEnd = async (e) => {
            e.preventDefault();
            if (_state === 'listening') {
                await _stopRecordingAndTranscribe();
            } else if (_state === 'speaking') {
                // Interrupt TTS by clicking mic while speaking — just reset to idle
                _setState('idle');
            }
        };

        if (els.voiceMicBtn) {
            els.voiceMicBtn.addEventListener('mousedown', onPressStart);
            els.voiceMicBtn.addEventListener('mouseup', onPressEnd);
            els.voiceMicBtn.addEventListener('touchstart', onPressStart, { passive: false });
            els.voiceMicBtn.addEventListener('touchend', onPressEnd, { passive: false });
        }
    }

    function triggerPTT(onDone) {
        if (_state !== 'idle') return;
        _onDoneCallback = onDone;
        _setState('listening');
        _startRecording().then(ok => {
            if (!ok) {
                _onDoneCallback = null;
                _setState('idle');
                onDone?.();
                return;
            }
            // Auto-stop after 5s max
            setTimeout(async () => {
                if (_state === 'listening') await _stopRecordingAndTranscribe();
            }, 5000);
        });
    }

    return { init, triggerPTT, _onStreamComplete, onStateChange, get haMode() { return _getHaMode(); }, get pendingChatText() { return _pendingChatText; }, get isIdle() { return _state === 'idle'; } };
})();

// ============================================================
// wakewordUI — browser-side wakeword detection via WebSocket
// ============================================================
const wakewordUI = (() => {
    const LS_KEY = 'wakeword_enabled';
    const FRAME_SAMPLES = 1280;          // samples per frame
    const FRAME_BYTES = FRAME_SAMPLES * 2; // Int16 = 2 bytes/sample

    let _ws = null;
    let _audioCtx = null;
    let _mediaStream = null;
    let _workletNode = null;
    let _floatBuf = new Float32Array(FRAME_SAMPLES);
    let _floatPos = 0;
    let _reconnectTimer = null;
    let _enabling = false;  // guard against concurrent enable() calls
    let _daemonPollInterval = null;
    let _preloadReady = false;      // true once model_preloaded=true from server
    let _preloadPollTimer = null;   // interval polling /voice/wakeword/status during preload

    const _stateChangeCallbacks = [];
    function onStateChange(cb) { _stateChangeCallbacks.push(cb); }

    function _isEnabled() { return localStorage.getItem(LS_KEY) === '1'; }
    function _setEnabled(v) { localStorage.setItem(LS_KEY, v ? '1' : '0'); }

    function _updateToggleUI(active) {
        els.wakewordToggleBtn?.classList.toggle('active', active);
        els.wakewordToggleBtn?.setAttribute('title', active ? 'Wake word: ON' : 'Wake word: OFF');
        if (active) voiceStatusBar.show(); else voiceStatusBar.hide();
    }

    function _setStateLabel(state) {
        _stateChangeCallbacks.forEach(cb => cb(state));
        const label = document.getElementById('wakeword-state-label');
        if (!label) return;
        const MAP = {
            idle:         { text: 'listening',     triggered: false },
            recording:    { text: 'triggered!',    triggered: true  },
            transcribing: { text: 'transcribing…', triggered: true  },
            submitting:   { text: 'processing…',   triggered: true  },
            cooldown:     { text: 'done',          triggered: false },
            disabled:     { text: '',              triggered: false },
        };
        const s = MAP[state] || { text: state, triggered: false };
        label.textContent = s.text;
        els.wakewordToggleBtn?.classList.toggle('triggered', s.triggered);
    }

    function _startDaemonPoll() {
        _stopDaemonPoll();   // idempotent
        _daemonPollInterval = setInterval(async () => {
            try {
                const r = await fetch('/voice/wakeword/status');
                if (!r.ok) return;
                const d = await r.json();
                _setStateLabel(d.state || 'disabled');
            } catch { /* server unreachable — ignore */ }
        }, 1500);
    }

    function _stopDaemonPoll() {
        clearInterval(_daemonPollInterval);
        _daemonPollInterval = null;
        _setStateLabel('disabled');
    }

    function _batchAndSend(float32Chunk) {
        if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
        let src = 0;
        while (src < float32Chunk.length) {
            const space = FRAME_SAMPLES - _floatPos;
            const copy = Math.min(space, float32Chunk.length - src);
            _floatBuf.set(float32Chunk.subarray(src, src + copy), _floatPos);
            _floatPos += copy;
            src += copy;
            if (_floatPos >= FRAME_SAMPLES) {
                // Convert Float32 → Int16
                const int16 = new Int16Array(FRAME_SAMPLES);
                for (let i = 0; i < FRAME_SAMPLES; i++) {
                    const s = Math.max(-1, Math.min(1, _floatBuf[i]));
                    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                _ws.send(int16.buffer);
                _floatPos = 0;
            }
        }
    }

    async function _openStream() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Microphone requires a secure context (localhost or HTTPS).');
        }
        _mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        _audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = _audioCtx.createMediaStreamSource(_mediaStream);
        await _audioCtx.audioWorklet.addModule('/static/js/pcm-recorder-worklet.js');
        _workletNode = new AudioWorkletNode(_audioCtx, 'pcm-recorder');
        _workletNode.port.onmessage = (e) => _batchAndSend(e.data);
        source.connect(_workletNode);
        Logger.debug('Wakeword', 'Audio stream opened at 16kHz');
    }

    function _openWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let wsUrl = `${proto}//${location.host}/voice/wakeword/ws`;
        if (window._LOCALIS_VOICE_KEY) {
            wsUrl += `?key=${encodeURIComponent(window._LOCALIS_VOICE_KEY)}`;
        }
        _ws = new WebSocket(wsUrl);
        _ws.binaryType = 'arraybuffer';

        _ws.onmessage = (e) => {
            let data;
            try { data = JSON.parse(e.data); } catch { return; }
            if (data.event === 'ready') {
                Logger.debug('Wakeword', 'Backend ready');
                _updateToggleUI(true);
            } else if (data.event === 'wake') {
                Logger.debug('Wakeword', `Wake detected score=${data.score}`);
                _onWake(data.score);
            } else if (data.event === 'score') {
                Logger.debug('Wakeword', `score=${data.score} threshold=${data.threshold}`);
            } else if (data.event === 'error') {
                showToast(`Wakeword error: ${data.message}`, 'error');
                disable();
            }
        };

        _ws.onclose = () => {
            _ws = null;
            if (_isEnabled()) {
                // Schedule reconnect only if we weren't deliberately disabled
                _reconnectTimer = setTimeout(() => {
                    if (_isEnabled()) enable();
                }, 2000);
            }
        };

        _ws.onerror = (e) => {
            Logger.debug('Wakeword', `WS error: ${e}`);
        };
    }

    function _onWake(score) {
        // Ignore wake events that arrive while PTT is already active (e.g. manual hold)
        if (!voiceUI.isIdle) return;

        _setStateLabel('recording');   // immediate feedback before PTT takes over
        _floatPos = 0;

        // Cancel any pending reconnect before closing, so onclose doesn't schedule another
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;

        // Detach onclose BEFORE calling close() — prevents the reconnect-timer path
        // from firing asynchronously while PTT mic is active (bug: double stream open)
        if (_ws) {
            _ws.onclose = null;
            _ws.close();
            _ws = null;
        }

        // Release wakeword mic now so PTT can acquire its own clean stream
        _stopStream();

        voiceUI.triggerPTT(() => {
            // After transcription submitted, restart wakeword if still enabled
            if (_isEnabled()) {
                setTimeout(() => enable(), 500);
            }
        });
    }

    function _stopStream() {
        _workletNode?.port.postMessage('stop');
        _workletNode?.disconnect();
        _workletNode = null;
        if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
        _mediaStream?.getTracks().forEach(t => t.stop());
        _mediaStream = null;
        _floatPos = 0;
    }

    async function enable() {
        // Guard: drop concurrent calls (e.g. reconnect timer fires while mic dialog is open)
        if (_enabling) return;
        if (_ws && _ws.readyState === WebSocket.OPEN) return;
        _enabling = true;
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
        // Always close any leftover stream before opening a new one (prevents track leaks)
        _stopStream();
        try {
            await _openStream();
        } catch (err) {
            _enabling = false;
            const msg = err.name === 'NotAllowedError'
                ? 'Microphone permission denied. Wake word disabled.'
                : `Wakeword mic error: ${err.message}`;
            showToast(msg, 'error');
            _setEnabled(false);
            _updateToggleUI(false);
            return;
        }
        _enabling = false;
        _openWS();
        _startDaemonPoll();
    }

    function disable() {
        _setEnabled(false);
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
        _ws?.close();
        _ws = null;
        _stopStream();
        _updateToggleUI(false);
        _stopDaemonPoll();
    }

    function _setPreloadReady() {
        _preloadReady = true;
        clearInterval(_preloadPollTimer);
        _preloadPollTimer = null;
        els.wakewordToggleBtn?.classList.remove('preloading');
        els.wakewordToggleBtn?.setAttribute('title', _isEnabled() ? 'Wake word: ON' : 'Wake word: OFF');
        // If user had it enabled before preload finished, start now
        if (_isEnabled()) enable();
    }

    function _startPreloadPoll() {
        _preloadPollTimer = setInterval(async () => {
            try {
                const r = await fetch('/voice/wakeword/status');
                if (!r.ok) return;
                const d = await r.json();
                if (d.preload_error) {
                    clearInterval(_preloadPollTimer);
                    _preloadPollTimer = null;
                    els.wakewordToggleBtn?.classList.remove('preloading');
                    showToast(`Wakeword unavailable: model download failed — check internet connection`, 'error');
                } else if (d.model_preloaded) {
                    _setPreloadReady();
                }
            } catch { /* server unreachable — ignore */ }
        }, 2000);
    }

    async function init() {
        // Only show toggle if voice is available
        let available = false;
        try {
            const resp = await fetch('/voice/status');
            if (resp.ok) available = true;
        } catch { /* voice not available */ }
        if (!available) return;

        els.wakewordToggleBtn?.removeAttribute('hidden');

        // Check preload status before enabling
        try {
            const sr = await fetch('/voice/wakeword/status');
            if (sr.ok) {
                const sd = await sr.json();
                if (sd.preload_error) {
                    showToast(`Wakeword unavailable: model download failed — check internet connection`, 'error');
                } else if (sd.model_preloaded) {
                    _preloadReady = true;
                    if (_isEnabled()) enable();
                    if (sd.enabled) _startDaemonPoll();
                } else {
                    // Still downloading — show preloading state and poll
                    els.wakewordToggleBtn?.classList.add('preloading');
                    els.wakewordToggleBtn?.setAttribute('title', 'Wake word (downloading model…)');
                    _startPreloadPoll();
                }
            }
        } catch { /* ignore */ }

        // Wire toggle click
        els.wakewordToggleBtn?.addEventListener('click', () => {
            if (!_preloadReady) {
                showToast('Wakeword model is still downloading, please wait…', 'info');
                return;
            }
            if (_isEnabled()) {
                disable();
            } else {
                _setEnabled(true);
                enable();
            }
        });
    }

    return { init, enable, disable, onStateChange, get enabled() { return _isEnabled(); } };
})();

const startApp = async () => {
    console.log('startApp called');
    document.body.classList.add('app-ready');
    document.getElementById('boot-screen').classList.add('hidden');

    // Load session preferences from localStorage
    loadSessionPreferences();

    // Always fetch state/models first
    await api.getModels();
    let appState = await api.getAppState();

    if (appState.n_ctx) state.nCtx = appState.n_ctx;

    // Enable debug logging based on backend flag
    Logger.setEnabled(appState.debug === true);
    Logger.debug('App', 'App state loaded', appState);

    // Setup Wizard (download or skip tutorial model) — fail-open
    if (window.SetupWizard && typeof window.SetupWizard.maybeRun === "function") {
        const wizardRan = await window.SetupWizard.maybeRun(appState);
        // Refresh models/state after wizard completes (whether it downloaded or user added model)
        if (wizardRan) {
            await api.getModels();              // refresh model list after download/skip
            appState = await api.getAppState(); // refresh app state
        }
    }


    // Sync DB tutorial_completed to localStorage so a returning user with cleared
    // localStorage doesn't get re-shown the tutorial.
    if (appState.tutorial_completed) {
        markFirstRunComplete();
    }

    if (isFirstRun()) {
        Logger.debug('App', 'First run detected, entering tutorial');
        enterFirstRunStep1();
        return;
    }

    Logger.debug('App', 'Returning user, loading normal interface');
    state.sidebarCollapsed = true;
    if(els.sidebar) els.sidebar.classList.add('collapsed');
    await api.getSessions();
    await api.loadHistory();
    updateAccent(AppSettings.get('accent', '#ffffff'));

    // Restore thinking mode for current session
    const thinkMode = getSessionThinkMode(state.sessionId);
    setSessionThinkMode(state.sessionId, thinkMode);

    // Load persisted settings (accent colour, active profile) — non-blocking
    loadSettings();

    // Initialize Tools Picker
    toolsUI.init();
    modePills.init();  // Wire mode pill toggles after toolsUI is ready
    rsbLights.start();
    rsbStats.start();
    rsbModel.init();

    // Initialize Voice UI (async, non-blocking — shows mic if /voice/status available)
    voiceUI.init().catch(e => Logger.debug('Voice', `init error: ${e}`));

    // Initialize Wakeword UI (depends on voice availability, runs after voiceUI)
    wakewordUI.init().catch(e => Logger.debug('Wakeword', `init error: ${e}`));
    voiceStatusBar.init();
    financeUI.init();   // Finance panel — no model required

    // Load system prompt
    api.loadSystemPrompt();

    // Welcome state: show when chat history is empty, hide on first message.
    // Wire suggestion chip clicks to populate the input.
    initWelcomeState();
}

function initWelcomeState() {
    // Show/hide welcome state based on current message count
    const hasMessages = els.chatHistory && els.chatHistory.querySelectorAll('.msg-row').length > 0;
    if (hasMessages) {
        els.welcomeState?.classList.add('hidden');
    } else {
        els.welcomeState?.classList.remove('hidden');
    }

    // Wire suggestion chip clicks
    document.querySelectorAll('.welcome-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt && els.prompt) {
                els.prompt.value = prompt;
                els.prompt.dispatchEvent(new Event('input'));
                els.welcomeState?.classList.add('hidden');
                els.prompt.focus();
            }
        });
    });

    // Input disabled state when no model loaded
    if (els.prompt && !state.modelLoaded) {
        els.prompt.disabled = true;
        els.prompt.placeholder = 'Loading model...';
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');

    const btnBegin = document.getElementById('btn-begin');
    if (btnBegin) {
        btnBegin.addEventListener('click', () => startApp());
    }

    // Auto-start if tutorial already completed (skips boot screen for returning users)
    if (!isFirstRun()) {
        startApp();
    }
});
