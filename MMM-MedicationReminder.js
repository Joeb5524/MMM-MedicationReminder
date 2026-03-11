/* global Module, moment */

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
        this._meds = [];
        this.takenState = {};
        this.todayKey = moment().format("YYYY-MM-DD");

        this.buildSchedule();
        this.sendSocketNotification("MED_INIT", {});
        this.loaded = true;
        this._startTicker();
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MED_TAKEN_SYNC") {
            if (payload && typeof payload === "object") {
                this.takenState = payload.takenState || {};
                this.items = this.computeStatuses();
                this.updateDom(0);
            }
        }
    },

    notificationReceived(notification, payload) {
        if (notification === "MED_MARK_NEXT_DUE_TAKEN") {
            this._markNextDueTaken();
            return;
        }

        if (notification === "MED_MARK_MEDICATION_TAKEN" || notification === "MED_SET_MEDICATION_TAKEN") {
            this._markSpecificMedication(payload, true);
            return;
        }

        if (notification === "MED_UNMARK_MEDICATION_TAKEN" || notification === "MED_CLEAR_MEDICATION_TAKEN") {
            this._markSpecificMedication(payload, false);
            return;
        }

        if (notification === "MED_REFRESH" || notification === "MEDICATION_REFRESH") {
            this.items = this.computeStatuses();
            this.updateDom(0);
        }
    },

    suspend() {
        this._stopTicker();
    },

    resume() {
        this._startTicker();
    },

    getStyles() {
        return ["MMM-MedicationReminder.css"];
    },

    buildSchedule() {
        const meds = Array.isArray(this.config.medications) ? this.config.medications : [];

        this._meds = meds
            .map((m, index) => {
                const name = String((m && (m.name ?? m.medication)) || "").trim();
                const dosage = String((m && (m.dosage ?? m.dose)) || "").trim();
                const time = String((m && (m.time ?? m.at)) || "").trim();
                const id = String((m && m.id) || this.makeMedId(name, time, index)).trim();

                return {
                    id,
                    name,
                    dosage,
                    time
                };
            })
            .filter((m) => m.name && this.isValidTime(m.time));

        this.items = this.computeStatuses();
    },

    makeMedId(name, time, index) {
        return `${String(name).trim().toLowerCase()}|${String(time).trim()}|${index}`;
    },

    isValidTime(hhmm) {
        return moment(String(hhmm).trim(), ["H:mm", "HH:mm"], true).isValid();
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

            if (diffMin < -missedGrace) status = "missed";
            else if (diffMin <= 0) status = "due";
            else if (diffMin <= alertWindow) status = "soon";

            if (taken) status = "taken";

            return { ...m, due, diffMin, status, taken };
        });

        const priority = { due: 0, soon: 1, upcoming: 2, taken: 3, missed: 4 };

        items.sort((a, b) => {
            const pa = priority[a.status] ?? 9;
            const pb = priority[b.status] ?? 9;

            if (pa !== pb) return pa - pb;
            if (a.due.valueOf() !== b.due.valueOf()) return a.due.valueOf() - b.due.valueOf();
            return String(a.name).localeCompare(String(b.name));
        });

        return items.slice(0, Math.max(1, Number(this.config.maxItems) || 6));
    },

    parseTimeToday(hhmm, now) {
        const clean = String(hhmm).trim();
        const m = moment(clean, ["H:mm", "HH:mm"], true);

        if (!m.isValid()) {
            return now.clone().startOf("day");
        }

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
            row.setAttribute("role", "button");
            row.setAttribute("tabindex", "0");

            if (it.status !== "missed") {
                row.onclick = () => {
                    const next = !this.isTakenToday(it.id);
                    this.setTakenToday(it.id, next);
                    this.items = this.computeStatuses();
                    this.updateDom(0);
                };

                row.onkeydown = (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        row.click();
                    }
                };
            } else {
                row.classList.add("mmm-med__row--disabled");
            }

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
    },

    _startTicker() {
        if (this._ticker) return;

        const every = Math.max(500, Number(this.config.updateIntervalMs) || 1000);

        this._ticker = setInterval(() => {
            const nowKey = moment().format("YYYY-MM-DD");
            if (nowKey !== this.todayKey) this.todayKey = nowKey;

            this.items = this.computeStatuses();
            this.updateDom(0);
        }, every);
    },

    _stopTicker() {
        if (this._ticker) clearInterval(this._ticker);
        this._ticker = null;
    },

    _findMedicationFromPayload(payload) {
        if (!payload) return null;

        const id = payload.id != null ? String(payload.id) : "";
        const name = payload.name != null ? String(payload.name).trim().toLowerCase() : "";
        const time = payload.time != null ? String(payload.time).trim() : "";

        if (id) {
            return this._meds.find((m) => String(m.id) === id) || null;
        }

        if (name && time) {
            return this._meds.find((m) =>
                String(m.name).trim().toLowerCase() === name &&
                String(m.time).trim() === time
            ) || null;
        }

        if (name) {
            return this._meds.find((m) => String(m.name).trim().toLowerCase() === name) || null;
        }

        return null;
    },

    _markSpecificMedication(payload, taken) {
        const med = this._findMedicationFromPayload(payload);
        if (!med) return;

        this.setTakenToday(med.id, taken);
        this.items = this.computeStatuses();
        this.updateDom(0);
    },

    _markNextDueTaken() {
        const candidate = (this.items || []).find((it) =>
            it && it.id && it.status !== "missed" && !this.isTakenToday(it.id)
        );

        if (!candidate) return;

        this.setTakenToday(candidate.id, true);
        this.items = this.computeStatuses();
        this.updateDom(0);
    }
});