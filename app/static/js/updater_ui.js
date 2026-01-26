// app/static/js/updater_ui.js
(() => {
    const API = {
        status: async () => (await fetch("/update/status")).json(),
 apply: async () =>
 (await fetch("/update/apply", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ ff_only: true }),
 })).json(),
    };

    function ensureModal() {
        if (document.getElementById("upd-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "upd-overlay";
        overlay.innerHTML = `
        <div id="upd-card">
        <h3 id="upd-title">Updates</h3>
        <div id="upd-body">Checking...</div>
        <div id="upd-actions">
        <button class="upd-btn" id="upd-btn-refresh">Check</button>
        <button class="upd-btn primary" id="upd-btn-apply">Update now</button>
        <button class="upd-btn" id="upd-btn-close">Close</button>
        </div>
        </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById("upd-btn-close").onclick = () => setVisible(false);
        document.getElementById("upd-btn-refresh").onclick = async () => render(await API.status());
        document.getElementById("upd-btn-apply").onclick = async () => {
            const body = document.getElementById("upd-body");
            body.textContent = "Applying update...";
            try {
                const res = await API.apply();
                body.textContent =
                "Update complete.\n\nRestart Localis to load new code.\n\n" +
                (res.stdout || "");
            } catch (e) {
                body.textContent = "Update failed. Check server logs.";
            }
        };
    }

    function setVisible(v) {
        const el = document.getElementById("upd-overlay");
        if (!el) return;
        el.style.display = v ? "flex" : "none";
    }

    function render(st) {
        const body = document.getElementById("upd-body");
        const applyBtn = document.getElementById("upd-btn-apply");

        if (!st.supported) {
            body.textContent =
            "Updater unavailable.\nReason: " + (st.reason || "unknown") +
            "\n\nIf you installed from a ZIP without .git, updates via git are disabled.\nFor in-app updates, ship the folder including .git.";
            applyBtn.disabled = true;
            return;
        }

        const behind = (st.behind === null || st.behind === undefined) ? "?" : st.behind;
        const dirty = st.dirty ? "YES" : "NO";

        body.textContent =
        `Repo: ${st.root}\n` +
        `Branch: ${st.branch}\n` +
        `Dirty: ${dirty}\n` +
        `Behind: ${behind}\n` +
        `Local: ${st.local_head}\n` +
        `Upstream: ${st.upstream}\n` +
        `Remote: ${st.remote_head}\n` +
        `Checked: ${st.checked_at}\n`;

        // only enable update if clean and behind > 0
        applyBtn.disabled = !!st.dirty || !(typeof st.behind === "number" && st.behind > 0);
    }

    function ensureSidebarButton() {
        // show only after tutorial ends (localStorage flag set by your existing endTutorial())
        const isDone = localStorage.getItem("localmind_first_run_complete") !== null;
        if (!isDone) return false;

        const footer = document.querySelector(".sidebar-footer");
        if (!footer) return false;

        if (document.getElementById("btn-open-updater")) return true;

        const btn = document.createElement("button");
        btn.className = "btn-icon-text";
        btn.id = "btn-open-updater";
        btn.innerHTML = `<span>⬆️</span><span class="btn-label">Update</span>`;
        btn.onclick = async () => {
            ensureModal();
            setVisible(true);
            try { render(await API.status()); } catch (e) {}
        };

        footer.prepend(btn);
        return true;
    }

    document.addEventListener("DOMContentLoaded", () => {
        // keep trying until tutorial completion flips
        const t = setInterval(() => {
            if (ensureSidebarButton()) clearInterval(t);
        }, 800);
    });
})();
