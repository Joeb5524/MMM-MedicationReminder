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
            const date = String(payload.date || "");
            const medId = String(payload.medId || "");
            const taken = !!payload.taken;

            if (!date || !medId) return;

            if (!this.takenState[date]) this.takenState[date] = {};
            if (taken) this.takenState[date][medId] = true;
            else delete this.takenState[date][medId];

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
            return JSON.parse(fs.readFileSync(this.filePath, "utf8")) || {};
        } catch (e) {
            return {};
        }
    },

    _save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.takenState, null, 2), "utf8");
        } catch (e) {}
    }
});