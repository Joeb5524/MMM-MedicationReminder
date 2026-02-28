/* global Module */

Module.register("MMM-MedicationReminder", {
    defaults: {
        header: "Medication",
        medications: [],
        alertWindowMinutes: 15,
        missedGraceMinutes: 60,
        updateIntervalMs: 1000,
        use24Hour: true,
        showRelative: true,
        maxItems: 6
    },

    start() {
        this.loaded = false;
        this.items = [];
        this._ticker = null;

        // takenState: { "YYYY-MM-DD": { "<medId>": true } }
        this.takenState = {};
        this.todayKey = moment().format("YYYY-MM-DD");

        this.buildSchedule();

        // Load persisted taken state
        this.sendSocketNotification("MED_INIT", {});

        this.loaded = true;

        this._ticker = setInterval(() => {
            // day rollover
            const nowKey = moment().format("YYYY-MM-DD");
            if (nowKey !== this.todayKey) this.todayKey = nowKey;

            this.items = this.computeStatuses();
            this.updateDom(0);
        }, this.config.updateIntervalMs);
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MED_TAKEN_SYNC") {
            if (payload && typeof payload === "object") {
                this.takenState = payload.takenState || {};
                this.updateDom(0);
            }
        }
    },

    suspend() {
        if (this._ticker) clearInterval(this._ticker);
        this._ticker = null;
    },

    resume() {
        if (!this._ticker) {
            this._ticker = setInterval(() => {
                const nowKey = moment().format("YYYY-MM-DD");
                if (nowKey !== this.todayKey) this.todayKey = nowKey;

                this.items = this.computeStatuses();
                this.updateDom(0);
            }, this.config.updateIntervalMs);
        }
    },

    getStyles() {
        return ["MMM-MedicationReminder.css"];
    },

    buildSchedule() {
        const meds = Array.isArray(this.config.medications) ? this.config.medications : [];
        this._meds = meds
            .map((m) => {
                const name = String(m.name ?? "").trim();
                const dosage = String(m.dosage ?? "").trim();
                const time = String(m.time ?? "").trim();
                const id = this.makeMedId(name, time); //

                return { id, name, dosage, time };
            })
            .filter((m) => m.name && m.time);

        this.items = this.computeStatuses();
    },

    makeMedId(name, time) {
        return `${String(name).trim().toLowerCase()}|${String(time).trim()}`;
    },

    isTakenToday(medId) {
        const day = this.todayKey;
        return !!(this.takenState[day] && this.takenState[day][medId]);
    },

    setTakenToday(medId, taken) {
        const day = this.todayKey;
        if (!this.takenState[day]) this.takenState[day] = {};
        if (taken) this.takenState[day][medId] = true;
        else delete this.takenState[day][medId];

        // Persist
        this.sendSocketNotification("MED_SET_TAKEN", {
            date: day,
            medId,
            taken: !!taken
        });
    },

    computeStatuses() {
        const now = moment();
        const alertWindow = Number(this.config.alertWindowMinutes) || 15;
        const missedGrace = Number(this.config.missedGraceMinutes) || 60;

        const items = this._meds.map((m) => {
            const due = this.parseTimeToday(m.time, now);
            const diffMin = due.diff(now, "minutes", true);

            const taken = this.isTakenToday(m.id);

            let status = "upcoming";
            if (Math.abs(diffMin) < 1) status = "due";
            else if (diffMin <= 0 && Math.abs(diffMin) <= missedGrace) status = "due";
            else if (diffMin < -missedGrace) status = "missed";
            else if (diffMin > 0 && diffMin <= alertWindow) status = "soon";

            // override if taken
            if (taken) status = "taken";

            return { ...m, due, diffMin, status, taken };
        });

        // Priority: due/soon/upcoming, taken, missed
        const priority = { due: 0, soon: 1, upcoming: 2, taken: 3, missed: 4 };
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
        return now.clone().startOf("day").add(m.hours(), "hours").add(m.minutes(), "minutes");
    },

    formatTime(due) {
        return this.config.use24Hour ? due.format("HH:mm") : due.format("h:mm A");
    },

    formatRelative(diffMin) {
        if (!this.config.showRelative) return "";
        const abs = Math.abs(diffMin);
        if (abs < 1) return "now";
        const totalMins = Math.round(abs);
        if (totalMins < 60) return diffMin > 0 ? `in ${totalMins}m` : `${totalMins}m ago`;
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const hm = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
        return diffMin > 0 ? `in ${hm}` : `${hm} ago`;
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
            row.dataset.medId = it.id;

            // tap-to-taken
            row.onclick = () => {
                if (it.status === "missed") return;

                const next = !this.isTakenToday(it.id);
                this.setTakenToday(it.id, next);

                // immediate UI feedback
                this.items = this.computeStatuses();
                this.updateDom(0);
            };

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
            rel.textContent = it.status === "taken" ? "✓ taken" : this.formatRelative(it.diffMin);

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