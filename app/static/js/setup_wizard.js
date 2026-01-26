// app/static/js/setup_wizard.js
(() => {
    const API = {
        status: async () => (await fetch("/setup/status")).json(),
 download: async () =>
 (await fetch("/setup/download-tutorial-model", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({}),
 })).json(),
 skip: async () => fetch("/setup/skip", { method: "POST" }),
 complete: async () => fetch("/setup/complete", { method: "POST" }),
 openModelsDir: async () => fetch("/setup/open-models-dir", { method: "POST" }),
    };

    function ensureUI() {
        if (document.getElementById("setupw-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "setupw-overlay";
        overlay.innerHTML = `
        <div id="setupw-card">
        <h3 id="setupw-title">Setup Wizard</h3>
        <p id="setupw-sub">
        You need at least one <b>.gguf</b> model in your <b>/models</b> folder.
        You can download a small tutorial model automatically or skip and add your own.
        </p>

        <div style="margin-bottom:10px;">
        <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:6px;">Models folder:</div>
        <div id="setupw-path">...</div>
        </div>

        <div id="setupw-actions">
        <button class="setupw-btn primary" id="setupw-btn-download">Download tutorial model</button>
        <button class="setupw-btn" id="setupw-btn-open">Open models folder</button>
        <button class="setupw-btn" id="setupw-btn-rescan">Rescan</button>
        <button class="setupw-btn" id="setupw-btn-skip">Skip download</button>
        <button class="setupw-btn primary" id="setupw-btn-continue">Continue</button>
        </div>

        <div id="setupw-status"></div>
        <div id="setupw-models"></div>
        </div>
        `;
        document.body.appendChild(overlay);
    }

    function setVisible(v) {
        const overlay = document.getElementById("setupw-overlay");
        if (!overlay) return;
        overlay.style.display = v ? "flex" : "none";
    }

    function setStatus(text) {
        const el = document.getElementById("setupw-status");
        if (el) el.textContent = text || "";
    }

    function setModels(models) {
        const el = document.getElementById("setupw-models");
        if (!el) return;
        if (!models || models.length === 0) {
            el.textContent = "Detected models: (none yet)";
            return;
        }
        el.textContent = "Detected models:\n- " + models.join("\n- ");
    }

    function setPath(p) {
        const el = document.getElementById("setupw-path");
        if (el) el.textContent = p || "";
    }

    async function refresh() {
        const st = await API.status();
        setPath(st.models_dir);
        setModels(st.models);

        const btnContinue = document.getElementById("setupw-btn-continue");
        if (btnContinue) btnContinue.disabled = false; // allow continue even if empty (you wanted “skip download”)

// Make it clear if no model exists
if (!st.has_any_model) {
    setStatus(
        `No .gguf found.\n\nSkip download if you want, but you must place a GGUF model into:\n${st.models_dir}\n\nThen click Rescan.`
    );
} else {
    setStatus("Model(s) detected. You can continue.");
    if (!st.setup_completed) {
        await API.complete();
    }
}

// reflect download state
if (st.download && st.download.status === "downloading") {
    setStatus("Downloading tutorial model from Hugging Face...\n(Progress is shown in server logs for now)");
}
if (st.download && st.download.status === "done") {
    setStatus("Tutorial model downloaded. You can continue.");
}
if (st.download && st.download.status === "error") {
    setStatus("Download failed:\n" + (st.download.error || "Unknown error"));
}

return st;
    }

    async function runWizard() {
        ensureUI();
        setVisible(true);

        const btnDownload = document.getElementById("setupw-btn-download");
        const btnOpen = document.getElementById("setupw-btn-open");
        const btnRescan = document.getElementById("setupw-btn-rescan");
        const btnSkip = document.getElementById("setupw-btn-skip");
        const btnContinue = document.getElementById("setupw-btn-continue");

        let polling = null;

        const stopPoll = () => {
            if (polling) clearInterval(polling);
            polling = null;
        };

        const startPoll = () => {
            stopPoll();
            polling = setInterval(() => refresh().catch(() => {}), 1200);
        };

        btnDownload.onclick = async () => {
            btnDownload.disabled = true;
            try {
                await API.download();
                startPoll();
            } catch (e) {
                setStatus("Download request failed. Check server logs.");
            } finally {
                btnDownload.disabled = false;
            }
        };

        btnOpen.onclick = async () => {
            try { await API.openModelsDir(); } catch (e) {}
        };

        btnRescan.onclick = async () => { await refresh(); };

        btnSkip.onclick = async () => {
            await API.skip();
            setStatus("Skipped tutorial model download.\nPlace your GGUF model into the models folder, then Rescan.");
        };

        btnContinue.onclick = async () => {
            stopPoll();
            setVisible(false);
        };

        await refresh();
        startPoll();

        // wait until overlay hidden (Continue clicked)
        await new Promise((resolve) => {
            const t = setInterval(() => {
                const ov = document.getElementById("setupw-overlay");
                if (ov && ov.style.display === "none") {
                    clearInterval(t);
                    resolve();
                }
            }, 200);
        });

        stopPoll();
        return true;
    }

    // Called by app.js from startApp()
    async function maybeRun(/* appState */) {
        try {
            const st = await API.status();
            // If setup completed OR any model exists, do nothing.
            if (st.setup_completed || st.has_any_model) {
                if (st.has_any_model && !st.setup_completed) await API.complete();
                return true;
            }
            return await runWizard();
        } catch (e) {
            // Fail-open: do not block app if setup endpoints are unavailable.
            console.warn("[SetupWizard] failed open:", e);
            return true;
        }
    }

    window.SetupWizard = { maybeRun };
})();
