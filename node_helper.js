const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");

module.exports = NodeHelper.create({
    start() {
        this.dataDir = path.join(__dirname, "data");
        this.filePath = path.join(this.dataDir, "taken.json");
        this._ensureDir(this.dataDir);
        this.takenState = this._load();
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MED_INIT") {
            this.sendSocketNotification("MED_TAKEN_SYNC", { takenState: this.takenState });
            return;
        }

        if (notification === "MED_SET_TAKEN" && payload) {
            const date = String(payload.date || "").trim();
            const medId = String(payload.medId || "").trim();
            const taken = !!payload.taken;

            if (!date || !medId) return;

            if (!this.takenState[date]) this.takenState[date] = {};

            if (taken) this.takenState[date][medId] = true;
            else delete this.takenState[date][medId];

            if (!Object.keys(this.takenState[date]).length) delete this.takenState[date];

            this._pruneOldDays();
            this._save();
            this.sendSocketNotification("MED_TAKEN_SYNC", { takenState: this.takenState });
        }
    },

    _ensureDir(dir) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    },

    _load() {
        try {
            if (!fs.existsSync(this.filePath)) return {};
            const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_) {
            return {};
        }
    },

    _save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.takenState, null, 2), "utf8");
        } catch (_) {}
    },

    _pruneOldDays() {
        const keys = Object.keys(this.takenState).sort();
        const keep = 31;

        while (keys.length > keep) {
            const oldest = keys.shift();
            if (oldest) delete this.takenState[oldest];
        }
    }
});