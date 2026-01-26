
// --- SECURITY & UTILS ---
const renderer = new marked.Renderer();
renderer.html = (html) => "";
marked.setOptions({ renderer: renderer });

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

// Shared SSE Reader
async function readSSE(response, onData) {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || ""; // Keep partial line
        for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const payload = JSON.parse(line.slice(6));
                        onData(payload);
                    } catch(e) {}
                }
            }
        }
    }
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
            els.prompt.placeholder = "Type your message...";
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
        FRT.requiredAction.baselineQuestion = null;
        FRT.requiredAction.soft_after = part.requires.soft_after || 999;
        document.getElementById('frt-nav').classList.add('frt-nav-locked');
    } else {
        FRT.requiredAction.kind = null;
        FRT.requiredAction.satisfied = true;
        FRT.requiredAction.attempts = 0;
        FRT.requiredAction.baselineQuestion = null;
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
    modelStatus: document.getElementById('model-status'),
    modelDisplay: document.getElementById('model-display'),
    themeSelect: document.getElementById('theme-select'),
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
    inputs: {
        layers: document.getElementById('num-layers'),
        ctx: document.getElementById('num-ctx'),
        temp: document.getElementById('num-temp')
    },
    sliders: {
        layers: document.getElementById('slider-layers'),
        ctx: document.getElementById('slider-ctx'),
        temp: document.getElementById('slider-temp')
    }
};

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
    tutorialSystemPromptText: TUTORIAL_PROMPT_DEFAULT
};

// Initialize user preferred name from sessionStorage
window.userPreferredName = sessionStorage.getItem('user_preferred_name') || '';

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

const savedOpacity = localStorage.getItem('local_ai_wall_opacity') || 10;
if(elWall.slider) elWall.slider.value = savedOpacity;
updateWallpaperOpacity(savedOpacity);
const savedUrl = localStorage.getItem('local_ai_wall_url');
if(savedUrl) setWallpaperUrl(savedUrl);

// --- UI HELPERS ---
if(els.btnSidebarToggle) els.btnSidebarToggle.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    els.sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
});

