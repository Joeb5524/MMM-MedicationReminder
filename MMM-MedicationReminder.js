

Module.register("MMM-MedicationReminder", {
    defaults: {
        header: "Medication",
        medications: [
            //eg. { name: "Sertraline", dosage: "150mg", time: "09:00" },
        ],
        alertWindowMinutes: 15, // "Due soon" window before time
        missedGraceMinutes: 60, // after due time, mark as missed
        updateIntervalMs: 1000, // 1s so the UI flips status immediately
        use24Hour: true,
        showRelative: true,     // "in 10m" / "5m ago"
        maxItems: 6
    },

    start() {
        this.loaded = false;
        this.items = [];
        this._ticker = null;

        this.buildSchedule();
        this.loaded = true;

        this._ticker = setInterval(() => {
            this.items = this.computeStatuses();
            this.updateDom(0);
        }, this.config.updateIntervalMs);
    },

    suspend() {
        if (this._ticker) clearInterval(this._ticker);
        this._ticker = null;
    },

    resume() {
        if (!this._ticker) {
            this._ticker = setInterval(() => {
                this.items = this.computeStatuses();
                this.updateDom(0);
            }, this.config.updateIntervalMs);
        }
    },

    getStyles() {
        return ["MMM-MedicationReminder.css"];
    },

    buildSchedule() {
        // Normalise and create schedule for todays medications
        const meds = Array.isArray(this.config.medications) ? this.config.medications : [];
        this._meds = meds
            .map((m) => ({
                name: String(m.name ?? "").trim(),
                dosage: String(m.dosage ?? "").trim(),
                time: String(m.time ?? "").trim() // "HH:mm"
            }))
            .filter((m) => m.name && m.time);
        this.items = this.computeStatuses();
    },

    computeStatuses() {
        const now = moment();
        const alertWindow = Number(this.config.alertWindowMinutes) || 15;
        const missedGrace = Number(this.config.missedGraceMinutes) || 60;

        const items = this._meds.map((m) => {
            const due = this.parseTimeToday(m.time, now);
            const diffMin = due.diff(now, "minutes", true);

            let status = "upcoming";
            if (Math.abs(diffMin) < 1) status = "due";
            else if (diffMin <= 0 && Math.abs(diffMin) <= missedGrace) status = "due";
            else if (diffMin < -missedGrace) status = "missed";
            else if (diffMin > 0 && diffMin <= alertWindow) status = "soon";

            return {
                ...m,
                due,
                diffMin,
                status
            };
        });

        // Sort by soonest due time relative to now:
        // missed last, then due/soon/upcoming by absolute time to due
        const priority = { due: 0, soon: 1, upcoming: 2, missed: 3 };
        items.sort((a, b) => {
            const pa = priority[a.status] ?? 9;
            const pb = priority[b.status] ?? 9;
            if (pa !== pb) return pa - pb;

            return Math.abs(a.diffMin) - Math.abs(b.diffMin);
        });

        return items.slice(0, this.config.maxItems);
    },

    parseTimeToday(hhmm, now) {
        const clean = String(hhmm).trim();
        const m = moment(clean, ["H:mm", "HH:mm"], true);
        const due = now.clone().startOf("day").add(m.hours(), "hours").add(m.minutes(), "minutes");
        return due;
    },

    formatTime(due) {
        return this.config.use24Hour ? due.format("HH:mm") : due.format("h:mm A");
    },

    formatRelative(diffMin) {
        if (!this.config.showRelative) return "";
        const abs = Math.abs(diffMin);

        if (abs < 1) return "now";
        const mins = Math.round(abs);
        if (diffMin > 0) return `in ${mins}m`;
        return `${mins}m ago`;
    },

    getDom() {
        const wrapper = document.createElement("div");
        wrapper.className = "mmm-med";

        if (!this.loaded) {
            wrapper.innerHTML = "Loading…";
            wrapper.classList.add("dimmed", "light", "small");
            return wrapper;
        }

        if (!this.items.length) {
            const empty = document.createElement("div");
            empty.className = "mmm-med__empty dimmed light";
            empty.textContent = "No medications configured";
            wrapper.appendChild(empty);
            return wrapper;
        }

        const list = document.createElement("div");
        list.className = "mmm-med__list";

        this.items.forEach((it) => {
            const row = document.createElement("div");
            row.className = `mmm-med__row mmm-med__row--${it.status}`;

            const left = document.createElement("div");
            left.className = "mmm-med__left";

            const name = document.createElement("div");
            name.className = "mmm-med__name";
            name.textContent = it.name;

            const meta = document.createElement("div");
            meta.className = "mmm-med__meta dimmed";
            meta.textContent = it.dosage || "";

            left.appendChild(name);
            if (it.dosage) left.appendChild(meta);

            const right = document.createElement("div");
            right.className = "mmm-med__right";

            const time = document.createElement("div");
            time.className = "mmm-med__time";
            time.textContent = this.formatTime(it.due);

            const rel = document.createElement("div");
            rel.className = "mmm-med__rel dimmed";
            rel.textContent = this.formatRelative(it.diffMin);

            right.appendChild(time);
            if (this.config.showRelative) right.appendChild(rel);

            row.appendChild(left);
            row.appendChild(right);

            list.appendChild(row);
        });

        wrapper.appendChild(list);
        return wrapper;
    }
});