const toggleSettings = (show) => {
    state.rightSidebarOpen = show;
    els.rightSidebar.classList.toggle('visible', show);

    // In tutorial mode, keep rail visible and use body class for narrator reflow
    if (document.body.classList.contains('first-run-tutorial')) {
        document.body.classList.toggle('frt-settings-open', show);
        // Don't hide the rail in tutorial mode - it stays as the handle
    } else {
        // Normal mode: hide rail when sidebar opens
        if(els.rightRail) {
            if(show) els.rightRail.classList.add('hidden');
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
    else if(sectionKey === 'appearance') targetId = 'grp-theme';

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
if(document.getElementById('btn-rail-appearance')) document.getElementById('btn-rail-appearance').onclick = () => openRightSidebarSection('appearance');

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

if(els.prompt) els.prompt.addEventListener('input', function() {
    this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
    els.sendBtn.classList.toggle('ready', this.value.trim().length > 0);
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

const updateTheme = () => {
    if(!els.themeSelect) return;
    const theme = els.themeSelect.value;
    Array.from(els.themeSelect.options).forEach(opt => document.body.classList.remove(opt.value));
    document.body.classList.add(theme);
    AppSettings.set('theme', theme);
    if(theme === 'theme-tui') {
        els.prompt.placeholder = ""; els.sendBtn.textContent = "EXEC";
    } else {
        els.prompt.placeholder = "Type a message..."; els.sendBtn.textContent = "SEND";
    }
};
if(els.themeSelect) els.themeSelect.addEventListener('change', updateTheme);
const savedTheme = localStorage.getItem('local_ai_theme');
if(savedTheme && els.themeSelect) { els.themeSelect.value = savedTheme; updateTheme(); }

const updateStatus = (online, msg) => {
    els.connStatus.textContent = msg;
    els.statusDot.className = `status-indicator ${online ? 'online' : 'offline'}`;
    els.prompt.disabled = !online;
    els.modelStatus.textContent = online ? "STATUS: ONLINE" : "STATUS: OFFLINE";
    els.modelStatus.style.color = online ? "#10B981" : "#EF4444";
};

const appendMessage = (role, text) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    const content = document.createElement('div');
    content.className = 'msg-content markdown-body';
    if (role === 'assistant') {
        content.innerHTML = marked.parse(text);
        content.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
    } else {
        content.innerText = text;
    }
    msgDiv.appendChild(content);
    els.chatHistory.appendChild(msgDiv);
    els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
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
            els.modelSelect.innerHTML = '';
            data.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name; opt.textContent = `${m.name} (${m.size_gb} GB)`;
                if(data.current === m.name) opt.selected = true;
                els.modelSelect.appendChild(opt);
            });
            api.updateModelMeta();
            if(data.current) {
                state.modelLoaded = true; els.modelDisplay.textContent = data.current;
                updateStatus(true, "Connected");
                const welcome = document.querySelector('.welcome-container');
                if (welcome) welcome.remove();
            } else {
                state.modelLoaded = false;
                updateStatus(false, "No Model");
            }
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
            if(data.sessions && data.sessions.length > 0) {
                data.sessions.forEach(s => {
                    const div = document.createElement('div');
                    div.className = `session-item ${s.id === state.sessionId ? 'active' : ''}`;
                    div.textContent = s.title || s.id;
                    div.onclick = () => { state.sessionId = s.id; api.getSessions(); api.loadHistory(); };
                    els.sessionList.appendChild(div);
                });
            } else els.sessionList.innerHTML = '<div style=\"padding:10px; opacity:0.5; font-size:0.8rem;\">No active sessions</div>';
        } catch(e) {}
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
            state.modelLoaded = true; els.modelDisplay.textContent = data.loaded;
            updateStatus(true, "Ready");

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
            els.chatHistory.innerHTML = '';
        } catch(e) { alert(`Error: ${e.message}`); updateStatus(false, "Error"); }
        finally { els.btnLoad.disabled = false; els.btnLoad.textContent = "LOAD MODEL"; }
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
    chat: async (textOverride = null) => {
        const promptText = textOverride || els.prompt.value.trim();
        if(!promptText || state.isGenerating) return;
        const welcome = document.querySelector('.welcome-container');
        if (welcome) welcome.remove();
        if (!textOverride) {
            appendMessage('user', promptText);
            els.prompt.value = ''; els.prompt.style.height = 'auto';
        }
        state.isGenerating = true;
        let typeInterval = null;

        // Detect tutorial chat mode
        const isTutorialChat = document.body.classList.contains('first-run-tutorial') &&
                               document.body.classList.contains('frt-split-with-chat');

        try {
            let res;
            if (isTutorialChat) {
                // Tutorial chat mode - use /tutorial/chat with in-memory history
                state.tutorialHistory.push({ role: 'user', content: promptText });

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
                res = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: promptText,
                        max_tokens: 512,
                        temperature: parseFloat(els.inputs.temp.value),
                        session_id: state.sessionId,
                        web_search_mode: state.webSearchMode,
                    })
                });
            }

            if (!res.body) throw new Error("No stream");
            let assistantMsgContent = "";
            let displayedContent = "";
            let msgDiv = null;
            let streamFinished = false;
            let lastHighlightTime = 0;
            const updateMarkdown = (txt, forceHighlight = false) => {
                if(!msgDiv) {
                    const p = document.createElement('div');
                    p.className = 'message ai-msg';
                    const c = document.createElement('div');
                    c.className = 'msg-content markdown-body';
                    p.appendChild(c);
                    els.chatHistory.appendChild(p);
                    msgDiv = c;
                }
                msgDiv.innerHTML = marked.parse(txt);

                // Throttle highlighting: only run every ~500ms or when forced
                const now = Date.now();
                if (forceHighlight || now - lastHighlightTime > 500) {
                    msgDiv.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
                    lastHighlightTime = now;
                }

                els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
            };
            typeInterval = setInterval(() => {
                if (displayedContent.length < assistantMsgContent.length) {
                    const diff = assistantMsgContent.length - displayedContent.length;
                    const chunk = diff > 120 ? 12 : (diff > 60 ? 6 : (diff > 30 ? 3 : 1));
                    displayedContent += assistantMsgContent.substring(displayedContent.length, displayedContent.length + chunk);
                    updateMarkdown(displayedContent);
                } else if (streamFinished) {
                    clearInterval(typeInterval);
                    updateMarkdown(displayedContent, true); // Final highlight
                    state.isGenerating = false;
                }
            }, 30);
            await readSSE(res, (payload) => {
                if (payload.content) assistantMsgContent += payload.content;
            });
            streamFinished = true;

            // Add assistant response to tutorial history if in tutorial mode
            if (isTutorialChat) {
                state.tutorialHistory.push({ role: 'assistant', content: assistantMsgContent });

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
            msgs.forEach(m => appendMessage(m.role, m.content));
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
if(els.sendBtn) els.sendBtn.addEventListener('click', () => api.chat());
if(els.btnNewChat) els.btnNewChat.addEventListener('click', () => { state.sessionId = 'sess_' + Date.now(); api.getSessions(); els.chatHistory.innerHTML = ''; });
if(els.prompt) els.prompt.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); api.chat(); } });

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

const startApp = async () => {
    console.log('startApp called');
    document.body.classList.add('app-ready');
    document.getElementById('boot-screen').classList.add('hidden');

    // Always fetch state/models first
    await api.getModels();
    let appState = await api.getAppState();

    console.log('App state:', appState);

    // Setup Wizard (download or skip tutorial model) — fail-open
    if (window.SetupWizard && typeof window.SetupWizard.maybeRun === "function") {
        await window.SetupWizard.maybeRun(appState);
    }
    // Run setup wizard before tutorial if no models exist yet
    if (window.SetupWizard && typeof window.SetupWizard.maybeRun === "function") {
        await window.SetupWizard.maybeRun(appState);
        await api.getModels();              // refresh model list after download/skip
        appState = await api.getAppState(); // refresh app state
    }


    if (isFirstRun()) {
        console.log('First run detected, entering tutorial');
        enterFirstRunStep1();
        return;
    }

    console.log('Returning user, loading normal interface');
    state.sidebarCollapsed = true;
    if(els.sidebar) els.sidebar.classList.add('collapsed');
    await api.getSessions();
    await api.loadHistory();
    updateAccent(AppSettings.get('accent', '#ffffff'));
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');

    const btnBegin = document.getElementById('btn-begin');
    if (btnBegin) {
        console.log('Begin button found, attaching listener');
        btnBegin.addEventListener('click', () => {
            console.log('Begin button clicked!');
            startApp();
        });
    } else {
        console.error('Begin button NOT found in DOM!');
    }
});
